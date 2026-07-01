import type { WASocket, proto } from "@whiskeysockets/baileys";
import { extractMessageContent } from "@whiskeysockets/baileys";
import { prisma } from "@/prisma/client";
import { danoCommand } from "@/commands/dano";
import { historicoCommand } from "@/commands/historico";
import { jornadaCommand } from "@/commands/jornada";
import { liveCommand } from "@/commands/live";
import { ajudaCommand, siteCommand } from "@/commands/site";
import { lolCommand, statusCommand } from "@/commands/status";
import type { RegisteredCommand } from "@/commands/types";

/**
 * Roteador de comandos do bot WhatsApp.
 *
 * Fluxo:
 *   1. Extrai texto de `conversation` ou `extendedTextMessage.text`.
 *   2. Valida prefixo (default `!`, override via `COMMAND_PREFIX`).
 *   3. Aceita só mensagens em grupos (`@g.us`) — DMs são ignoradas.
 *   4. Resolve contexto multi-tenant: subscription(s) com (userId, groupId).
 *   5. Encaminha para o handler registrado. Erros são isolados via try/catch.
 */

const PREFIX = process.env.COMMAND_PREFIX?.trim() || "!";
const DEBUG = process.env.COMMAND_DEBUG === "true";

function debug(...args: unknown[]): void {
  if (DEBUG) console.log("[cmd:debug]", ...args);
}

const registry: Map<string, RegisteredCommand> = new Map();

function register(cmd: RegisteredCommand, ...aliases: string[]): void {
  registry.set(cmd.meta.name, cmd);
  for (const alias of aliases) registry.set(alias, cmd);
}

register(statusCommand);
register(lolCommand);
register(historicoCommand, "history");
register(danoCommand);
register(liveCommand, "partida", "ingame");
register(jornadaCommand);
register(siteCommand);
register(ajudaCommand, "help");

/** Texto da mensagem ou `null` para tipos não-texto (image, sticker, etc.). */
function extractText(msg: proto.IWebMessageInfo): string | null {
  const content = extractMessageContent(msg.message ?? undefined);
  if (!content) return null;
  if (typeof content.conversation === "string" && content.conversation.length > 0) {
    return content.conversation;
  }
  if (typeof content.extendedTextMessage?.text === "string") {
    return content.extendedTextMessage.text;
  }
  return null;
}

interface ParsedCommand {
  name: string;
  args: string[];
}

function parseCommand(text: string): ParsedCommand | null {
  if (!text.startsWith(PREFIX)) return null;
  const stripped = text.slice(PREFIX.length).trim();
  if (!stripped) return null;
  const tokens = stripped.split(/\s+/);
  const [rawName, ...args] = tokens;
  return { name: rawName.toLowerCase(), args };
}

export async function handleCommand(
  sock: WASocket,
  msg: proto.IWebMessageInfo,
  userId: string,
): Promise<void> {
  const text = extractText(msg);
  if (!text) {
    debug("skip: sem texto", msg.key);
    return;
  }

  const parsed = parseCommand(text);
  if (!parsed) return;

  const groupId = msg.key.remoteJid;
  if (!groupId || !groupId.endsWith("@g.us")) {
    debug("skip: não é grupo", { groupId, text });
    return;
  }

  debug("comando recebido", {
    userId,
    groupId,
    command: parsed.name,
    fromMe: msg.key.fromMe,
    text,
  });

  const command = registry.get(parsed.name);
  if (!command) {
    debug("skip: comando desconhecido", parsed.name);
    return;
  }

  const subs = await prisma.subscription.findMany({
    where: { userId, whatsappGroupId: groupId },
    include: { trackedPlayer: true },
    orderBy: { createdAt: "asc" },
  });
  if (subs.length === 0) {
    debug("skip: grupo sem subscription", { userId, groupId });
    try {
      await sock.sendMessage(groupId, {
        text:
          "⚠️ Este grupo não está configurado no LoL Match Monitor.\n" +
          "Configure em /dashboard/setup (Riot ID + grupo).",
      });
    } catch {
      // ignore
    }
    return;
  }

  const trackedPlayers = subs.map((s) => s.trackedPlayer);

  try {
    await command.execute({
      sock,
      msg,
      userId,
      groupId,
      args: parsed.args,
      trackedPlayer: trackedPlayers[0],
      trackedPlayers,
    });
  } catch (err) {
    console.error(
      `[cmd:${parsed.name}] erro user=${userId} group=${groupId}:`,
      err,
    );
    const message =
      err instanceof Error ? err.message : "Erro ao consultar a Riot API";
    try {
      await sock.sendMessage(
        groupId,
        { text: `❌ *Erro*\n\n${message}` },
        { quoted: msg },
      );
    } catch {
      // ignore
    }
  }
}

/** Exposto para testes / introspecção. */
export function listRegisteredCommands(): RegisteredCommand[] {
  const seen = new Set<RegisteredCommand>();
  const unique: RegisteredCommand[] = [];
  for (const cmd of registry.values()) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    unique.push(cmd);
  }
  return unique;
}
