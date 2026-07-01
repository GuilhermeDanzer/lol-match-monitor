import {
  displayName,
  pickTrackedPlayers,
  replyCommand,
  replyPlayerNotFound,
} from "@/commands/shared";
import { formatJourneyCommand } from "@/lib/formatMatch";
import { buildJourneyFromRecentMatches } from "@/services/matchQueryService";
import { getCurrentRankedStats } from "@/services/riot";
import type { RegisteredCommand } from "@/commands/types";

/**
 * `!jornada [nome]`
 *
 * Agrega partidas ranqueadas recentes (Match-V5 + MatchCache) para montar
 * win rate, streak e status atual — equivalente ao journey.json legado.
 */
export const jornadaCommand: RegisteredCommand = {
  meta: {
    name: "jornada",
    description: "Estatísticas da temporada monitorada (W/L, streak, elo).",
    usage: "!jornada [nome]",
  },
  async execute(ctx) {
    const targets = pickTrackedPlayers(ctx);
    if (targets.length === 0) {
      await replyPlayerNotFound(ctx, ctx.args.join(" "));
      return;
    }

    const blocks: string[] = [];
    for (const tp of targets) {
      const [matches, rankedStats] = await Promise.all([
        buildJourneyFromRecentMatches(tp.puuid),
        getCurrentRankedStats(tp.puuid),
      ]);
      blocks.push(
        formatJourneyCommand({
          displayName: displayName(tp),
          matches,
          rankedStats,
        }),
      );
    }

    await replyCommand(ctx, blocks.join("\n\n────────────\n\n"));
  },
};
