import type { TrackedPlayer } from "@prisma/client";
import type { CommandContext } from "@/commands/types";

export function pickTrackedPlayers(ctx: CommandContext): TrackedPlayer[] {
  if (ctx.args.length === 0) return ctx.trackedPlayers;
  const query = ctx.args.join(" ").toLowerCase();
  return ctx.trackedPlayers.filter((tp) =>
    tp.riotId.toLowerCase().includes(query),
  );
}

export function displayName(tp: TrackedPlayer): string {
  return tp.riotId;
}

export async function replyCommand(
  ctx: CommandContext,
  text: string,
): Promise<void> {
  await ctx.sock.sendMessage(
    ctx.groupId,
    { text },
    { quoted: ctx.msg },
  );
}

export async function replyPlayerNotFound(
  ctx: CommandContext,
  query: string,
): Promise<void> {
  await replyCommand(
    ctx,
    `Nenhum jogador rastreado neste grupo bate com "${query}".`,
  );
}
