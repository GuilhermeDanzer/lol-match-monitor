import type { Worker } from "bullmq";
import { createCronWorker } from "@/workers/cronWorker";
import { createRiotApiWorker, RIOT_LIMITER } from "@/workers/riotApiWorker";

export interface WorkerRegistry {
  cron: Worker;
  riot: Worker;
}

export function startWorkers(): WorkerRegistry {
  const cron = createCronWorker();
  const riot = createRiotApiWorker();

  console.log(
    `[workers] BullMQ ativo — cron (poll+report) | riot (limiter ${RIOT_LIMITER.max}/s)`,
  );

  return { cron, riot };
}

export async function closeWorkers(registry: WorkerRegistry): Promise<void> {
  await Promise.allSettled([registry.cron.close(), registry.riot.close()]);
}
