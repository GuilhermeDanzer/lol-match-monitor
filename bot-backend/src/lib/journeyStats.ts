import type { JourneyMatch } from "@/types/journey";

export function calculateMaxWinStreak(matches: JourneyMatch[]): number {
  const sorted = [...matches].sort((a, b) => a.timestamp - b.timestamp);
  let max = 0;
  let current = 0;

  for (const match of sorted) {
    if (match.win) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }

  return max;
}

/** Estatísticas agregadas do histórico monitorado */
export function summarizeJourneyMatches(matches: JourneyMatch[]): {
  total: number;
  wins: number;
  losses: number;
  winRatePercent: number;
  lpBalance: number;
} {
  const total = matches.length;
  const wins = matches.filter((m) => m.win).length;
  const losses = total - wins;
  const winRatePercent = total > 0 ? Math.round((wins / total) * 100) : 0;
  const lpBalance = matches.reduce((sum, m) => sum + m.lpChange, 0);

  return { total, wins, losses, winRatePercent, lpBalance };
}
