/**
 * Nomes canônicos das filas BullMQ.
 *
 * Mantém referência única para evitar typo entre Queue e Worker.
 */
export const QUEUE_NAMES = {
  CRON: "lol-cron",
  RIOT_API: "lol-riot-api",
  NOTIFY: "lol-notify",
} as const;

/** Tick do CronQueue — poll Riot (15 min) ou relatório WhatsApp (6 h). */
export interface CronTickJob {
  /** Timestamp do tick (debug). */
  tick: number;
}

/** Verificação de um TrackedPlayer na Riot API. */
export interface RiotApiCheckJob {
  trackedPlayerId: string;
  puuid: string;
}

/** @deprecated Relatórios usam `pendingAlerts` + `report-tick`; mantido p/ jobs antigos na fila. */
export interface NotifyJob {
  trackedPlayerId: string;
  matchId: string;
  /** Estado do jogador APÓS a partida (já consultado na fila Riot). */
  newMatchData: {
    matchId: string;
    championName: string;
    win: boolean;
    kills: number;
    deaths: number;
    assists: number;
    durationSeconds: number;
    gameMode: string;
    riotId: string;
  };
  /** Snapshot de elo antes/depois e lpChange (já calculado). */
  elo: {
    before: { tier: string; rank: string; leaguePoints: number } | null;
    after: { tier: string; rank: string; leaguePoints: number } | null;
    lpChange: number | null;
  };
}
