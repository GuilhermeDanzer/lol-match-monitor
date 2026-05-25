export interface TierTheme {
  label: string;
  gradient: string;
  border: string;
  text: string;
  iconBg: string;
}

const TIER_THEMES: Record<string, TierTheme> = {
  IRON: {
    label: "Ferro",
    gradient: "from-stone-600/40 to-stone-800/60",
    border: "border-stone-500/40",
    text: "text-stone-300",
    iconBg: "bg-stone-500/30",
  },
  BRONZE: {
    label: "Bronze",
    gradient: "from-amber-900/50 to-amber-950/70",
    border: "border-amber-700/50",
    text: "text-amber-400",
    iconBg: "bg-amber-700/40",
  },
  SILVER: {
    label: "Prata",
    gradient: "from-slate-400/30 to-slate-700/50",
    border: "border-slate-400/40",
    text: "text-slate-200",
    iconBg: "bg-slate-400/25",
  },
  GOLD: {
    label: "Ouro",
    gradient: "from-amber-500/35 to-yellow-700/50",
    border: "border-amber-400/50",
    text: "text-amber-300",
    iconBg: "bg-amber-500/35",
  },
  PLATINUM: {
    label: "Platina",
    gradient: "from-teal-500/25 to-cyan-900/50",
    border: "border-teal-400/40",
    text: "text-teal-200",
    iconBg: "bg-teal-500/30",
  },
  EMERALD: {
    label: "Esmeralda",
    gradient: "from-emerald-500/30 to-emerald-900/55",
    border: "border-emerald-400/45",
    text: "text-emerald-300",
    iconBg: "bg-emerald-500/30",
  },
  DIAMOND: {
    label: "Diamante",
    gradient: "from-sky-400/30 to-indigo-900/55",
    border: "border-sky-400/45",
    text: "text-sky-200",
    iconBg: "bg-sky-500/30",
  },
  MASTER: {
    label: "Mestre",
    gradient: "from-purple-500/35 to-purple-950/60",
    border: "border-purple-400/45",
    text: "text-purple-200",
    iconBg: "bg-purple-500/35",
  },
  GRANDMASTER: {
    label: "Grão-Mestre",
    gradient: "from-rose-500/30 to-red-950/60",
    border: "border-rose-400/45",
    text: "text-rose-200",
    iconBg: "bg-rose-500/30",
  },
  CHALLENGER: {
    label: "Desafiante",
    gradient: "from-amber-300/35 to-orange-700/55",
    border: "border-amber-200/50",
    text: "text-amber-100",
    iconBg: "bg-gradient-to-br from-amber-400/40 to-orange-500/40",
  },
  UNRANKED: {
    label: "Sem elo",
    gradient: "from-zinc-700/40 to-zinc-900/60",
    border: "border-zinc-600/40",
    text: "text-zinc-400",
    iconBg: "bg-zinc-600/30",
  },
};

export function getTierTheme(tier: string): TierTheme {
  return TIER_THEMES[tier.toUpperCase()] ?? TIER_THEMES.UNRANKED;
}
