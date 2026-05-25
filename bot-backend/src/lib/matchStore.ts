import fs from "fs/promises";
import type { RankedSnapshot } from "@/types/riot";
import { getMatchStorePath, getPersistentDataDir } from "@/lib/paths";

function storePath(): string {
  return getMatchStorePath();
}

export interface MatchStore {
  lastMatchId: string | null;
  currentTier: string | null;
  currentRank: string | null;
  currentLp: number | null;
  updatedAt: string;
}

const DEFAULT_STORE: MatchStore = {
  lastMatchId: null,
  currentTier: null,
  currentRank: null,
  currentLp: null,
  updatedAt: new Date().toISOString(),
};

async function readStore(): Promise<MatchStore> {
  try {
    const raw = await fs.readFile(storePath(), "utf-8");
    const data = JSON.parse(raw) as Partial<MatchStore>;
    return {
      ...DEFAULT_STORE,
      ...data,
      updatedAt: data.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

/** Retorna o estado completo persistido */
export async function getMatchStore(): Promise<MatchStore> {
  return readStore();
}

/** Lê o ID da última partida processada */
export async function getLastMatchId(): Promise<string | null> {
  const store = await readStore();
  return store.lastMatchId;
}

/** Snapshot ranqueado salvo antes da última partida processada */
export async function getStoredRankedSnapshot(): Promise<RankedSnapshot | null> {
  const store = await readStore();
  if (!store.currentTier || store.currentLp === null) {
    return null;
  }

  return {
    tier: store.currentTier,
    rank: store.currentRank ?? "",
    leaguePoints: store.currentLp,
  };
}

/** Atualiza partida processada e/ou elo atual */
export async function updateMatchStore(
  partial: Partial<MatchStore>,
): Promise<void> {
  const current = await readStore();
  const data: MatchStore = {
    ...current,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(getPersistentDataDir(), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify(data, null, 2), "utf-8");
}

/** Persiste o ID da última partida (compatibilidade) */
export async function setLastMatchId(matchId: string): Promise<void> {
  await updateMatchStore({ lastMatchId: matchId });
}

/** Salva snapshot ranqueado no estado */
export async function setRankedSnapshot(
  snapshot: RankedSnapshot,
): Promise<void> {
  await updateMatchStore({
    currentTier: snapshot.tier,
    currentRank: snapshot.rank,
    currentLp: snapshot.leaguePoints,
  });
}

/** Inicializa o arquivo de estado se ainda não existir */
export async function ensureStoreExists(): Promise<void> {
  try {
    await fs.access(storePath());
  } catch {
    await fs.mkdir(getPersistentDataDir(), { recursive: true });
    await fs.writeFile(
      storePath(),
      JSON.stringify(DEFAULT_STORE, null, 2),
      "utf-8",
    );
  }
}
