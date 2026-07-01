import type { Prisma } from "@prisma/client";
import { prisma } from "@/prisma/client";
import {
  getCurrentRankedStats,
  resolvePuuidByRiotId,
} from "@/services/riot";

/** Partida detectada aguardando o relatório de 6 h. */
export interface PendingAlert {
  matchId: string;
  detectedAt: string;
  championName: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  durationSeconds: number;
  gameMode: string;
  lpChange: number | null;
}

/**
 * Shape do JSON `elo_snapshot` na tabela `tracked_players`.
 * Toda metadata mutável do jogador vive aqui (em vez de virar coluna).
 */
export interface TrackedPlayerSnapshot {
  gameName?: string;
  tagLine?: string;
  tier?: string | null;
  rank?: string | null;
  leaguePoints?: number | null;
  lastMatchId?: string | null;
  rankedBeforeLastMatch?: {
    tier: string;
    rank: string;
    leaguePoints: number;
  } | null;
  /** Partidas novas ainda não incluídas em relatório WhatsApp. */
  pendingAlerts?: PendingAlert[];
  updatedAt?: string;
}

/** Cast estreito para o tipo JSON aceito pelo Prisma. */
function toJsonInput(snapshot: TrackedPlayerSnapshot): Prisma.InputJsonValue {
  return snapshot as unknown as Prisma.InputJsonValue;
}

function normalizeRiotId(gameName: string, tagLine: string): string {
  return `${gameName.trim()}#${tagLine.trim()}`.toLowerCase();
}

export function readSnapshot(player: {
  eloSnapshot: unknown;
}): TrackedPlayerSnapshot {
  const raw = player.eloSnapshot;
  if (!raw || typeof raw !== "object") return {};
  return raw as TrackedPlayerSnapshot;
}

/** Resolve PUUID via Riot e faz upsert do TrackedPlayer global. */
export async function upsertTrackedPlayer(
  gameName: string,
  tagLine: string,
): Promise<{ id: string; puuid: string; riotId: string }> {
  const account = await resolvePuuidByRiotId(gameName, tagLine);
  const riotId = normalizeRiotId(account.gameName, account.tagLine);
  const ranked = await getCurrentRankedStats(account.puuid).catch(() => null);

  const snapshot: TrackedPlayerSnapshot = {
    gameName: account.gameName,
    tagLine: account.tagLine,
    tier: ranked?.tier ?? null,
    rank: ranked?.rank ?? null,
    leaguePoints: ranked?.leaguePoints ?? null,
    updatedAt: new Date().toISOString(),
  };

  const eloSnapshot = toJsonInput(snapshot);
  const player = await prisma.trackedPlayer.upsert({
    where: { puuid: account.puuid },
    create: {
      puuid: account.puuid,
      riotId,
      eloSnapshot,
    },
    update: {
      riotId,
      eloSnapshot,
    },
  });

  return { id: player.id, puuid: player.puuid, riotId: player.riotId };
}

/** Todos os jogadores rastreados — usado pelo CronWorker. */
export async function listTrackedPlayersForPolling(): Promise<
  Array<{ id: string; puuid: string; riotId: string }>
> {
  const rows = await prisma.trackedPlayer.findMany({
    select: { id: true, puuid: true, riotId: true },
  });
  return rows;
}

/** Atualiza elo + lastMatchId no JSON snapshot. */
export async function patchSnapshot(
  trackedPlayerId: string,
  patch: Partial<TrackedPlayerSnapshot>,
): Promise<void> {
  const current = await prisma.trackedPlayer.findUnique({
    where: { id: trackedPlayerId },
    select: { eloSnapshot: true },
  });
  const merged: TrackedPlayerSnapshot = {
    ...readSnapshot({ eloSnapshot: current?.eloSnapshot ?? {} }),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await prisma.trackedPlayer.update({
    where: { id: trackedPlayerId },
    data: { eloSnapshot: toJsonInput(merged) },
  });
}

/** Acumula partida para o relatório periódico (6 h) — sem WhatsApp imediato. */
export async function appendPendingAlert(
  trackedPlayerId: string,
  alert: PendingAlert,
): Promise<void> {
  const current = await prisma.trackedPlayer.findUnique({
    where: { id: trackedPlayerId },
    select: { eloSnapshot: true },
  });
  const snap = readSnapshot({ eloSnapshot: current?.eloSnapshot ?? {} });
  const pending = [...(snap.pendingAlerts ?? [])];
  if (pending.some((p) => p.matchId === alert.matchId)) return;
  pending.push(alert);
  await patchSnapshot(trackedPlayerId, { pendingAlerts: pending });
}

/** Lista jogadores com partidas pendentes de relatório. */
export async function listPlayersWithPendingAlerts(): Promise<
  Array<{ id: string; puuid: string; riotId: string; alerts: PendingAlert[] }>
> {
  const rows = await prisma.trackedPlayer.findMany({
    select: { id: true, puuid: true, riotId: true, eloSnapshot: true },
  });

  return rows
    .map((row) => {
      const snap = readSnapshot(row);
      const alerts = snap.pendingAlerts ?? [];
      if (alerts.length === 0) return null;
      return {
        id: row.id,
        puuid: row.puuid,
        riotId: row.riotId,
        alerts,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

/** Esvazia a fila após envio bem-sucedido do relatório. */
export async function drainPendingAlerts(trackedPlayerId: string): Promise<void> {
  await patchSnapshot(trackedPlayerId, { pendingAlerts: [] });
}
