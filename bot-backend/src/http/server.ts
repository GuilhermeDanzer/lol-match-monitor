import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { whatsappRoutes } from "@/http/routes/whatsapp.routes";
import { subscriptionRoutes } from "@/http/routes/subscriptions.routes";

/**
 * Mini-API HTTP que roda dentro do mesmo processo do Worker.
 *
 * Compartilha o singleton `whatsappManager` em memória com os Workers BullMQ,
 * o que permite expor o QR Code e a lista de grupos para a setup-UI Next.js
 * sem precisar de um segundo processo / RPC.
 *
 * Endpoints expostos (read-only / controle):
 *   GET  /healthz
 *   GET  /api/whatsapp/:userId/status
 *   GET  /api/whatsapp/:userId/groups
 *   POST /api/subscriptions
 */

function parseAllowedOrigins(): string[] | "*" {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw || raw === "*") return "*";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function createHttpApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  const allowed = parseAllowedOrigins();
  app.use(
    cors({
      origin: allowed === "*" ? true : allowed,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-User-Id"],
    }),
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  app.use("/api/whatsapp", whatsappRoutes);
  app.use("/api/subscriptions", subscriptionRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: "not_found", path: req.path });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message =
      err instanceof Error ? err.message : "internal_server_error";
    console.error("[http] erro não tratado:", err);
    res.status(500).json({ error: message });
  });

  return app;
}

export interface HttpServerHandle {
  close: () => Promise<void>;
}

export function startHttpServer(port: number): HttpServerHandle {
  const app = createHttpApp();
  const server = app.listen(port, () => {
    console.log(`[http] API escutando em :${port}`);
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
