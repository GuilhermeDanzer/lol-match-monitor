/** Aguarda N milissegundos (usado antes de consultar PDL pós-partida) */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Delay configurável para atualização de PDL na Riot (padrão: 90s) */
export function getRankedUpdateDelayMs(): number {
  const seconds = parseInt(
    process.env.RIOT_RANKED_DELAY_SECONDS ?? "90",
    10,
  );
  const clamped = Math.min(120, Math.max(60, Number.isNaN(seconds) ? 90 : seconds));
  return clamped * 1000;
}
