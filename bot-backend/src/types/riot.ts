/** Resposta da Account-V1 ao buscar por Riot ID */
export interface RiotAccount {
  puuid: string;
  gameName: string;
  tagLine: string;
}

/** League-Entry-V4 — item do array de ligas ranqueadas */
export interface LeagueEntryV4 {
  leagueId: string;
  puuid: string;
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  hotStreak: boolean;
  veteran: boolean;
  freshBlood: boolean;
  inactive: boolean;
}

/** Snapshot simplificado do elo ranqueado Solo/Duo */
export interface RankedSnapshot {
  tier: string;
  rank: string;
  leaguePoints: number;
}

/** Elo ranqueado com estatísticas da season (League-V4) */
export interface RankedStats extends RankedSnapshot {
  wins: number;
  losses: number;
  totalGames: number;
  winRatePercent: number;
}

import type { TeamDamageEntry } from "@/types/team";

/** Metadados resumidos de uma partida (Match-V5) */
export interface MatchMetadata {
  matchId: string;
  championName: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  matchMaxDamage: number;
  gameDuration: number;
  gameCreation: number;
  gameMode: string;
  team: TeamDamageEntry[];
}

/** Resposta completa do endpoint Match-V5 */
export interface MatchDetailResponse {
  metadata: {
    matchId: string;
  };
  info: {
    gameCreation: number;
    gameDuration: number;
    gameMode: string;
    participants: MatchParticipant[];
  };
}

export interface MatchParticipant {
  puuid: string;
  championName: string;
  teamId: number;
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
  totalDamageDealtToChampions: number;
}
