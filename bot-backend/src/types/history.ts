import type { MatchMetadata } from "@/types/riot";

export interface CurrentStats {
  elo: string;
  pdl: number;
  winStreak: number;
  winRate: number;
  tier: string;
}

export interface GraphDataPoint {
  date: string;
  timestamp: number;
  pdlNum: number;
  label: string;
}

export interface HistoryApiResponse {
  playerName: string;
  currentStats: CurrentStats;
  graphData: GraphDataPoint[];
  matches: MatchMetadata[];
}
