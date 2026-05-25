"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { DamageBar } from "@/components/DamageBar";
import { TeamComposition } from "@/components/TeamComposition";
import { EstatisticasGerais } from "@/components/EstatisticasGerais";
import type { HistoryApiResponse } from "@/types/history";
import type { MatchMetadata } from "@/types/riot";

const TierGraph = dynamic(
  () => import("@/components/TierGraph").then((m) => m.TierGraph),
  {
    ssr: false,
    loading: () => (
      <div className="h-72 animate-pulse rounded-2xl border border-zinc-800 bg-zinc-900/60 sm:h-80" />
    ),
  },
);

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Formatação estável (evita mismatch de locale na hidratação) */
function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function MatchCard({ match }: { match: MatchMetadata }) {
  const kda = `${match.kills}/${match.deaths}/${match.assists}`;
  const kdaRatio =
    match.deaths === 0
      ? "Perfect"
      : ((match.kills + match.assists) / match.deaths).toFixed(2);

  return (
    <article
      className={`rounded-xl border p-5 transition-shadow hover:shadow-lg ${
        match.win
          ? "border-emerald-500/30 bg-emerald-950/20"
          : "border-red-500/30 bg-red-950/20"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <span
            className={`inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
              match.win
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-red-500/20 text-red-400"
            }`}
          >
            {match.win ? "Vitória" : "Derrota"}
          </span>
          <h3 className="mt-2 text-xl font-bold text-white">
            {match.championName}
          </h3>
          <p className="text-sm text-zinc-400">{match.gameMode}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-amber-400">{kda}</p>
          <p className="text-xs text-zinc-500">KDA {kdaRatio}</p>
        </div>
      </div>

      <DamageBar damage={match.damage} matchMaxDamage={match.matchMaxDamage} />

      <TeamComposition team={match.team ?? []} />

      <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-3 text-sm text-zinc-400">
        <span>⏱ {formatDuration(match.gameDuration)}</span>
        <span suppressHydrationWarning>{formatDate(match.gameCreation)}</span>
      </div>
    </article>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<HistoryApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
        if (!apiBase) {
          throw new Error(
            "NEXT_PUBLIC_API_URL não configurada. Defina no .env.local",
          );
        }

        const res = await fetch(`${apiBase}/api/history`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? "Falha ao carregar histórico");
        }
        const json = (await res.json()) as HistoryApiResponse;
        setData(json);
      } catch (err) {
        const base = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";
        const hint =
          err instanceof TypeError && err.message === "Failed to fetch"
            ? ` Nao foi possivel conectar em ${base}/api/history (backend offline, CORS ou URL errada).`
            : "";
        setError(
          (err instanceof Error ? err.message : "Erro desconhecido") + hint,
        );
      } finally {
        setLoading(false);
      }
    }

    void fetchHistory();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="flex items-center gap-3">
            <span className="text-3xl">⚔️</span>
            <div>
              <h1 className="text-2xl font-bold text-white">
                LoL Match Monitor
              </h1>
              <p className="text-sm text-zinc-400">
                Dashboard de estatísticas ranqueadas
              </p>
            </div>
          </div>
          {data?.playerName && (
            <p className="mt-4 text-amber-400">
              Monitorando:{" "}
              <span className="font-semibold">{data.playerName}</span>
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
        {loading && (
          <div className="flex flex-col items-center gap-4 py-20">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400 border-t-transparent" />
            <p className="text-zinc-400">Carregando dashboard...</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-red-400">
            <p className="font-semibold">Erro ao carregar dados</p>
            <p className="mt-1 text-sm">{error}</p>
            <p className="mt-3 text-xs text-zinc-500">
              Verifique NEXT_PUBLIC_API_URL no .env.local e se o bot-backend
              está rodando.
            </p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <EstatisticasGerais stats={data.currentStats} />
            <TierGraph data={data.graphData} />

            <section>
              <h2 className="mb-4 text-lg font-semibold text-white">
                Partidas recentes
              </h2>
              <p className="mb-4 text-sm text-zinc-500">
                {data.matches.length} partidas ranqueadas monitoradas
              </p>
              <div className="grid gap-4">
                {data.matches.map((match) => (
                  <MatchCard key={match.matchId} match={match} />
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
