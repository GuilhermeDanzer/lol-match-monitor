/** Partida ativa — Spectator-V5 */
export interface SpectatorActiveGame {
  gameId: number;
  mapId: number;
  gameMode: string;
  gameType: string;
  gameQueueConfigId: number;
  gameStartTime: number;
  gameLength?: number;
  participants: SpectatorParticipant[];
}

export interface SpectatorParticipant {
  puuid: string;
  championId: number;
  teamId: number;
  spell1Id: number;
  spell2Id: number;
  bot: boolean;
}

export interface LiveGameSnapshot {
  gameMode: string;
  queueLabel: string;
  elapsedSeconds: number;
  playerChampion: string;
  allies: string[];
  enemies: string[];
}
