import "@/loadEnv";
import { startHttpServer, type HttpServerHandle } from "@/http/server";
import { connection as redis } from "@/lib/redis";
import { prisma } from "@/prisma/client";
import {
  closeQueues,
  registerCronSchedule,
  registerReportSchedule,
} from "@/queues";
import { whatsappManager } from "@/whatsapp/WhatsAppManager";
import { closeWorkers, startWorkers, type WorkerRegistry } from "@/workers";

/**
 * Entry point do Worker SaaS.
 *
 * Processo Node.js que orquestra:
 *   1. Prisma (Supabase / PostgreSQL).
 *   2. Redis (via BullMQ — implícito ao instanciar Queues/Workers).
 *   3. WhatsAppManager — reabre sessões previamente cadastradas.
 *   4. Workers BullMQ (Cron poll+report, RiotApi).
 *   5. CronQueue: poll Riot 15 min + relatório WhatsApp 6 h.
 *   6. Mini-API HTTP (Express) — endpoints de controle p/ setup-UI:
 *        GET  /api/whatsapp/:userId/status
 *        GET  /api/whatsapp/:userId/groups
 *        POST /api/subscriptions
 *      O HTTP server roda no MESMO processo para compartilhar o singleton
 *      `whatsappManager` em memória (sem RPC / IPC).
 *
 * Em SIGINT/SIGTERM, drena filas, fecha o HTTP, encerra sockets WA e
 * desconecta do banco antes de sair.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

async function initializeActiveSessions(): Promise<number> {
  // Só reabre sessões com creds válidas — evita gerar QR infinito para
  // WaSession "órfãs" (resetadas / nunca pareadas).
  const sessions = await prisma.waSession.findMany({
    select: { userId: true, sessionData: true, user: { select: { email: true } } },
  });

  const active = sessions.filter((s) => {
    const data = s.sessionData;
    if (!data || typeof data !== "object") return false;
    const creds = (data as { creds?: { registered?: boolean } }).creds;
    return Boolean(creds?.registered);
  });

  if (active.length === 0) {
    console.log(
      "[boot] Nenhuma WaSession pareada — nada para reabrir. Use /dashboard/setup para conectar.",
    );
    return 0;
  }

  console.log(`[boot] Reabrindo ${active.length} sessão(ões) WhatsApp...`);

  for (const session of active) {
    void whatsappManager.initializeUser(session.userId).catch((err) => {
      console.error(
        `[boot] falha ao initializeUser(${session.userId}):`,
        err.message,
      );
    });
  }

  return active.length;
}

async function bootstrap(): Promise<{
  workers: WorkerRegistry;
  http: HttpServerHandle;
}> {
  requireEnv("DATABASE_URL");
  requireEnv("REDIS_URL");

  console.log("[boot] conectando Prisma...");
  await prisma.$connect();
  console.log("[boot] Prisma conectado");

  await initializeActiveSessions();

  const workers = startWorkers();
  await registerCronSchedule();
  await registerReportSchedule();

  const port = Number(process.env.WORKER_HTTP_PORT ?? 4000);
  const http = startHttpServer(port);

  console.log("\n✅ Worker SaaS LoL Match Monitor pronto.");
  console.log(
    "    Filas: lol-cron (poll 15min + report 6h) | lol-riot-api (rate-limited)",
  );
  console.log(`    API HTTP: http://localhost:${port}\n`);

  return { workers, http };
}

let registry: WorkerRegistry | null = null;
let httpServer: HttpServerHandle | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[shutdown] sinal ${signal} recebido — encerrando...`);

  try {
    if (httpServer) await httpServer.close().catch(() => undefined);
    if (registry) await closeWorkers(registry);
    await closeQueues();
    await whatsappManager.shutdown();
    await prisma.$disconnect();
    await redis.quit().catch(() => undefined);
    console.log("[shutdown] limpo. bye!");
    process.exit(0);
  } catch (err) {
    console.error("[shutdown] erro durante teardown:", err);
    process.exit(1);
  }
}

bootstrap()
  .then(({ workers, http }) => {
    registry = workers;
    httpServer = http;
  })
  .catch((err) => {
    console.error("[boot] Falha fatal na inicialização do Worker:", err);
    process.exit(1);
  });

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection:", reason);
});
