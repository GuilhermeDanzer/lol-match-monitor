import { Queue } from "bullmq";
import { connection } from "@/lib/redis";
import {
  QUEUE_NAMES,
  type CronTickJob,
  type NotifyJob,
  type RiotApiCheckJob,
} from "@/queues/types";

/**
 * Três filas, três responsabilidades:
 *
 *  CronQueue    → tick a cada 15 min (poll Riot) + tick a cada 6 h (relatório WA).
 *  RiotApiQueue → consome PUUIDs com rate-limit. Partidas novas vão para
 *                 `pendingAlerts` no snapshot — sem WhatsApp imediato.
 *  NotifyQueue  → legado (não usado); relatórios rodam no `report-tick`.
 */

const baseJobOptions = {
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5_000 },
};

export const cronQueue = new Queue<CronTickJob>(QUEUE_NAMES.CRON, {
  connection,
  defaultJobOptions: {
    ...baseJobOptions,
    attempts: 1,
  },
});

export const riotApiQueue = new Queue<RiotApiCheckJob>(QUEUE_NAMES.RIOT_API, {
  connection,
  defaultJobOptions: {
    ...baseJobOptions,
    attempts: 5,
  },
});

export const notifyQueue = new Queue<NotifyJob>(QUEUE_NAMES.NOTIFY, {
  connection,
  defaultJobOptions: {
    ...baseJobOptions,
    attempts: 4,
    backoff: { type: "exponential" as const, delay: 10_000 },
  },
});

export const CRON_INTERVAL_MS = Number(
  process.env.CRON_INTERVAL_MS ?? 15 * 60 * 1000,
);

/** Intervalo do relatório WhatsApp automático (default: 6 h). */
export const REPORT_INTERVAL_MS = Number(
  process.env.REPORT_INTERVAL_MS ?? 6 * 60 * 60 * 1000,
);

/**
 * Registra o job repetível do CronQueue (poll Riot). Idempotente — BullMQ
 * deduplica pelo `jobId` do repeat.
 */
export async function registerCronSchedule(): Promise<void> {
  await cronQueue.add(
    "cron-tick",
    { tick: Date.now() },
    {
      repeat: { every: CRON_INTERVAL_MS },
      jobId: "cron-tick-repeat",
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 20 },
    },
  );
  console.log(
    `[queue:cron] poll Riot a cada ${Math.round(CRON_INTERVAL_MS / 60000)} min`,
  );
}

/** Relatório WhatsApp — só envia se houver partidas em `pendingAlerts`. */
export async function registerReportSchedule(): Promise<void> {
  await cronQueue.add(
    "report-tick",
    { tick: Date.now() },
    {
      repeat: { every: REPORT_INTERVAL_MS },
      jobId: "report-tick-repeat",
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 20 },
    },
  );
  console.log(
    `[queue:cron] relatório WhatsApp a cada ${Math.round(REPORT_INTERVAL_MS / 3600000)} h`,
  );
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    cronQueue.close(),
    riotApiQueue.close(),
    notifyQueue.close(),
  ]);
}
