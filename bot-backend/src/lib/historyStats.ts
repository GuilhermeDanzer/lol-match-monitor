import {
  calculateCurrentWinStreak,
  getAllJourneyMatches,
  summarizeJourneyMatches,
} from "@/lib/journeyStore";
import { ensureJourneyBackfilled } from "@/lib/journeyBackfill";
import {
  computePdlNumeric,
  formatGraphTierLabel,
  rollbackRankedSnapshot,
} from "@/lib/lpCalculator";
import type { RankedSnapshot } from "@/types/riot";
import { getCurrentRankedStats, getPlayerPuuid } from "@/services/riot";
import type { GraphDataPoint, HistoryApiResponse } from "@/types/history";
import type { JourneyMatch } from "@/types/journey";
import type { MatchMetadata } from "@/types/riot";

function formatGraphDate(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

const GAME_MODE_LABELS: Record<string, string> = {
  CLASSIC: "Solo/Duo",
  ARAM: "ARAM",
  CHERRY: "Arena",
};

function journeyToMatchMetadata(match: JourneyMatch): MatchMetadata {
  return {
    matchId: match.matchId,
    championName: match.championName,
    win: match.win,
    kills: match.kills,
    deaths: match.deaths,
    assists: match.assists,
    damage: match.damage,
    matchMaxDamage: match.matchMaxDamage,
    gameDuration: match.gameDuration,
    gameCreation: match.timestamp,
    gameMode: GAME_MODE_LABELS[match.gameMode] ?? match.gameMode,
  };
}

function snapshotFromMatch(m: JourneyMatch): RankedSnapshot | null {
  if (!m.tier || m.leaguePoints < 0) return null;
  return {
    tier: m.tier,
    rank: m.rank || "IV",
    leaguePoints: m.leaguePoints,
  };
}

function buildGraphDataFromStored(matches: JourneyMatch[]): GraphDataPoint[] {
  const withElo = matches.filter((m) => snapshotFromMatch(m));
  const sorted = [...withElo].sort((a, b) => a.timestamp - b.timestamp);

  return sorted.map((m) => {
    const snap = snapshotFromMatch(m)!;
    return {
      date: formatGraphDate(m.timestamp),
      timestamp: m.timestamp,
      pdlNum: computePdlNumeric(snap.tier, snap.rank, snap.leaguePoints),
      label: formatGraphTierLabel(snap.tier, snap.rank, snap.leaguePoints),
    };
  });
}

/** Reconstrói elo retroativo a partir do PDL atual e lpChange das partidas */
function buildGraphDataReconstructed(
  matches: JourneyMatch[],
  current: RankedSnapshot,
): GraphDataPoint[] {
  const sorted = [...matches]
    .filter((m) => m.timestamp > 0)
    .sort((a, b) => b.timestamp - a.timestamp);

  let state: RankedSnapshot = { ...current };
  const points: GraphDataPoint[] = [];

  for (const match of sorted) {
    const stored = snapshotFromMatch(match);
    const snap = stored ?? state;

    points.unshift({
      date: formatGraphDate(match.timestamp),
      timestamp: match.timestamp,
      pdlNum: computePdlNumeric(snap.tier, snap.rank, snap.leaguePoints),
      label: formatGraphTierLabel(snap.tier, snap.rank, snap.leaguePoints),
    });

    if (stored) {
      state = stored;
    } else {
      const delta =
        match.lpChange !== 0 ? match.lpChange : match.win ? 18 : -18;
      state = rollbackRankedSnapshot(state, delta);
    }
  }

  return points;
}

function buildGraphData(
  matches: JourneyMatch[],
  current: RankedSnapshot | null,
): GraphDataPoint[] {
  const stored = buildGraphDataFromStored(matches);
  if (stored.length >= 2) return stored;
  if (current) {
    const reconstructed = buildGraphDataReconstructed(matches, current);
    if (reconstructed.length >= 2) return reconstructed;
    if (reconstructed.length === 1) return reconstructed;
  }
  return stored;
}

/** Monta resposta completa do GET /api/history */
export async function buildHistoryResponse(
  playerName: string,
): Promise<HistoryApiResponse> {
  await ensureJourneyBackfilled();

  const puuid = await getPlayerPuuid();
  const [journeyMatches, rankedStats] = await Promise.all([
    getAllJourneyMatches(),
    getCurrentRankedStats(puuid),
  ]);

  const sortedMatches = [...journeyMatches].sort(
    (a, b) => b.timestamp - a.timestamp,
  );
  const summary = summarizeJourneyMatches(journeyMatches);
  const winStreak = calculateCurrentWinStreak(journeyMatches);

  const currentSnapshot: RankedSnapshot | null = rankedStats
    ? {
        tier: rankedStats.tier,
        rank: rankedStats.rank,
        leaguePoints: rankedStats.leaguePoints,
      }
    : null;

  let graphData = buildGraphData(journeyMatches, currentSnapshot);

  if (currentSnapshot) {
    const currentPoint: GraphDataPoint = {
      date: formatGraphDate(Date.now()),
      timestamp: Date.now(),
      pdlNum: computePdlNumeric(
        currentSnapshot.tier,
        currentSnapshot.rank,
        currentSnapshot.leaguePoints,
      ),
      label: formatGraphTierLabel(
        currentSnapshot.tier,
        currentSnapshot.rank,
        currentSnapshot.leaguePoints,
      ),
    };

    const last = graphData[graphData.length - 1];
    if (!last || last.pdlNum !== currentPoint.pdlNum) {
      graphData = [...graphData, currentPoint];
    }
  }

  const tier = rankedStats?.tier ?? "UNRANKED";
  const rank = rankedStats?.rank ?? "";
  const pdl = rankedStats?.leaguePoints ?? 0;
  const eloLabel =
    tier === "UNRANKED"
      ? "Sem elo"
      : rank
        ? `${tier} ${rank}`
        : tier;

  return {
    playerName,
    currentStats: {
      elo: eloLabel,
      pdl,
      winStreak,
      winRate: summary.winRatePercent,
      tier,
    },
    graphData,
    matches: sortedMatches.slice(0, 50).map(journeyToMatchMetadata),
  };
}
