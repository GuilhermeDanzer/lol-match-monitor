/** Partida ranqueada registrada no histórico acumulado */
export interface JourneyMatch {
  matchId: string;
  timestamp: number;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
  damage: number;
  matchMaxDamage: number;
  gameDuration: number;
  gameMode: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  lpChange: number;
  notified: boolean;
}

export interface JourneyStore {
  matches: JourneyMatch[];
}
