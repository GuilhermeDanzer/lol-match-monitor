import "@/loadEnv";
import cors from "cors";
import express from "express";
import cron from "node-cron";
import QRCode from "qrcode";
import { buildHistoryResponse } from "@/lib/historyStats";
import { ensureJourneyBackfilled } from "@/lib/journeyBackfill";
import { ensureJourneySeeded } from "@/lib/journeySeed";
import { ensureJourneyExists } from "@/lib/journeyStore";
import { ensureStoreExists } from "@/lib/matchStore";
import { sendJourneyReport, syncRankedMatches } from "@/services/monitor";
import { getConfiguredGameName } from "@/services/riot";
import { getCurrentQrString, initWhatsAppClient } from "@/services/whatsapp";

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

/** QR Code WhatsApp para escaneio no navegador (Render/cloud) */
app.get("/api/qr", async (_req, res) => {
  try {
    const qr = getCurrentQrString();
    if (!qr) {
      res
        .status(200)
        .type("html")
        .send(
          "<!DOCTYPE html><html><body style='font-family:sans-serif;text-align:center;padding:2rem'><h1>WhatsApp</h1><p>Ja conectado ou QR indisponivel no momento.</p></body></html>",
        );
      return;
    }

    const dataUrl = await QRCode.toDataURL(qr);
    res.type("html").send(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>WhatsApp QR</title></head>
<body style="background:#0a0a0a;color:#fafafa;font-family:system-ui,sans-serif;text-align:center;padding:2rem">
  <h1>Escaneie o QR Code</h1>
  <p>WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho</p>
  <img src="${dataUrl}" alt="QR Code WhatsApp" width="320" height="320" style="margin:1rem auto;border:8px solid #fff;border-radius:8px"/>
  <p style="color:#888;font-size:0.875rem">Atualize esta pagina se o QR expirar.</p>
</body>
</html>`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[GET /api/qr]", message);
    res.status(500).send(`Erro ao gerar QR: ${message}`);
  }
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
    console.log(`📡 API: GET /api/history | GET /api/qr`);
    console.log("📋 Aguardando conexão do WhatsApp...\n");
  });
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar bot-backend:", error);
  process.exit(1);
});
