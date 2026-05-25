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
import {
  getCurrentQrId,
  getCurrentQrString,
  getWhatsAppStatus,
  initWhatsAppClient,
  resetWhatsAppSession,
} from "@/services/whatsapp";

const port = Number(process.env.PORT) || 4000;
const hostname = process.env.HOSTNAME ?? "0.0.0.0";

/** Evita crash loop por erro conhecido do Puppeteer/Chromium no Render */
process.on("unhandledRejection", (reason) => {
  const message = String(
    reason instanceof Error ? reason.message : reason,
  );
  if (
    message.includes("Protocol error") &&
    message.includes("Network.getResponseBody")
  ) {
    console.warn("[WhatsApp] Protocol error ignorado (Puppeteer):", message);
    return;
  }
  console.error("[unhandledRejection]", reason);
});

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
  res.json({ ok: true, whatsapp: getWhatsAppStatus() });
});

/** Status da conexao WhatsApp (debug) */
app.get("/api/whatsapp/status", (_req, res) => {
  res.json(getWhatsAppStatus());
});

/** QR atual em JSON (pagina /api/qr atualiza a imagem sem reload) */
app.get("/api/qr/data", async (_req, res) => {
  try {
    const status = getWhatsAppStatus();
    if (status.ready) {
      res.json({ ready: true, awaitingQr: false, qrId: status.qrId });
      return;
    }

    const qr = getCurrentQrString();
    if (!qr) {
      res.json({ ready: false, awaitingQr: false, qrId: status.qrId });
      return;
    }

    const dataUrl = await QRCode.toDataURL(qr);
    res.json({
      ready: false,
      awaitingQr: true,
      qrId: getCurrentQrId(),
      dataUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    res.status(500).json({ error: message });
  }
});

/** Limpa sessao corrompida e gera novo QR (use se o celular disser "nao foi possivel conectar") */
app.post("/api/whatsapp/reset", async (req, res) => {
  const expectedKey = process.env.WHATSAPP_RESET_KEY?.trim();
  if (expectedKey && req.query.key !== expectedKey) {
    res.status(403).json({ error: "Chave invalida. Use ?key=..." });
    return;
  }

  try {
    await resetWhatsAppSession();
    res.json({
      ok: true,
      message: "Sessao limpa. Aguarde ~30s e abra /api/qr",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    res.status(500).json({ error: message });
  }
});

/** QR Code WhatsApp para escaneio no navegador (Render/cloud) */
app.get("/api/qr", async (_req, res) => {
  try {
    const status = getWhatsAppStatus();

    if (status.ready) {
      res
        .status(200)
        .type("html")
        .send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>WhatsApp</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:2rem;background:#0a0a0a;color:#fafafa">
<h1>WhatsApp conectado</h1>
<p>O bot ja esta autenticado. Teste <code>!status</code> no grupo.</p>
</body></html>`);
      return;
    }

    res.type("html").send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>WhatsApp QR</title>
</head>
<body style="background:#0a0a0a;color:#fafafa;font-family:system-ui,sans-serif;text-align:center;padding:2rem">
  <h1 id="title">Conectar WhatsApp</h1>
  <p>WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho</p>
  <p id="hint" style="color:#888;font-size:0.875rem">Aguardando QR...</p>
  <img id="qr" alt="QR Code WhatsApp" width="320" height="320"
    style="margin:1rem auto;border:8px solid #fff;border-radius:8px;display:none"/>
  <p style="margin-top:1.5rem">
    <button type="button" id="resetBtn" style="cursor:pointer;padding:0.6rem 1.2rem;font-size:1rem;border-radius:8px;border:none;background:#dc2626;color:#fff">
      Limpar sessao e gerar novo QR
    </button>
  </p>
  <script>
  let lastQrId = null;

  async function refreshQr() {
    try {
      const d = await (await fetch("/api/qr/data")).json();
      if (d.ready) {
        location.reload();
        return;
      }
      if (!d.awaitingQr || !d.dataUrl) {
        document.getElementById("hint").textContent =
          "Chromium iniciando... aguarde o QR aparecer.";
        document.getElementById("qr").style.display = "none";
        return;
      }
      if (d.qrId !== lastQrId) {
        lastQrId = d.qrId;
        document.getElementById("qr").src = d.dataUrl;
        document.getElementById("qr").style.display = "block";
        document.getElementById("title").textContent = "Escaneie o QR Code";
        document.getElementById("hint").textContent =
          "QR #" + d.qrId + " — escaneie assim que aparecer (atualiza sozinho se expirar)";
      }
    } catch {}
  }

  document.getElementById("resetBtn").addEventListener("click", async () => {
    document.getElementById("hint").textContent = "Limpando sessao...";
    await fetch("/api/whatsapp/reset", { method: "POST" });
    lastQrId = null;
    setTimeout(refreshQr, 3000);
  });

  refreshQr();
  setInterval(refreshQr, 2000);
  </script>
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
    console.log(`📡 API: GET /api/history | GET /api/qr | GET /api/whatsapp/status`);
    console.log("📋 Aguardando conexão do WhatsApp...\n");
  });
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar bot-backend:", error);
  process.exit(1);
});
