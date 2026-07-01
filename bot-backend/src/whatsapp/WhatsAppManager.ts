import EventEmitter from "node:events";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { handleCommand } from "@/commands/commandHandler";
import { withPrismaRetry } from "@/lib/prismaRetry";
import { prisma } from "@/prisma/client";
import { useWaSessionAuthState } from "@/whatsapp/authState";

/**
 * Logger do Baileys.
 *
 * Em paralelo ao nível (default `warn`), aplica um filtro de PADRÃO de
 * mensagens conhecidamente irrelevantes para a operação do Worker. Esses
 * eventos são esperados em qualquer sessão WhatsApp de grupo ativo e NÃO
 * impedem o envio de mensagens — só seriam relevantes se o bot processasse
 * INCOMING messages (o que ele não faz hoje).
 *
 * Famílias filtradas:
 *  - `got history notification`  → chunks do history sync inicial
 *  - `error in sending keep alive` → ping de 25s atrasou (auto-recupera)
 *  - `unexpected error in 'init queries'` → fetchProps timeout (cosmético)
 *  - `failed to decrypt message` → sessão Signal ausente / `@lid` quirks
 *
 * Bypass: `BAILEYS_VERBOSE=true` desativa o filtro (útil para investigação).
 */
const BAILEYS_NOISE_PATTERNS: RegExp[] = [
  /^got history notification$/i,
  /^error in sending keep alive$/i,
  /^unexpected error in 'init queries'$/i,
  /^failed to decrypt message$/i,
];

function isBaileysNoise(args: unknown[]): boolean {
  if (process.env.BAILEYS_VERBOSE === "true") return false;
  const first = args[0];
  const msg =
    typeof first === "string"
      ? first
      : typeof args[1] === "string"
        ? (args[1] as string)
        : "";
  if (!msg) return false;
  return BAILEYS_NOISE_PATTERNS.some((re) => re.test(msg));
}

const baileysLogger = pino({
  level: process.env.BAILEYS_LOG_LEVEL ?? "warn",
  hooks: {
    logMethod(args, method) {
      if (isBaileysNoise(args)) return;
      method.apply(this, args as Parameters<typeof method>);
    },
  },
});

type ConnectionStatus =
  | "connecting"
  | "qr"
  | "connected"
  | "ready"
  | "disconnected"
  | "logged_out";

interface QrEvent {
  userId: string;
  qr: string;
}

interface ConnectionEvent {
  userId: string;
  status: ConnectionStatus;
}

/**
 * Gerenciador multi-tenant de sockets Baileys.
 *
 * Mantém um Map<userId, WASocket> em memória, persiste auth no Supabase
 * (tabela `wa_sessions`) e, em primeiro pareamento, emite o QR direto no
 * terminal — sem depender de UI / rotas HTTP.
 *
 * Uso:
 *   const manager = new WhatsAppManager();
 *   await manager.initializeUser("user_123");
 *   await manager.sendGroupMessage("user_123", "555512345678-1700000000@g.us", "oi");
 */
export class WhatsAppManager {
  private readonly sockets = new Map<string, WASocket>();
  private readonly inflight = new Map<string, Promise<WASocket>>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  /** userIds que já receberam `receivedPendingNotifications` do Baileys. */
  private readonly readyUsers = new Set<string>();
  /** Último QR string bruto recebido do Baileys, por userId. */
  private readonly latestQrRaw = new Map<string, string>();
  /** Último QR já convertido em data URL PNG (cache leve, recalcula a cada novo QR). */
  private readonly latestQrDataUrl = new Map<string, string>();
  readonly events = new EventEmitter();

  /**
   * Carrega a sessão Baileys do usuário no PostgreSQL. Se já houver creds
   * válidas, restaura a conexão silenciosamente. Caso contrário, imprime o
   * QR Code no terminal (e o emite via EventEmitter para logs customizados).
   *
   * Realmente idempotente: se já existe um socket no mapa (mesmo que ainda
   * não autenticado), retorna esse — caso contrário cada poll do frontend
   * criaria um socket novo, gerando QRs em loop e conflitos `code=440`.
   *
   * Sockets removidos do mapa só ocorrem em `connection: "close"`, logo
   * reabertura via `scheduleReconnect` sempre cria fresh socket.
   */
  async initializeUser(userId: string): Promise<WASocket> {
    const existing = this.sockets.get(userId);
    if (existing) return existing;

    const inflight = this.inflight.get(userId);
    if (inflight) return inflight;

    const promise = this.openSocket(userId).finally(() => {
      this.inflight.delete(userId);
    });
    this.inflight.set(userId, promise);
    return promise;
  }

