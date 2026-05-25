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

export function getCurrentQrString(): string | null {
  return currentQrString;
}

function getCommandPrefix(): string {
  return process.env.WHATSAPP_COMMAND_PREFIX ?? "!";
}

/** Verifica se a mensagem veio do grupo configurado no .env.local */
function isTargetGroup(msg: Message, chat: Chat): boolean {
  const configuredId = process.env.WHATSAPP_GROUP_ID?.trim();
  if (!configuredId) return chat.isGroup;

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

/**
 * Inicializa o cliente WhatsApp com LocalAuth (sessão em disco).
 * QR Code: acesse GET /api/qr no navegador (Render/logs não exibem ASCII).
 */
export function initWhatsAppClient(): Client {
  if (client) return client;

  const authPath = getWhatsAppAuthPath();
  console.log(`[WhatsApp] Sessão LocalAuth: ${authPath}`);

  const puppeteerArgs = ["--no-sandbox", "--disable-setuid-sandbox"];
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: authPath,
    }),
    puppeteer: {
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: puppeteerArgs,
    },
  });

  client.on("qr", (qr) => {
    currentQrString = qr;
    console.log("[WhatsApp] QR pendente. Abra GET /api/qr no navegador para escanear.");
  });

  client.on("ready", () => {
    isReady = true;
    currentQrString = null;
    const prefix = getCommandPrefix();
    const groupId = process.env.WHATSAPP_GROUP_ID ?? "(não configurado)";
    console.log("✅ WhatsApp conectado!");
    console.log(`💬 Grupo monitorado: ${groupId}`);
    console.log(
      `💬 Comandos: ${prefix}status | ${prefix}historico | ${prefix}jornada | ${prefix}site | ${prefix}ajuda`,
    );
  });

  client.on("message_create", (msg) => {
    void onIncomingMessage(msg);
  });

  client.on("authenticated", () => {
    console.log("🔐 WhatsApp autenticado com sucesso.");
  });

  client.on("auth_failure", (msg) => {
    console.error("❌ Falha na autenticação do WhatsApp:", msg);
    isReady = false;
    currentQrString = null;
  });

  client.on("disconnected", (reason) => {
    console.warn("⚠️ WhatsApp desconectado:", reason);
    isReady = false;
    currentQrString = null;
  });

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
