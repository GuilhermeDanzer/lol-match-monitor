import "@/loadEnv";
import cors from "cors";
import express from "express";
import cron from "node-cron";
import { buildHistoryResponse } from "@/lib/historyStats";
import { ensureJourneyBackfilled } from "@/lib/journeyBackfill";
import { ensureJourneySeeded } from "@/lib/journeySeed";
import { ensureJourneyExists } from "@/lib/journeyStore";
import { ensureStoreExists } from "@/lib/matchStore";
import { sendJourneyReport, syncRankedMatches } from "@/services/monitor";
import { getConfiguredGameName } from "@/services/riot";
import { initWhatsAppClient } from "@/services/whatsapp";

const port = Number(process.env.PORT) || 4000;
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

const app = express();

const corsOrigins = process.env.CORS_ORIGIN?.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (!corsOrigins?.length) return true;
  if (corsOrigins.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, isAllowedCorsOrigin(origin));
    },
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

/** Histórico acumulado (journey.json) para o frontend Vercel */
app.get("/api/history", async (_req, res) => {
  try {
    const payload = await buildHistoryResponse(getConfiguredGameName());
    res.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[GET /api/history]", message);
    res.status(500).json({ error: message });
  }
});

async function bootstrap(): Promise<void> {
  await ensureStoreExists();
  await ensureJourneyExists();

  void ensureJourneySeeded().catch((error) => {
    console.warn("[seed] Erro na importacao inicial:", error);
  });
  void ensureJourneyBackfilled().catch((error) => {
    console.warn("[backfill] Erro no enriquecimento inicial:", error);
  });

  initWhatsAppClient();

  cron.schedule("*/15 * * * *", () => {
    void syncRankedMatches();
  });

  cron.schedule("0 */6 * * *", () => {
    void sendJourneyReport();
  });

  console.log("⏰ Cron 1: sincronização ranqueada a cada 15 minutos");
  console.log("⏰ Cron 2: relatório WhatsApp a cada 6 horas");

  app.listen(port, hostname, () => {
    console.log(`\n🤖 Bot backend em http://${hostname}:${port}`);
    console.log(`📡 API: GET /api/history`);
    console.log("📋 Aguardando conexão do WhatsApp...\n");
  });
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar bot-backend:", error);
  process.exit(1);
});