  /** Socket ativo (com `user` setado pelo Baileys). */
  getSocket(userId: string): WASocket | undefined {
    const sock = this.sockets.get(userId);
    return sock?.user ? sock : undefined;
  }

  isConnected(userId: string): boolean {
    return Boolean(this.sockets.get(userId)?.user);
  }

  /**
   * `true` quando o Baileys já completou as init queries (fetchProps,
   * pending notifications). Operações como `groupFetchAllParticipating()`
   * só são seguras a partir desse ponto.
   */
  isReady(userId: string): boolean {
    return this.readyUsers.has(userId);
  }

  /**
   * Resolve quando o socket está pronto para queries (ou no timeout).
   * Retorna `true` se ficou ready, `false` no timeout.
   */
  waitForReady(userId: string, timeoutMs = 30_000): Promise<boolean> {
    if (this.readyUsers.has(userId)) return Promise.resolve(true);

    return new Promise<boolean>((resolve) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.events.off("connection", onConnection);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      const onConnection = (evt: ConnectionEvent) => {
        if (evt.userId !== userId) return;
        if (evt.status === "ready") {
          cleanup();
          resolve(true);
        }
      };

      this.events.on("connection", onConnection);
    });
  }

  /**
   * Retorna o último QR Code conhecido (data URL PNG) para esse userId.
   * `undefined` quando: socket já está conectado OU nunca chegou QR ainda
   * OU o Baileys ainda está negociando.
   */
  getLatestQrDataUrl(userId: string): string | undefined {
    if (this.isConnected(userId)) return undefined;
    return this.latestQrDataUrl.get(userId);
  }

  /** Envia texto para um grupo via socket do usuário; conecta se necessário. */
  async sendGroupMessage(
    userId: string,
    whatsappGroupId: string,
    text: string,
  ): Promise<void> {
    let sock = this.getSocket(userId);
    if (!sock) {
      sock = await this.initializeUser(userId);
    }
    const jid = whatsappGroupId.includes("@")
      ? whatsappGroupId
      : `${whatsappGroupId}@g.us`;
    await sock.sendMessage(jid, { text });
  }

  /** Fecha um socket sem apagar a sessão persistida. */
  async disconnect(userId: string): Promise<void> {
    const timer = this.reconnectTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(userId);
    }
    const sock = this.sockets.get(userId);
    if (sock) {
      try {
        sock.end(undefined);
      } catch {
        // ignore
      }
      this.sockets.delete(userId);
    }
    this.readyUsers.delete(userId);
    this.latestQrRaw.delete(userId);
    this.latestQrDataUrl.delete(userId);
  }

  /**
   * "Nuke" completo da sessão: desconecta socket, limpa TODO estado em
   * memória e zera o `sessionData` no banco. Próximo `initializeUser` vai
   * gerar QR novo do zero.
   *
   * Usar quando:
   *  - Signal ratchet corrompido (`Bad MAC Error` recorrente no libsignal)
   *  - Usuário quer trocar de número
   *  - Sessão órfã (`stream:error` type=replaced em loop)
   */
  async resetSession(userId: string): Promise<void> {
    await this.disconnect(userId);

    await withPrismaRetry(
      () =>
        prisma.waSession.upsert({
          where: { userId },
          create: { userId, sessionData: {} },
          update: { sessionData: {} },
        }),
      { label: `wa:${userId}:reset` },
    ).catch((err) => {
      console.error(`[wa:${userId}] resetSession: falha ao zerar DB:`, err);
      throw err;
    });

    this.emitConnection(userId, "logged_out");
    console.log(`[wa:${userId}] sessão resetada — QR novo será gerado`);
  }

  /** Fecha todos os sockets — usado no shutdown do processo. */
  async shutdown(): Promise<void> {
    const userIds = [...this.sockets.keys()];
    await Promise.allSettled(userIds.map((id) => this.disconnect(id)));
  }

  private async openSocket(userId: string): Promise<WASocket> {
    const { state, saveCreds } = await useWaSessionAuthState(userId);
    const { version } = await fetchLatestBaileysVersion();

    this.emitConnection(userId, "connecting");

    const sock = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      browser: ["LoL Match Monitor", "Chrome", "1.0.0"],
    });

    sock.ev.on("creds.update", saveCreds);

    // Listener de comandos (Command Pattern via `@/commands/commandHandler`).
    //
    // - `type === "notify"` filtra mensagens AO VIVO. Outros types ("append",
    //   "prepend") são reentrega de histórico (history sync) e não devem
    //   disparar comandos — senão o bot reagiria a mensagens antigas a cada
    //   reconexão.
    // - `fromMe` / payload vazio são filtrados dentro do `handleCommand`.
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        try {
          await handleCommand(sock, msg, userId);
        } catch (err) {
          console.error(`[wa:${userId}] command listener erro:`, err);
        }
      }
    });

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr, receivedPendingNotifications } =
        update;

      if (qr) {
        this.latestQrRaw.set(userId, qr);
        // Pré-gera o data URL para ficar pronto no GET /status sem await.
        void qrcode
          .toDataURL(qr, { width: 320, margin: 1 })
          .then((url) => this.latestQrDataUrl.set(userId, url))
          .catch((err) =>
            console.error(`[wa:${userId}] falha ao gerar QR data URL:`, err),
          );
        this.printQrToTerminal(userId, qr);
        this.emitConnection(userId, "qr");
        this.events.emit("qr", { userId, qr } satisfies QrEvent);
      }

      if (connection === "open") {
        console.log(`[wa:${userId}] conectado como ${sock.user?.id ?? "?"}`);
        this.latestQrRaw.delete(userId);
        this.latestQrDataUrl.delete(userId);
        this.emitConnection(userId, "connected");
      }

      // Baileys sinaliza fim das init queries (fetchProps, sync inicial, etc.).
      // Esse é o ponto seguro para começar a fazer queries (groupFetch, etc.).
      if (receivedPendingNotifications) {
        this.readyUsers.add(userId);
        this.emitConnection(userId, "ready");
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        this.sockets.delete(userId);
        this.readyUsers.delete(userId);

        if (loggedOut) {
          console.warn(
            `[wa:${userId}] logged_out — sessão apagada, novo QR exigido`,
          );
          this.latestQrRaw.delete(userId);
          this.latestQrDataUrl.delete(userId);
          void withPrismaRetry(
            () =>
              prisma.waSession.upsert({
                where: { userId },
                create: { userId, sessionData: {} },
                update: { sessionData: {} },
              }),
            { label: `wa:${userId}:logged_out` },
          ).catch((err) =>
            console.error(`[wa:${userId}] falha ao limpar sessão:`, err),
          );
          this.emitConnection(userId, "logged_out");
          return;
        }

        console.warn(
          `[wa:${userId}] desconectado (code=${statusCode ?? "?"}) — reconectando em 5s`,
        );
        this.emitConnection(userId, "disconnected");
        this.scheduleReconnect(userId, 5_000);
      }
    });

    this.sockets.set(userId, sock);
    return sock;
  }

  private scheduleReconnect(userId: string, delayMs: number): void {
    const previous = this.reconnectTimers.get(userId);
    if (previous) clearTimeout(previous);

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(userId);
      void this.initializeUser(userId).catch((err) =>
        console.error(`[wa:${userId}] reconexão falhou:`, err),
      );
    }, delayMs);
    this.reconnectTimers.set(userId, timer);
  }

  private printQrToTerminal(userId: string, qr: string): void {
    console.log(
      `\n[wa:${userId}] escaneie o QR abaixo no WhatsApp (Aparelhos conectados):`,
    );
    qrcodeTerminal.generate(qr, { small: true });
  }

  private emitConnection(userId: string, status: ConnectionStatus): void {
    this.events.emit("connection", { userId, status } satisfies ConnectionEvent);
  }
}

export type { ConnectionEvent, ConnectionStatus, QrEvent };

/** Singleton compartilhado pelo Worker. */
export const whatsappManager = new WhatsAppManager();
