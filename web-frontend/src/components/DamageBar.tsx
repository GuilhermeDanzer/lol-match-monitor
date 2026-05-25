"use client";

import {
  formatDamageAbsolute,
  getDamageBarPercent,
} from "@/lib/formatDamage";

interface DamageBarProps {
  damage: number;
  matchMaxDamage: number;
}

/** Barra horizontal de dano a campeões (Tailwind) */
export function DamageBar({ damage, matchMaxDamage }: DamageBarProps) {
  const percent = getDamageBarPercent(damage, matchMaxDamage);

  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="text-zinc-400">💥 Dano a campeões</span>
        <span className="font-semibold tabular-nums text-white">
          {formatDamageAbsolute(damage)}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-700">
        <div
          className="h-full rounded-full bg-red-500 transition-all duration-300"
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={damage}
          aria-valuemin={0}
          aria-valuemax={matchMaxDamage}
        />
      </div>
      {matchMaxDamage > 0 && (
        <p className="mt-1 text-right text-xs text-zinc-500">
          {percent.toFixed(0)}% do maior dano da partida (
          {formatDamageAbsolute(matchMaxDamage)})
        </p>
      )}
    </div>
  );
}
