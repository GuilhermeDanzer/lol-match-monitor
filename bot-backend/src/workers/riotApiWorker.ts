import { Worker } from "bullmq";
import { connection } from "@/lib/redis";
import { QUEUE_NAMES, type RiotApiCheckJob } from "@/queues/types";
import { getRankedUpdateDelayMs, sleep } from "@/lib/delay";
import { calculateLpChange } from "@/lib/lpCalculator";
import { prisma } from "@/prisma/client";
import {
  extractPlayerMatchData,
  formatQueueLabel,
  getCurrentRankedStats,
  getMatchDetails,
  getRecentMatchIds,
  isRemakeMatch,
} from "@/services/riot";
import {
  appendPendingAlert,
  patchSnapshot,
  readSnapshot,
} from "@/services/trackedPlayerService";

/**
 * RiotApiWorker — consome PUUIDs do RiotApiQueue.
 *
 * Aqui mora a inteligência de Rate Limit. O BullMQ aplica o `limiter`
 * configurado abaixo (default: 20 jobs/s) ANTES de invocar este handler,
 * então não precisamos de fila/throttle manual aqui.
 *
 * Fluxo:
 *   1. Busca os N últimos match IDs do PUUID (Match-V5).
 *   2. Compara com `eloSnapshot.lastMatchId` → identifica partidas novas.
 *   3. Para cada nova: fetch details, calcula PDL, atualiza snapshot,
 *      acumula em `pendingAlerts` para o relatório de 6 h (sem WhatsApp imediato).
 */

const SCAN_COUNT = Number(process.env.RIOT_SCAN_COUNT ?? 10);

/** Configuração do limiter — máximo de jobs por segundo (default 20). */
export const RIOT_LIMITER = {
  max: Number(process.env.RIOT_RATE_PER_SECOND ?? 20),
  duration: 1_000,
};

export function createRiotApiWorker(): Worker<RiotApiCheckJob> {
  const worker = new Worker<RiotApiCheckJob>(
    QUEUE_NAMES.RIOT_API,
    async (job) => {
      const { trackedPlayerId, puuid } = job.data;

      const player = await prisma.trackedPlayer.findUnique({
        where: { id: trackedPlayerId },
      });
      if (!player) {
        return { skipped: "no-player" };
      }

      const snapshot = readSnapshot(player);
      const recentIds = await getRecentMatchIds(puuid, SCAN_COUNT);
      if (recentIds.length === 0) return { newMatches: 0 };

      const lastProcessed = snapshot.lastMatchId ?? null;
      const newIds: string[] = [];
      for (const id of recentIds) {
        if (id === lastProcessed) break;
        newIds.push(id);
      }
      if (newIds.length === 0) return { newMatches: 0 };

      // First run (sem lastMatchId): marca o mais recente sem notificar — evita
      // disparar spam na primeira sincronização de um jogador novo.
      if (!lastProcessed) {
        await patchSnapshot(trackedPlayerId, { lastMatchId: recentIds[0] });
        return { firstSync: true, marked: recentIds[0] };
      }

      // Processa do mais antigo para o mais novo, em ordem cronológica.
      newIds.reverse();

      let processed = 0;
      for (const matchId of newIds) {
        const details = await getMatchDetails(matchId);

        if (isRemakeMatch(details, puuid)) {
          await patchSnapshot(trackedPlayerId, { lastMatchId: matchId });
          continue;
        }

        const matchData = extractPlayerMatchData(details, puuid);

        const before =
          snapshot.tier && snapshot.rank && snapshot.leaguePoints !== null
            ? {
                tier: snapshot.tier,
                rank: snapshot.rank ?? "IV",
                leaguePoints: snapshot.leaguePoints ?? 0,
              }
            : null;

        await sleep(getRankedUpdateDelayMs());
        const after = await getCurrentRankedStats(puuid).catch(() => null);
        const afterSnapshot = after
          ? {
              tier: after.tier,
              rank: after.rank,
              leaguePoints: after.leaguePoints,
            }
          : null;

        let lpChange: number | null = null;
        if (before && afterSnapshot) {
          const calc = calculateLpChange(before, afterSnapshot, matchData.win);
          lpChange = calc.delta;
        }

        await patchSnapshot(trackedPlayerId, {
          lastMatchId: matchId,
          rankedBeforeLastMatch: before,
          tier: afterSnapshot?.tier ?? snapshot.tier ?? null,
          rank: afterSnapshot?.rank ?? snapshot.rank ?? null,
          leaguePoints:
            afterSnapshot?.leaguePoints ?? snapshot.leaguePoints ?? null,
        });

        await appendPendingAlert(trackedPlayerId, {
          matchId,
          detectedAt: new Date().toISOString(),
          championName: matchData.championName,
          win: matchData.win,
          kills: matchData.kills,
          deaths: matchData.deaths,
          assists: matchData.assists,
          durationSeconds: matchData.gameDuration,
          gameMode: formatQueueLabel({
            queueId: details.info.queueId,
            gameMode: details.info.gameMode,
          }),
          lpChange,
        });

        processed += 1;
      }

      return { newMatches: processed };
    },
    {
      connection,
      concurrency: Number(process.env.RIOT_WORKER_CONCURRENCY ?? 2),
      limiter: RIOT_LIMITER,
    },
  );

  worker.on("failed", (job, err) =>
    console.error(`[worker:riot] job ${job?.id} falhou:`, err.message),
  );

  return worker;
}
