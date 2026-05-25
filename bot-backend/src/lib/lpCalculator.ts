import type { RankedSnapshot } from "@/types/riot";

const TIER_ORDER = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const;

const RANK_ORDER = ["IV", "III", "II", "I"] as const;

/** Peso numérico por tier (IRON=1 … CHALLENGER=10) para comparar progressão */
const TIER_WEIGHT: Record<string, number> = {
  IRON: 1,
  BRONZE: 2,
  SILVER: 3,
  GOLD: 4,
  PLATINUM: 5,
  EMERALD: 6,
  DIAMOND: 7,
  MASTER: 8,
  GRANDMASTER: 9,
  CHALLENGER: 10,
};

/** Peso numérico por divisão (IV=1 … I=4) */
const RANK_WEIGHT: Record<string, number> = {
  IV: 1,
  III: 2,
  II: 3,
  I: 4,
};

const RANK_NUMERIC: Record<string, number> = {
  IV: 4,
  III: 3,
  II: 2,
  I: 1,
};

const TIER_PT: Record<string, string> = {
  IRON: "Ferro",
  BRONZE: "Bronze",
  SILVER: "Prata",
  GOLD: "Ouro",
  PLATINUM: "Platina",
  EMERALD: "Esmeralda",
  DIAMOND: "Diamante",
  MASTER: "Mestre",
  GRANDMASTER: "Grão-Mestre",
  CHALLENGER: "Desafiante",
};

const HIGH_ELO_TIERS = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

/** Valor numérico para comparar divisões (maior = elo mais alto) */
function divisionValue(tier: string, rank: string): number {
  const tierIndex = TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number]);
  if (tierIndex < 0) return -1;

  if (HIGH_ELO_TIERS.has(tier)) {
    return tierIndex * 400 + 300;
  }

  const rankIndex = RANK_ORDER.indexOf(rank as (typeof RANK_ORDER)[number]);
  return tierIndex * 400 + (rankIndex >= 0 ? rankIndex * 100 : 0);
}

/** Ex: "GOLD" + "IV" → "Ouro IV" */
export function formatEloLabel(snapshot: RankedSnapshot): string {
  const tierName = TIER_PT[snapshot.tier] ?? snapshot.tier;

  if (HIGH_ELO_TIERS.has(snapshot.tier)) {
    return tierName;
  }

  return `${tierName} ${snapshot.rank}`;
}

/** Ex: "GOLD" + "III" → "Ouro 3" (tier em PT + divisão numérica) */
export function formatEloCompactLabel(snapshot: RankedSnapshot): string {
  const tierName = TIER_PT[snapshot.tier] ?? snapshot.tier;

  if (HIGH_ELO_TIERS.has(snapshot.tier)) {
    return tierName;
  }

  const division = RANK_NUMERIC[snapshot.rank] ?? snapshot.rank;
  return `${tierName} ${division}`;
}

/**
 * PDL numérico para gráficos: TierBase + RankBase + LP
 * IRON=0 … CHALLENGER=3600 | IV=0, III=100, II=200, I=300
 */
const TIER_BASE: Record<string, number> = {
  IRON: 0,
  BRONZE: 400,
  SILVER: 800,
  GOLD: 1200,
  PLATINUM: 1600,
  EMERALD: 2000,
  DIAMOND: 2400,
  MASTER: 2800,
  GRANDMASTER: 3200,
  CHALLENGER: 3600,
};

const RANK_BASE: Record<string, number> = {
  IV: 0,
  III: 100,
  II: 200,
  I: 300,
};

export function computePdlNumeric(
  tier: string,
  rank: string,
  leaguePoints: number,
): number {
  const tierBase = TIER_BASE[tier] ?? 0;

  if (HIGH_ELO_TIERS.has(tier)) {
    return tierBase + leaguePoints;
  }

  const rankBase = RANK_BASE[rank] ?? 0;
  return tierBase + rankBase + leaguePoints;
}

const TIER_LETTER: Record<string, string> = {
  IRON: "I",
  BRONZE: "B",
  SILVER: "S",
  GOLD: "G",
  PLATINUM: "P",
  EMERALD: "E",
  DIAMOND: "D",
  MASTER: "M",
  GRANDMASTER: "GM",
  CHALLENGER: "C",
};

/** Rótulo curto para gráfico (ex: "G3 27LP") */
export function formatGraphTierLabel(
  tier: string,
  rank: string,
  leaguePoints: number,
): string {
  if (HIGH_ELO_TIERS.has(tier)) {
    return `${TIER_LETTER[tier] ?? tier} ${leaguePoints}LP`;
  }

  const division = RANK_NUMERIC[rank] ?? rank;
  return `${TIER_LETTER[tier] ?? tier[0]}${division} ${leaguePoints}LP`;
}

/** Valor comparável do elo (tier + divisão) para detectar subida/queda */
export function eloNumericValue(tier: string, rank: string): number {
  const tierWeight = TIER_WEIGHT[tier] ?? 0;

  if (HIGH_ELO_TIERS.has(tier)) {
    return tierWeight * 10;
  }

  return tierWeight * 10 + (RANK_WEIGHT[rank] ?? 0);
}

