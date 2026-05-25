/** Formato compacto para WhatsApp (ex: 25400 → "25.4k") */
export function formatDamageCompact(damage: number): string {
  if (damage >= 1000) {
    return `${(damage / 1000).toFixed(1)}k`;
  }
  return String(damage);
}

/** Formato absoluto para UI (ex: 25432 → "25.432") */
export function formatDamageAbsolute(damage: number): string {
  return damage.toLocaleString("pt-BR");
}

/** Porcentagem da barra de dano (limitada a 100%) */
export function getDamageBarPercent(
  damage: number,
  matchMaxDamage: number,
): number {
  if (matchMaxDamage <= 0) return 0;
  return Math.min(100, (damage / matchMaxDamage) * 100);
}
