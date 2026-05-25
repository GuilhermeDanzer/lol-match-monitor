/** Dano a campeões de um membro do time na partida */
export interface TeamDamageEntry {
  championName: string;
  damageDealt: number;
  isPlayer: boolean;
}
