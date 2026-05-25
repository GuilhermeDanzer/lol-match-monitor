"use client";

import { Flame, Shield, TrendingUp, Trophy } from "lucide-react";
import type { CurrentStats } from "@/types/history";
import { getTierTheme } from "@/lib/tierTheme";

interface EstatisticasGeraisProps {
  stats: CurrentStats;
}

export function EstatisticasGerais({ stats }: EstatisticasGeraisProps) {
  const theme = getTierTheme(stats.tier);

  return (
    <section className="grid gap-4 sm:grid-cols-3">
      {/* Elo atual */}
      <article
        className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 ${theme.border} ${theme.gradient}`}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Elo atual
            </p>
            <p className={`mt-2 text-2xl font-bold ${theme.text}`}>
              {stats.elo}
            </p>
            <p className="mt-1 text-sm text-zinc-400">{stats.pdl} PDL</p>
          </div>
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-xl ${theme.iconBg}`}
          >
            <Trophy className={`h-6 w-6 ${theme.text}`} />
          </div>
        </div>
        <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-xs font-semibold text-zinc-300">
          <Shield className="h-3.5 w-3.5" />
          {theme.label}
        </div>
      </article>

      {/* Win streak */}
      <article className="relative overflow-hidden rounded-2xl border border-orange-500/30 bg-gradient-to-br from-orange-950/50 to-zinc-950/80 p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Win streak
            </p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-orange-400">
                {stats.winStreak}W
              </span>
              <span className="text-sm font-medium text-orange-300/80">
                Streak
              </span>
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500/25">
            <Flame className="h-7 w-7 text-orange-400" />
          </div>
        </div>
        <p className="mt-4 text-xs text-zinc-500">
          Vitórias consecutivas na jornada monitorada
        </p>
      </article>

      {/* Win rate */}
      <article className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-950/40 to-zinc-950/80 p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Win rate
            </p>
            <p className="mt-2 text-3xl font-bold text-emerald-400">
              {stats.winRate}%
            </p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
            <TrendingUp className="h-6 w-6 text-emerald-400" />
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
            style={{ width: `${Math.min(100, stats.winRate)}%` }}
          />
        </div>
      </article>
    </section>
  );
}
