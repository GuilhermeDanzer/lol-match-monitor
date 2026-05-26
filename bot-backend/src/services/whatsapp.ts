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

let sock: WASocket | null = null;
let saveCreds: (() => Promise<void>) | null = null;
let isReady = false;
let isPairing = false;
let isConnecting = false;
let currentQrString: string | null = null;
let currentQrId = 0;
let currentPairingCode: string | null = null;
let pairingCodeRequested = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

export function usesPairingCodeMode(): boolean {
  return Boolean(normalizePhoneNumber(process.env.WHATSAPP_PHONE_NUMBER));
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

export function getWhatsAppStatus(): {
  ready: boolean;
  awaitingQr: boolean;
  pairing: boolean;
  pairingCodeMode: boolean;
  pairingCode: string | null;
  phoneMasked: string | null;
  groupIdConfigured: boolean;
  authPath: string;
  qrId: number;
  engine: string;
} {
  const phone = normalizePhoneNumber(process.env.WHATSAPP_PHONE_NUMBER);
  return {
    ready: isReady,
    awaitingQr: Boolean(currentQrString),
    pairing: isPairing,
    pairingCodeMode: Boolean(phone),
    pairingCode: currentPairingCode,
    phoneMasked: phone ? maskPhoneNumber(phone) : null,
    groupIdConfigured: Boolean(process.env.WHATSAPP_GROUP_ID?.trim()),
    authPath: getWhatsAppAuthPath(),
    qrId: currentQrId,
    engine: "baileys",
  };
}

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
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

async function clearWhatsAppSessionFiles(): Promise<void> {
  await fs.rm(getWhatsAppAuthPath(), { recursive: true, force: true });
  console.log(`[WhatsApp] Sessao limpa em ${getWhatsAppAuthPath()}`);
}

function scheduleReconnect(reason: string, delayMs = 15_000): void {
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

  pairingCodeRequested = true;
  isPairing = true;

  try {
    const code = await socket.requestPairingCode(phone);
    currentPairingCode = code;
    console.log(`[WhatsApp] Codigo de pareamento: ${code} — abra /api/qr`);
  } catch (error) {
    pairingCodeRequested = false;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[WhatsApp] Falha ao gerar codigo:", message);
  }
}

async function startWhatsApp(): Promise<void> {
  if (isConnecting || isReady) return;
  isConnecting = true;

  const authPath = getWhatsAppAuthPath();
  const phone = normalizePhoneNumber(process.env.WHATSAPP_PHONE_NUMBER);

  try {
    await fs.mkdir(authPath, { recursive: true });

    const { state, saveCreds: persistCreds } =
      await useMultiFileAuthState(authPath);
    saveCreds = persistCreds;

    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: Browsers.ubuntu("LoL Match Monitor"),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });

    sock = socket;

    socket.ev.on("creds.update", persistCreds);

    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (phone && !socket.authState.creds.registered) {
          void requestPairingCodeOnce(socket, phone);
        } else {
          currentQrString = qr;
          currentQrId += 1;
          if (currentQrId === 1 || currentQrId % 5 === 0) {
            console.log(
              `[WhatsApp] QR #${currentQrId} pronto — escaneie em /api/qr`,
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
        sock = null;
        currentQrString = null;

        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        console.warn(
          `[WhatsApp] Conexao fechada (code=${statusCode ?? "?"})`,
          lastDisconnect?.error?.message ?? "",
        );

        if (loggedOut) {
          void clearWhatsAppSessionFiles().then(() => {
            pairingCodeRequested = false;
            scheduleReconnect("logged_out", 10_000);
          });
          return;
        }

        scheduleReconnect("connection_close", 15_000);
      }
    });

    socket.ev.on("messages.upsert", async (m) => {
      if (m.type !== "notify" || m.messages.length === 0) return;

      for (const msg of m.messages) {
        if (!msg.message) continue;
        await handleIncomingMessage(msg);
      }
    });

    console.log(`[WhatsApp] Baileys iniciado — auth em ${authPath}`);
    if (phone) {
      console.log(
        `[WhatsApp] Modo codigo (${maskPhoneNumber(phone)}) — aguarde /api/qr`,
      );
    }

    isConnecting = false;
  } catch (error) {
    isConnecting = false;
    sock = null;
    const message = error instanceof Error ? error.message : String(error);
    console.error("[WhatsApp] Falha ao iniciar:", message);
    scheduleReconnect("start_error", 20_000);
  }
}

export function initWhatsAppClient(): void {
  if (!process.env.WHATSAPP_GROUP_ID?.trim()) {
    console.warn(
      "[WhatsApp] AVISO: defina WHATSAPP_GROUP_ID no Render (ex: 120363...@g.us)",
    );
  }

  void startWhatsApp();
}

export async function resetWhatsAppSession(): Promise<void> {
  cancelReconnect();
  pairingCodeRequested = false;
  isReady = false;
  isPairing = false;
  isConnecting = false;
  currentQrString = null;
  currentQrId = 0;
  currentPairingCode = null;

  if (sock) {
    try {
      sock.end(undefined);
    } catch {
      /* ignore */
    }
    sock = null;
  }

  await clearWhatsAppSessionFiles();
  void startWhatsApp();
}

export async function shutdownWhatsApp(): Promise<void> {
  cancelReconnect();
  if (sock) {
    try {
      sock.end(undefined);
    } catch {
      /* ignore */
    }
    sock = null;
  }
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
