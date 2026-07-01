import { formatExtendedWhatsAppMessage } from "@/lib/formatMatch";
import {
  formatEloCompactLabel,
  formatEloProgression,
} from "@/lib/lpCalculator";
import { getLatestMeaningfulRankedMatch } from "@/services/matchQueryService";
import {
  getCurrentRankedStats,
  getMatchesCountLastHours,
} from "@/services/riot";
import { readSnapshot } from "@/services/trackedPlayerService";
import type { TrackedPlayer } from "@prisma/client";
import type { RankedSnapshot } from "@/types/riot";

const MATCHES_WINDOW_HOURS = 6;

function snapshotToRankedBefore(tp: TrackedPlayer): RankedSnapshot | null {
  const snap = readSnapshot(tp);
  if (snap.rankedBeforeLastMatch?.tier) {
    return {
      tier: snap.rankedBeforeLastMatch.tier,
      rank: snap.rankedBeforeLastMatch.rank ?? "IV",
      leaguePoints: snap.rankedBeforeLastMatch.leaguePoints ?? 0,
    };
  }
  if (!snap.tier || snap.leaguePoints == null) return null;
  return {
    tier: snap.tier,
    rank: snap.rank ?? "IV",
    leaguePoints: snap.leaguePoints,
  };
}

/** Monta a resposta rica do `!status` / `!lol` para um TrackedPlayer. */
export async function buildLiveStatusMessage(
  tp: TrackedPlayer,
): Promise<string> {
  const displayName = tp.riotId;

  const [match, rankedStats, matchesLast6h] = await Promise.all([
    getLatestMeaningfulRankedMatch(tp.puuid),
    getCurrentRankedStats(tp.puuid),
    getMatchesCountLastHours(tp.puuid, MATCHES_WINDOW_HOURS),
  ]);

  if (!match) {
    return `⚔️ *${displayName}* — nenhuma partida recente encontrada.`;
  }

  const rankedBefore = snapshotToRankedBefore(tp);
  const progression =
    rankedBefore && rankedStats
      ? formatEloProgression(rankedBefore, rankedStats)
      : rankedStats
        ? {
            kind: "held" as const,
            label: `Manteve ${formatEloCompactLabel(rankedStats)}`,
          }
        : null;

  return formatExtendedWhatsAppMessage(match, {
    displayName,
    rankedBefore,
    rankedAfter: rankedStats,
    rankedStats,
    matchesLast6h,
    eloProgression: progression?.label ?? null,
  });
}
