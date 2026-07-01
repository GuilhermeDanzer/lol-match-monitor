import { Worker } from "bullmq";
import { connection } from "@/lib/redis";
import { riotApiQueue } from "@/queues";
import { QUEUE_NAMES, type CronTickJob } from "@/queues/types";
import { deliverPeriodicReports } from "@/services/periodicReportService";
import { listTrackedPlayersForPolling } from "@/services/trackedPlayerService";

/**
 * CronWorker — dois ticks na mesma fila:
 *
 *   `cron-tick` (15 min) → enfileira checagem Riot por jogador.
 *   `report-tick` (6 h)  → envia relatório WhatsApp se houver partidas novas.
 */
export function createCronWorker(): Worker<CronTickJob> {
  const worker = new Worker<CronTickJob>(
    QUEUE_NAMES.CRON,
    async (job) => {
      if (job.name === "report-tick") {
        console.log(`[worker:cron] report-tick=${job.data.tick}`);
        return deliverPeriodicReports();
      }

      const players = await listTrackedPlayersForPolling();
      console.log(
        `[worker:cron] tick=${job.data.tick} → enfileirando ${players.length} jogador(es)`,
      );

      if (players.length === 0) return { dispatched: 0 };

      const now = Date.now();
      await riotApiQueue.addBulk(
        players.map((player) => ({
          name: "check-player",
          data: { trackedPlayerId: player.id, puuid: player.puuid },
          opts: { jobId: `riot-${player.id}-${now}` },
        })),
      );

      return { dispatched: players.length };
    },
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) =>
    console.error(`[worker:cron] job ${job?.id} falhou:`, err.message),
  );

  return worker;
}
