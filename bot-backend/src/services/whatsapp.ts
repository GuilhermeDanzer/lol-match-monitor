/**
 * Cliente WhatsApp via @whiskeysockets/baileys (WebSocket, sem Puppeteer).
 * QR/código em GET /api/qr — sessão em auth_info_baileys.
 */
import { getWhatsAppAuthPath } from "@/lib/paths";
import {
  handleWhatsAppCommand,
  isCommandMessage,
} from "@/services/whatsappCommands";
import { Boom } from "@hapi/boom";
import fs from "fs/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type proto,
  type WASocket,
} from "@whiskeysockets/baileys";
import P from "pino";

const PAIRING_GRACE_MS = 180_000;

let sock: WASocket | null = null;
let isReady = false;
let isPairing = false;
let isConnecting = false;
let currentQrString: string | null = null;
let currentQrId = 0;
let currentPairingCode: string | null = null;
let pairingCodeRequested = false;
let pairingGraceUntil = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let startGeneration = 0;

const logger = P({ level: "silent" });

export function getCurrentQrString(): string | null {
  return currentQrString;
}

export function getCurrentQrId(): number {
  return currentQrId;
}

export function getCurrentPairingCode(): string | null {
  return currentPairingCode;
}

/** true = codigo de 8 letras; false = QR (recomendado no Render) */
export function usesPairingCodeMode(): boolean {
  return resolvePairingMethod() === "code";
}

function resolvePairingMethod(): "qr" | "code" {
  const explicit = process.env.WHATSAPP_PAIRING_METHOD?.trim().toLowerCase();
  if (explicit === "qr" || explicit === "code") return explicit;
  if (normalizePhoneNumber(process.env.WHATSAPP_PHONE_NUMBER)) return "code";
  return "qr";
}

function normalizePhoneNumber(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

function maskPhoneNumber(phone: string): string {
  if (phone.length <= 4) return "****";
  return `${phone.slice(0, 4)}****${phone.slice(-2)}`;
}

function isInPairingGrace(): boolean {
  return Date.now() < pairingGraceUntil;
}

function startPairingGrace(): void {
  pairingGraceUntil = Date.now() + PAIRING_GRACE_MS;
}

function clearPairingGrace(): void {
  pairingGraceUntil = 0;
}

export function getWhatsAppStatus(): {
  ready: boolean;
  awaitingQr: boolean;
  pairing: boolean;
  pairingCodeMode: boolean;
  pairingMethod: "qr" | "code";
  pairingCode: string | null;
  phoneMasked: string | null;
  groupIdConfigured: boolean;
  authPath: string;
  qrId: number;
  engine: string;
  pairingGraceSecondsLeft: number;
} {
  const phone = normalizePhoneNumber(process.env.WHATSAPP_PHONE_NUMBER);
  const method = resolvePairingMethod();
  const graceLeft = Math.max(0, pairingGraceUntil - Date.now());

  return {
    ready: isReady,
    awaitingQr: Boolean(currentQrString),
    pairing: isPairing,
    pairingCodeMode: method === "code",
    pairingMethod: method,
    pairingCode: currentPairingCode,
    phoneMasked: phone ? maskPhoneNumber(phone) : null,
    groupIdConfigured: Boolean(process.env.WHATSAPP_GROUP_ID?.trim()),
    authPath: getWhatsAppAuthPath(),
    qrId: currentQrId,
    engine: "baileys",
    pairingGraceSecondsLeft: Math.ceil(graceLeft / 1000),
  };
}

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function isTargetGroup(jid: string | null | undefined): boolean {
  if (!jid?.endsWith("@g.us")) return false;

  const configuredId = process.env.WHATSAPP_GROUP_ID?.trim();
  if (!configuredId) {
    console.warn(
      "[WhatsApp] WHATSAPP_GROUP_ID nao configurado — comandos em qualquer grupo.",
    );
    return true;
  }

  return jid === configuredId;
}

async function handleIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
  const jid = msg.key.remoteJid;
  if (!jid || !isTargetGroup(jid)) return;

  const body =
    msg.message?.conversation ??
    msg.message?.extendedTextMessage?.text ??
    msg.message?.imageMessage?.caption;
  const trimmed = body?.trim();
  if (!trimmed || !isCommandMessage(trimmed)) return;

  if (msg.key.fromMe && !isCommandMessage(trimmed)) return;

  console.log(`[WhatsApp] Comando recebido: "${trimmed}" | grupo: ${jid}`);

  await handleWhatsAppCommand(trimmed, async (text) => {
    if (!sock) return;
    await sock.sendMessage(jid, { text });
  });
}

