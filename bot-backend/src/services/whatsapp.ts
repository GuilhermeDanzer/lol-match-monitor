import { getWhatsAppAuthPath } from "@/lib/paths";
import type { Chat, Message } from "whatsapp-web.js";
import { Client, LocalAuth } from "whatsapp-web.js";
import {
  handleWhatsAppCommand,
  isCommandMessage,
} from "@/services/whatsappCommands";

let client: Client | null = null;
let isReady = false;
let currentQrString: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--no-zygote",
];

/** Versao remota do WhatsApp Web (evita tela branca / QR que nao autentica) */
const WEB_VERSION_CACHE = {
  type: "remote" as const,
  remotePath:
    "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1017054665.html",
};

export function getCurrentQrString(): string | null {
  return currentQrString;
}

export function getWhatsAppStatus(): {
  ready: boolean;
  awaitingQr: boolean;
  groupIdConfigured: boolean;
  authPath: string;
} {
  return {
    ready: isReady,
    awaitingQr: Boolean(currentQrString),
    groupIdConfigured: Boolean(process.env.WHATSAPP_GROUP_ID?.trim()),
    authPath: getWhatsAppAuthPath(),
  };
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

function scheduleReconnect(reason: string): void {
  if (reconnectTimer) return;

  console.warn(`[WhatsApp] Reconectando em 10s (${reason})...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void (async () => {
      try {
        await client?.destroy();
      } catch {
        /* ignore */
      }
      client = null;
      isReady = false;
      currentQrString = null;
      initWhatsAppClient();
    })();
  }, 10_000);
}

function createClient(): Client {
  const authPath = getWhatsAppAuthPath();
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

  return new Client({
    authStrategy: new LocalAuth({ dataPath: authPath }),
    webVersionCache: WEB_VERSION_CACHE,
    puppeteer: {
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: PUPPETEER_ARGS,
    },
  });
}

function wireClientEvents(waClient: Client): void {
  waClient.on("qr", (qr) => {
    currentQrString = qr;
    console.log(
      "[WhatsApp] QR pendente — escaneie em https://SEU-BACKEND/api/qr (atualize a cada ~20s)",
    );
  });

  waClient.on("ready", () => {
    isReady = true;
    currentQrString = null;
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
    console.log("🔐 WhatsApp autenticado com sucesso.");
  });

  waClient.on("auth_failure", (msg) => {
    console.error("❌ Falha na autenticacao do WhatsApp:", msg);
    isReady = false;
    currentQrString = null;
    scheduleReconnect("auth_failure");
  });

  waClient.on("disconnected", (reason) => {
    console.warn("⚠️ WhatsApp desconectado:", reason);
    isReady = false;
    currentQrString = null;
    scheduleReconnect(String(reason));
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
  client.initialize();
  return client;
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
