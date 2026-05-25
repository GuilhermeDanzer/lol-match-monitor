import {
  getPersistentDataDir,
  getWhatsAppAuthPath,
  getWhatsAppCachePath,
} from "@/lib/paths";
import fs from "fs/promises";
import type { Chat, Message } from "whatsapp-web.js";
import { Client, LocalAuth } from "whatsapp-web.js";
import {
  handleWhatsAppCommand,
  isCommandMessage,
} from "@/services/whatsappCommands";

let client: Client | null = null;
let isReady = false;
let isPairing = false;
let isAuthenticated = false;
let currentQrString: string | null = null;
let currentQrId = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let initGeneration = 0;

const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--no-zygote",
];

export function getCurrentQrString(): string | null {
  return currentQrString;
}

export function getCurrentQrId(): number {
  return currentQrId;
}

export function getWhatsAppStatus(): {
  ready: boolean;
  awaitingQr: boolean;
  pairing: boolean;
  groupIdConfigured: boolean;
  authPath: string;
  qrId: number;
} {
  return {
    ready: isReady,
    awaitingQr: Boolean(currentQrString),
    pairing: isPairing,
    groupIdConfigured: Boolean(process.env.WHATSAPP_GROUP_ID?.trim()),
    authPath: getWhatsAppAuthPath(),
    qrId: currentQrId,
  };
}

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function getCommandPrefix(): string {
  return process.env.WHATSAPP_COMMAND_PREFIX ?? "!";
}

function isTargetGroup(msg: Message, chat: Chat): boolean {
  const configuredId = process.env.WHATSAPP_GROUP_ID?.trim();
  if (!configuredId) {
    console.warn(
      "[WhatsApp] WHATSAPP_GROUP_ID nao configurado — comandos em qualquer grupo.",
    );
    return chat.isGroup;
  }

  const chatId = chat.id._serialized;
  return (
    chat.isGroup &&
    (chatId === configuredId || msg.from === configuredId)
  );
}

async function replyInChat(msg: Message, chat: Chat, text: string): Promise<void> {
  try {
    await msg.reply(text);
  } catch {
    if (client) {
      await client.sendMessage(chat.id._serialized, text);
    }
  }
}

async function onIncomingMessage(msg: Message): Promise<void> {
  const body = msg.body?.trim();
  if (!body) return;

  const chat = await msg.getChat();
  if (!chat.isGroup) return;

  if (!isTargetGroup(msg, chat)) {
    return;
  }

  if (msg.fromMe && !isCommandMessage(body)) {
    return;
  }

  if (!isCommandMessage(body)) {
    return;
  }

  console.log(
    `[WhatsApp] Comando recebido: "${body}" | grupo: ${chat.name ?? chat.id._serialized}`,
  );

  await handleWhatsAppCommand(body, (text) => replyInChat(msg, chat, text));
}

async function clearWhatsAppSessionFiles(): Promise<void> {
  const authPath = getWhatsAppAuthPath();
  const cachePath = getWhatsAppCachePath();
  await fs.rm(authPath, { recursive: true, force: true });
  await fs.rm(cachePath, { recursive: true, force: true });
  console.log(`[WhatsApp] Sessao limpa em ${getPersistentDataDir()}`);
}

async function destroyClientSafely(): Promise<void> {
  const active = client;
  client = null;
  if (!active) return;

  try {
    await active.destroy();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[WhatsApp] destroy ignorado:", message);
  }
}

function scheduleReconnect(
  reason: string,
  options?: { resetSession?: boolean; delayMs?: number },
): void {
  cancelReconnect();

  const delayMs = options?.delayMs ?? 20_000;
  const resetSession = options?.resetSession ?? false;

  console.warn(
    `[WhatsApp] Reconectando em ${delayMs / 1000}s (${reason}, reset=${resetSession})...`,
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void (async () => {
      const generation = ++initGeneration;
      await destroyClientSafely();

      isReady = false;
      currentQrString = null;

      if (resetSession) {
        await clearWhatsAppSessionFiles();
        isPairing = false;
        isAuthenticated = false;
      }

      if (generation !== initGeneration) return;
      initWhatsAppClient();
    })();
  }, delayMs);
}