async function clearWhatsAppSessionFiles(): Promise<void> {
  await fs.rm(getWhatsAppAuthPath(), { recursive: true, force: true });
  console.log(`[WhatsApp] Sessao limpa em ${getWhatsAppAuthPath()}`);
}

async function destroySocket(): Promise<void> {
  const active = sock;
  sock = null;
  if (!active) return;
  try {
    active.end(undefined);
  } catch {
    /* ignore */
  }
}

function scheduleReconnect(reason: string, delayMs = 20_000): void {
  if (isInPairingGrace()) {
    console.log(
      `[WhatsApp] Reconnect adiado (${reason}) — pareamento em andamento`,
    );
    return;
  }

  cancelReconnect();
  console.warn(`[WhatsApp] Reconectando em ${delayMs / 1000}s (${reason})...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startWhatsApp();
  }, delayMs);
}

async function requestPairingCodeOnce(
  socket: WASocket,
  phone: string,
): Promise<void> {
  if (pairingCodeRequested || socket.authState.creds.registered) return;

  if (isInPairingGrace() && currentPairingCode) {
    console.log(
      `[WhatsApp] Codigo ativo: ${currentPairingCode} (aguarde, nao gera outro)`,
    );
    return;
  }

  pairingCodeRequested = true;
  isPairing = true;

  try {
    await new Promise((r) => setTimeout(r, 3000));
    const code = await socket.requestPairingCode(phone);
    currentPairingCode = code;
    startPairingGrace();
    console.log(
      `[WhatsApp] Codigo: ${code} — valido ~3 min. Digite no celular AGORA.`,
    );
  } catch (error) {
    pairingCodeRequested = false;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[WhatsApp] Falha ao gerar codigo:", message);
    console.warn(
      "[WhatsApp] Dica: no Render use WHATSAPP_PAIRING_METHOD=qr e remova WHATSAPP_PHONE_NUMBER",
    );
  }
}

async function startWhatsApp(): Promise<void> {
  if (isConnecting || isReady) return;

  const generation = ++startGeneration;
  isConnecting = true;

  const authPath = getWhatsAppAuthPath();
  const pairingMethod = resolvePairingMethod();
  const phone =
    pairingMethod === "code"
      ? normalizePhoneNumber(process.env.WHATSAPP_PHONE_NUMBER)
      : null;

  try {
    await fs.mkdir(authPath, { recursive: true });

    const { state, saveCreds: persistCreds } =
      await useMultiFileAuthState(authPath);

    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: Browsers.macOS("Chrome"),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 30_000,
    });

    if (generation !== startGeneration) return;

    sock = socket;

    socket.ev.on("creds.update", persistCreds);

    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (pairingMethod === "code" && phone && !socket.authState.creds.registered) {
          void requestPairingCodeOnce(socket, phone);
        } else {
          currentQrString = qr;
          currentQrId += 1;
          startPairingGrace();
          if (currentQrId === 1 || currentQrId % 5 === 0) {
            console.log(
              `[WhatsApp] QR #${currentQrId} — escaneie em /api/qr (valido ~60s)`,
            );
          }
        }
      }

      if (connection === "connecting") {
        isPairing = true;
      }

      if (connection === "open") {
        isReady = true;
        isPairing = false;
        pairingCodeRequested = false;
        currentQrString = null;
        currentPairingCode = null;
        clearPairingGrace();
        cancelReconnect();

        const groupId = process.env.WHATSAPP_GROUP_ID ?? "(nao configurado)";
        const prefix = process.env.WHATSAPP_COMMAND_PREFIX ?? "!";
        console.log("✅ WhatsApp conectado!");
        console.log(`💬 Grupo monitorado: ${groupId}`);
        console.log(
          `💬 Comandos: ${prefix}status | ${prefix}historico | ${prefix}jornada | ${prefix}site | ${prefix}ajuda`,
        );
      }

      if (connection === "close") {
        isReady = false;
        isConnecting = false;

        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        console.warn(
          `[WhatsApp] Conexao fechada (code=${statusCode ?? "?"})`,
          lastDisconnect?.error?.message ?? "",
        );

        if (isInPairingGrace() && !loggedOut) {
          console.log(
            "[WhatsApp] Queda durante pareamento — NAO reinicia (use o mesmo codigo/QR)",
          );
          return;
        }

        void destroySocket();

        if (loggedOut) {
          pairingCodeRequested = false;
          clearPairingGrace();
          void clearWhatsAppSessionFiles().then(() => {
            scheduleReconnect("logged_out", 15_000);
          });
          return;
        }

        scheduleReconnect("connection_close", 25_000);
      }
    });

    socket.ev.on("messages.upsert", async (m) => {
      if (m.type !== "notify" || m.messages.length === 0) return;

      for (const msg of m.messages) {
        if (!msg.message) continue;
        await handleIncomingMessage(msg);
      }
    });

    console.log(`[WhatsApp] Baileys — auth: ${authPath} | modo: ${pairingMethod}`);
    if (pairingMethod === "code" && phone) {
      console.log(`[WhatsApp] Aguardando codigo para ${maskPhoneNumber(phone)}`);
    } else {
      console.log("[WhatsApp] Aguardando QR em /api/qr");
    }

    isConnecting = false;
  } catch (error) {
    if (generation !== startGeneration) return;
    isConnecting = false;
    await destroySocket();
    const message = error instanceof Error ? error.message : String(error);
    console.error("[WhatsApp] Falha ao iniciar:", message);
    scheduleReconnect("start_error", 30_000);
  }
}

