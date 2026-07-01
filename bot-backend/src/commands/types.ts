import type { TrackedPlayer } from "@prisma/client";
import type { WASocket, proto } from "@whiskeysockets/baileys";

/**
 * Contexto resolvido entregue a cada handler de comando.
 *
 * - `userId`: dono do socket (multi-tenant).
 * - `groupId`: JID do grupo onde a mensagem foi enviada (sempre `@g.us`).
 * - `args`: tokens após o nome do comando, ex: `!status faker` -> `["faker"]`.
 * - `trackedPlayer`: primeiro jogador rastreado neste grupo (caso default).
 * - `trackedPlayers`: TODOS os jogadores rastreados neste grupo — útil para
 *   comandos que listam (ex: `!status` sem args).
 */
export interface CommandContext {
  sock: WASocket;
  msg: proto.IWebMessageInfo;
  userId: string;
  groupId: string;
  args: string[];
  trackedPlayer: TrackedPlayer;
  trackedPlayers: TrackedPlayer[];
}

/**
 * Função executora de um comando. Resolve quando o reply foi despachado.
 * Erros lançados são logados pelo router mas NÃO derrubam o listener.
 */
export type CommandHandler = (ctx: CommandContext) => Promise<void>;

/** Metadados opcionais para `!help` listar comandos disponíveis. */
export interface CommandMeta {
  name: string;
  description: string;
  usage?: string;
}

export interface RegisteredCommand {
  meta: CommandMeta;
  execute: CommandHandler;
}
