import { getWhatsAppAuthPath } from "@/lib/paths";
import qrcode from "qrcode-terminal";
import type { Chat, Message } from "whatsapp-web.js";
import { Client, LocalAuth } from "whatsapp-web.js";
import {
  handleWhatsAppCommand,
  isCommandMessage,
} from "@/services/whatsappCommands";

let client: Client | null = null;
let isReady = false;

function getCommandPrefix(): string {
  return process.env.WHATSAPP_COMMAND_PREFIX ?? "!";
}

/** Verifica se a mensagem veio do grupo configurado no .env.local */
function isTargetGroup(msg: Message, chat: Chat): boolean {
  const configuredId = process.env.WHATSAPP_GROUP_ID?.trim();
  if (!configuredId) return chat.isGroup;

  const chatId = chat.id._serialized;
  // Em grupos, msg.from também costuma ser o ID do grupo (@g.us)
  return (
    chat.isGroup &&
    (chatId === configuredId || msg.from === configuredId)
  );
}

async function replyInChat(msg: Message, chat: Chat, text: string): Promise<void> {
  try {
    await msg.reply(text);
  } catch {
    // Fallback se reply falhar no grupo
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

  // Mensagens enviadas pela própria conta (fromMe) são ignoradas,
  // EXCETO comandos — assim você pode testar digitando !status no grupo.
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
 * Caminho: {PERSISTENT_DATA_DIR}/.wwebjs_auth — configure volume no Railway/Render
 * para não precisar escanear o QR Code a cada deploy.
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
    console.log("\n📱 Escaneie o QR Code abaixo com o WhatsApp:\n");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    isReady = true;
    const prefix = getCommandPrefix();
    const groupId = process.env.WHATSAPP_GROUP_ID ?? "(não configurado)";
    console.log("✅ WhatsApp conectado!");
    console.log(`💬 Grupo monitorado: ${groupId}`);
    console.log(`💬 Comandos: ${prefix}status | ${prefix}historico | ${prefix}jornada | ${prefix}ajuda`);
  });

  // message_create captura TODAS as mensagens, inclusive as que você mesmo envia
  client.on("message_create", (msg) => {
    void onIncomingMessage(msg);
  });

  client.on("authenticated", () => {
    console.log("🔐 WhatsApp autenticado com sucesso.");
  });

  client.on("auth_failure", (msg) => {
    console.error("❌ Falha na autenticação do WhatsApp:", msg);
    isReady = false;
  });

  client.on("disconnected", (reason) => {
    console.warn("⚠️ WhatsApp desconectado:", reason);
    isReady = false;
  });

  client.initialize();
  return client;
}

/** Verifica se o bot está pronto para enviar mensagens */
export function isWhatsAppReady(): boolean {
  return isReady;
}

/** Envia uma mensagem de texto para o grupo configurado no .env.local */
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