export function initWhatsAppClient(): void {
  if (!process.env.WHATSAPP_GROUP_ID?.trim()) {
    console.warn(
      "[WhatsApp] AVISO: defina WHATSAPP_GROUP_ID no Render (ex: 120363...@g.us)",
    );
  }

  const method = resolvePairingMethod();
  if (method === "code" && !normalizePhoneNumber(process.env.WHATSAPP_PHONE_NUMBER)) {
    console.warn(
      "[WhatsApp] WHATSAPP_PAIRING_METHOD=code exige WHATSAPP_PHONE_NUMBER",
    );
  }

  void startWhatsApp();
}

export async function resetWhatsAppSession(): Promise<void> {
  cancelReconnect();
  startGeneration += 1;
  pairingCodeRequested = false;
  isReady = false;
  isPairing = false;
  isConnecting = false;
  currentQrString = null;
  currentQrId = 0;
  currentPairingCode = null;
  clearPairingGrace();

  await destroySocket();
  await clearWhatsAppSessionFiles();
  void startWhatsApp();
}

export async function shutdownWhatsApp(): Promise<void> {
  cancelReconnect();
  startGeneration += 1;
  await destroySocket();
  isReady = false;
  isConnecting = false;
}

export function isWhatsAppReady(): boolean {
  return isReady;
}

export async function sendGroupMessage(message: string): Promise<void> {
  const groupId = process.env.WHATSAPP_GROUP_ID;

  if (!groupId) {
    throw new Error(
      "WHATSAPP_GROUP_ID não configurado. Defina em bot-backend/.env",
    );
  }

  if (!sock || !isReady) {
    console.warn("⚠️ WhatsApp não está pronto. Mensagem não enviada.");
    return;
  }

  await sock.sendMessage(groupId, { text: message });
  console.log(`📤 Mensagem enviada para o grupo ${groupId}`);
}
