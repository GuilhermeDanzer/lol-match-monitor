import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  initAuthCreds,
  SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { sleep } from "@/lib/delay";
import { withPrismaRetry } from "@/lib/prismaRetry";
import { prisma } from "@/prisma/client";

/**
 * Implementação custom do `useMultiFileAuthState` do Baileys.
 *
 * Em vez de ler/gravar em disco, persiste tudo na tabela `WaSession` do
 * Supabase via Prisma (`findUnique` + `upsert`).
 *
 * CRÍTICO: `keys` contém Buffers (ex: sender-key de grupos). Sem
 * `BufferJSON.replacer/reviver` no blob inteiro, o Postgres grava base64
 * cru ("W3sic2VuZG...") e `SenderKeyRecord.deserialize` falha ao enviar
 * mensagens em @g.us.
 */

type KeyStore = {
  [T in keyof SignalDataTypeMap]?: Record<string, SignalDataTypeMap[T]>;
};

interface SessionBlob {
  creds: AuthenticationCreds;
  keys: KeyStore;
}

const KEYS_PERSIST_DEBOUNCE_MS = Number(
  process.env.WA_SESSION_DEBOUNCE_MS ?? 400,
);

function emptyBlob(): SessionBlob {
  return { creds: initAuthCreds(), keys: {} };
}

/** Round-trip JSON com suporte a Buffer — igual ao auth state em disco do Baileys. */
function reviveJson<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;
}

function stringifyJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer), BufferJSON.reviver);
}

function isSessionJsonString(value: string): boolean {
  return value.startsWith("[") || value.startsWith("{");
}

/** Base64 de chave binária (noise, sender-key, etc.) — não confundir com JSON textual. */
function looksLikeBase64Buffer(value: string): boolean {
  if (value.length < 4) return false;
  if (isSessionJsonString(value)) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(value);
}

function coerceToBuffer(value: unknown): Buffer | unknown {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;

  if (typeof value === "object" && value !== null) {
    const obj = value as { type?: string; data?: unknown };
    if (obj.type === "Buffer" && obj.data !== undefined) {
      return BufferJSON.reviver("", value) as Buffer;
    }
  }

  if (typeof value === "string" && looksLikeBase64Buffer(value)) {
    return Buffer.from(value, "base64");
  }

  return value;
}

type KeyPairLike = { public: Buffer; private: Buffer };

function normalizeKeyPair(value: unknown): KeyPairLike | undefined {
  if (!value || typeof value !== "object") return undefined;
  const pair = value as Record<string, unknown>;
  return {
    ...(pair as KeyPairLike),
    public: coerceToBuffer(pair.public) as Buffer,
    private: coerceToBuffer(pair.private) as Buffer,
  };
}

/**
 * Repara creds onde `noiseKey`/`signedPreKey` etc. viraram string base64 no JSONB.
 * Campos string legítimos (`advSecretKey`, `myAppStateKeyId`) são preservados.
 */
function normalizeCreds(creds: AuthenticationCreds): AuthenticationCreds {
  const next = { ...creds };

  if (next.noiseKey) {
    next.noiseKey = normalizeKeyPair(next.noiseKey) ?? next.noiseKey;
  }
  if (next.pairingEphemeralKeyPair) {
    next.pairingEphemeralKeyPair =
      normalizeKeyPair(next.pairingEphemeralKeyPair) ??
      next.pairingEphemeralKeyPair;
  }
  if (next.signedIdentityKey) {
    next.signedIdentityKey =
      normalizeKeyPair(next.signedIdentityKey) ?? next.signedIdentityKey;
  }
  if (next.signedPreKey) {
    next.signedPreKey = {
      ...next.signedPreKey,
      keyPair:
        normalizeKeyPair(next.signedPreKey.keyPair) ?? next.signedPreKey.keyPair,
      signature: coerceToBuffer(next.signedPreKey.signature) as Buffer,
    };
  }
  if (next.routingInfo !== undefined && next.routingInfo !== null) {
    next.routingInfo = coerceToBuffer(next.routingInfo) as Buffer;
  }

  return next;
}

/**
 * Repara chaves Signal salvas com serialização antiga (Buffer virou string base64 pura).
 */
function normalizeStoredKeyValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;

  if (typeof value === "object") {
    const obj = value as { type?: string; data?: unknown };
    if (obj.type === "Buffer" && obj.data !== undefined) {
      return BufferJSON.reviver("", value);
    }
    if (Array.isArray(value)) {
      return value.map(normalizeStoredKeyValue);
    }
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === "public" || key === "private" || key === "signature") {
        out[key] = coerceToBuffer(nested);
      } else {
        out[key] = normalizeStoredKeyValue(nested);
      }
    }
    return out;
  }

  if (typeof value === "string") {
    if (isSessionJsonString(value)) return value;
    if (looksLikeBase64Buffer(value)) return Buffer.from(value, "base64");
  }

  return value;
}

function normalizeKeyStore(keys: KeyStore): KeyStore {
  const normalized = {} as KeyStore;
  for (const [type, bucket] of Object.entries(keys)) {
    if (!bucket || typeof bucket !== "object") continue;
    const out: Record<string, unknown> = {};
    for (const [id, val] of Object.entries(bucket)) {
      out[id] = normalizeStoredKeyValue(val);
    }
    (normalized as Record<string, Record<string, unknown>>)[type] = out;
  }
  return normalized;
}

function parseBlob(raw: unknown): SessionBlob {
  if (!raw || typeof raw !== "object") return emptyBlob();
  const data = reviveJson<Partial<SessionBlob>>(raw);
  const creds = normalizeCreds(data.creds ?? initAuthCreds());
  const keys = normalizeKeyStore((data.keys as KeyStore) ?? {});
  return { creds, keys };
}

function serializeBlob(blob: SessionBlob): object {
  return stringifyJson({ creds: blob.creds, keys: blob.keys }) as object;
}

export interface PostgresAuthStateHandle {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  reset: () => Promise<void>;
}

export async function useWaSessionAuthState(
  userId: string,
): Promise<PostgresAuthStateHandle> {
  const existing = await withPrismaRetry(
    () => prisma.waSession.findUnique({ where: { userId } }),
    { label: `wa:${userId}:load` },
  );
  const blob = parseBlob(existing?.sessionData);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;

  const upsertBlob = async (): Promise<void> => {
    const payload = serializeBlob(blob);
    await withPrismaRetry(
      () =>
        prisma.waSession.upsert({
          where: { userId },
          create: { userId, sessionData: payload },
          update: { sessionData: payload },
        }),
      { label: `wa:${userId}:upsert` },
    );
  };

  const flushPersist = async (): Promise<void> => {
    if (flushPromise) return flushPromise;
    flushPromise = upsertBlob()
      .catch((err) => {
        console.error(`[wa:${userId}] falha ao persistir sessão:`, err);
        throw err;
      })
      .finally(() => {
        flushPromise = null;
      });
    return flushPromise;
  };

  const scheduleDebouncedPersist = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void flushPersist();
    }, KEYS_PERSIST_DEBOUNCE_MS);
  };

  const persistImmediate = async (): Promise<void> => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    await flushPersist();
  };

  const state: AuthenticationState = {
    creds: blob.creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[],
      ) => {
        const bucket = (blob.keys[type] ?? {}) as Record<
          string,
          SignalDataTypeMap[T]
        >;
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          const value = bucket[id];
          if (value !== undefined) {
            result[id] = normalizeStoredKeyValue(value) as SignalDataTypeMap[T];
          }
        }
        return result;
      },
      set: async (
        data: Partial<Record<keyof SignalDataTypeMap, Record<string, unknown>>>,
      ) => {
        const store = blob.keys as Record<string, Record<string, unknown>>;
        for (const category of Object.keys(data)) {
          const patch = data[category as keyof SignalDataTypeMap];
          if (!patch) continue;
          store[category] = { ...(store[category] ?? {}), ...patch };
          for (const id of Object.keys(patch)) {
            if (patch[id] === undefined || patch[id] === null) {
              delete store[category][id];
            }
          }
        }
        scheduleDebouncedPersist();
      },
    },
  };

  const saveCreds = async (): Promise<void> => {
    blob.creds = state.creds;
    await persistImmediate();
  };

  const reset = async (): Promise<void> => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    await withPrismaRetry(
      () =>
        prisma.waSession.upsert({
          where: { userId },
          create: { userId, sessionData: {} },
          update: { sessionData: {} },
        }),
      { label: `wa:${userId}:reset` },
    );
    await sleep(100);
  };

  // Regrava com formato correto se carregou sessão legada corrompida.
  if (existing?.sessionData) {
    void persistImmediate().catch((err) =>
      console.warn(`[wa:${userId}] regravação pós-migração BufferJSON:`, err),
    );
  }

  return { state, saveCreds, reset };
}