function stepRankUp(tier: string, rank: string): RankedSnapshot | null {
  if (HIGH_ELO_TIERS.has(tier)) return null;

  const rankIdx = RANK_ORDER.indexOf(rank as (typeof RANK_ORDER)[number]);
  if (rankIdx > 0) {
    return { tier, rank: RANK_ORDER[rankIdx - 1], leaguePoints: 0 };
  }

  const tierIdx = TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number]);
  if (tierIdx < 0 || tierIdx >= TIER_ORDER.length - 1) return null;

  const nextTier = TIER_ORDER[tierIdx + 1];
  if (HIGH_ELO_TIERS.has(nextTier)) {
    return { tier: nextTier, rank: "", leaguePoints: 0 };
  }

  return { tier: nextTier, rank: "IV", leaguePoints: 0 };
}

function stepRankDown(tier: string, rank: string): RankedSnapshot | null {
  if (HIGH_ELO_TIERS.has(tier)) return null;

  const rankIdx = RANK_ORDER.indexOf(rank as (typeof RANK_ORDER)[number]);
  if (rankIdx >= 0 && rankIdx < RANK_ORDER.length - 1) {
    return { tier, rank: RANK_ORDER[rankIdx + 1], leaguePoints: 0 };
  }

  const tierIdx = TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number]);
  if (tierIdx <= 0) return null;

  return { tier: TIER_ORDER[tierIdx - 1], rank: "I", leaguePoints: 0 };
}

/** Estado de elo antes de uma partida (reverte lpChange) */
export function rollbackRankedSnapshot(
  after: RankedSnapshot,
  lpChange: number,
): RankedSnapshot {
  if (lpChange === 0) return after;

  if (HIGH_ELO_TIERS.has(after.tier)) {
    return {
      ...after,
      leaguePoints: Math.max(0, after.leaguePoints - lpChange),
    };
  }

  let { tier, rank, leaguePoints } = after;
  let lp = leaguePoints - lpChange;

  while (lp < 0) {
    const demoted = stepRankDown(tier, rank);
    if (!demoted) break;
    ({ tier, rank } = demoted);
    lp += 100;
  }

  while (lp > 100) {
    const promoted = stepRankUp(tier, rank);
    if (!promoted) break;
    ({ tier, rank } = promoted);
    lp -= 100;
  }

  return {
    tier,
    rank,
    leaguePoints: Math.max(0, Math.min(100, lp)),
  };
}

export type EloProgressionKind = "promoted" | "demoted" | "held";

export interface EloProgressionResult {
  kind: EloProgressionKind;
  label: string;
}

/**
 * Compara elo anterior e atual e retorna rótulo de progressão.
 * Ex: "Subiu de Ouro 3 para Ouro 2 📈" | "Manteve Ouro 3"
 */
export function formatEloProgression(
  before: RankedSnapshot,
  after: RankedSnapshot,
): EloProgressionResult {
  const beforeLabel = formatEloCompactLabel(before);
  const afterLabel = formatEloCompactLabel(after);
  const beforeValue = eloNumericValue(before.tier, before.rank);
  const afterValue = eloNumericValue(after.tier, after.rank);

  if (afterValue > beforeValue) {
    return {
      kind: "promoted",
      label: `Subiu de ${beforeLabel} para ${afterLabel} 📈`,
    };
  }

  if (afterValue < beforeValue) {
    return {
      kind: "demoted",
      label: `Caiu de ${beforeLabel} para ${afterLabel} 📉`,
    };
  }

  return {
    kind: "held",
    label: `Manteve ${afterLabel}`,
  };
}

export interface LpChangeResult {
  currentLp: number;
  /** Linha exibida após "PDL:" — ex: "45 (-15 PDL)" */
  lpLine: string;
  delta: number | null;
}

/**
 * Calcula variação de PDL comparando snapshot anterior e atual.
 * Promoções/rebaixamentos usam estimativa quando a divisão muda.
 */
export function calculateLpChange(
  before: RankedSnapshot | null,
  after: RankedSnapshot,
  won: boolean,
): LpChangeResult {
  if (!before) {
    return {
      currentLp: after.leaguePoints,
      lpLine: `${after.leaguePoints}`,
      delta: null,
    };
  }

  const beforeDiv = divisionValue(before.tier, before.rank);
  const afterDiv = divisionValue(after.tier, after.rank);
  const sameDivision =
    before.tier === after.tier && before.rank === after.rank;

  if (sameDivision) {
    const delta = after.leaguePoints - before.leaguePoints;
    const sign = delta >= 0 ? "+" : "";
    return {
      currentLp: after.leaguePoints,
      lpLine: `${after.leaguePoints} (${sign}${delta} PDL)`,
      delta,
    };
  }

  if (afterDiv > beforeDiv) {
    const estimated = 100 - before.leaguePoints + after.leaguePoints;
    return {
      currentLp: after.leaguePoints,
      lpLine: `${after.leaguePoints} (~+${estimated} PDL — promovido)`,
      delta: estimated,
    };
  }

  if (afterDiv < beforeDiv) {
    const estimated = -(before.leaguePoints + (100 - after.leaguePoints));
    return {
      currentLp: after.leaguePoints,
      lpLine: `${after.leaguePoints} (~${estimated} PDL — rebaixado)`,
      delta: estimated,
    };
  }

  const fallback = won ? "ganho estimado" : "perda estimada";
  return {
    currentLp: after.leaguePoints,
    lpLine: `${after.leaguePoints} (${fallback})`,
    delta: null,
  };
}
