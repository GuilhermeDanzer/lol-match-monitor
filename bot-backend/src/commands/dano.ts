import {
  displayName,
  pickTrackedPlayers,
  replyCommand,
  replyPlayerNotFound,
} from "@/commands/shared";
import { formatDamageCommand } from "@/lib/formatMatch";
import { getLatestMeaningfulRankedMatch } from "@/services/matchQueryService";
import type { RegisteredCommand } from "@/commands/types";

/** `!dano [nome]` — breakdown de dano do time na última partida. */
export const danoCommand: RegisteredCommand = {
  meta: {
    name: "dano",
    description: "Dano do time na última partida (mini-barras por campeão).",
    usage: "!dano [nome]",
  },
  async execute(ctx) {
    const targets = pickTrackedPlayers(ctx);
    if (targets.length === 0) {
      await replyPlayerNotFound(ctx, ctx.args.join(" "));
      return;
    }

    const blocks: string[] = [];
    for (const tp of targets) {
      const match = await getLatestMeaningfulRankedMatch(tp.puuid);
      if (!match) {
        blocks.push(
          `⚔️ *${displayName(tp)}* — nenhuma partida recente encontrada.`,
        );
        continue;
      }
      blocks.push(formatDamageCommand(match, displayName(tp)));
    }

    await replyCommand(ctx, blocks.join("\n\n────────────\n\n"));
  },
};