function createClient(): Client {
  const authPath = getWhatsAppAuthPath();
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

  return new Client({
    authStrategy: new LocalAuth({ dataPath: authPath }),
    takeoverOnConflict: true,
    bypassCSP: true,
    authTimeoutMs: 120_000,
    puppeteer: {
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: PUPPETEER_ARGS,
    },
  });
}

function wireClientEvents(waClient: Client): void {
  waClient.on("qr", (qr) => {
    isPairing = false;
    isAuthenticated = false;
    currentQrString = qr;
    currentQrId += 1;
    console.log(`[WhatsApp] QR #${currentQrId} pronto — escaneie em /api/qr`);
  });

  waClient.on("loading_screen", (percent, message) => {
    isPairing = true;
    cancelReconnect();
    console.log(`[WhatsApp] Carregando ${percent}% — ${message}`);
  });

  waClient.on("ready", () => {
    isReady = true;
    isPairing = false;
    isAuthenticated = false;
    currentQrString = null;
    cancelReconnect();

    const prefix = getCommandPrefix();
    const groupId = process.env.WHATSAPP_GROUP_ID ?? "(nao configurado)";
    console.log("✅ WhatsApp conectado!");
    console.log(`💬 Grupo monitorado: ${groupId}`);
    console.log(
      `💬 Comandos: ${prefix}status | ${prefix}historico | ${prefix}jornada | ${prefix}site | ${prefix}ajuda`,
    );
  });

  waClient.on("message_create", (msg) => {
    void onIncomingMessage(msg);
  });

  waClient.on("authenticated", () => {
    isAuthenticated = true;
    isPairing = true;
    cancelReconnect();
    console.log("🔐 WhatsApp autenticado com sucesso.");
  });

  waClient.on("auth_failure", (msg) => {
    console.error("❌ Falha na autenticacao do WhatsApp:", msg);
    isReady = false;
    isPairing = false;
    isAuthenticated = false;
    currentQrString = null;
    scheduleReconnect("auth_failure", { resetSession: true, delayMs: 30_000 });
  });

  waClient.on("disconnected", (reason) => {
    console.warn("⚠️ WhatsApp desconectado:", reason);
    const wasReady = isReady;
    isReady = false;
    currentQrString = null;

    if (wasReady) {
      isPairing = false;
      isAuthenticated = false;
      scheduleReconnect(String(reason), { resetSession: false, delayMs: 15_000 });
      return;
    }

    if (isPairing || isAuthenticated) {
      console.log(
        "[WhatsApp] Desconexao durante pareamento — mantendo sessao salva, reconectando...",
      );
      isPairing = true;
      scheduleReconnect(String(reason), { resetSession: false, delayMs: 15_000 });
      return;
    }

    scheduleReconnect(String(reason), { resetSession: false, delayMs: 30_000 });
  });
}

/**
 * Inicializa o cliente WhatsApp com LocalAuth (sessao em disco).
 * QR Code: GET /api/qr no navegador.
 */
export function initWhatsAppClient(): Client {
  if (client) return client;

  const authPath = getWhatsAppAuthPath();
  console.log(`[WhatsApp] Sessao LocalAuth: ${authPath}`);

  if (!process.env.WHATSAPP_GROUP_ID?.trim()) {
    console.warn(
      "[WhatsApp] AVISO: defina WHATSAPP_GROUP_ID no Render (ex: 120363...@g.us)",
    );
  }

  client = createClient();
  wireClientEvents(client);
  void client.initialize().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[WhatsApp] Falha ao inicializar:", message);
    client = null;
    if (!isPairing && !isAuthenticated) {
      scheduleReconnect("initialize_error", { resetSession: false, delayMs: 30_000 });
    }
  });
  return client;
}

export async function resetWhatsAppSession(): Promise<void> {
  cancelReconnect();
  const generation = ++initGeneration;

  isReady = false;
  isPairing = false;
  isAuthenticated = false;
  currentQrString = null;
  currentQrId = 0;

  await destroyClientSafely();
  if (generation !== initGeneration) return;

  await clearWhatsAppSessionFiles();
  initWhatsAppClient();
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

  if (!client || !isReady) {
    console.warn("⚠️ WhatsApp não está pronto. Mensagem não enviada.");
    return;
  }

  await client.sendMessage(groupId, message);
  console.log(`📤 Mensagem enviada para o grupo ${groupId}`);
}
