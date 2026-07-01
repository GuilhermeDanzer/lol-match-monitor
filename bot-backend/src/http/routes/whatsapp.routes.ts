import { Router, type Request, type Response } from "express";
import type { GroupMetadata, WASocket } from "@whiskeysockets/baileys";
import { prisma } from "@/prisma/client";
import { whatsappManager } from "@/whatsapp/WhatsAppManager";

export const whatsappRoutes = Router();

type UserIdParams = { userId: string };

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Wrapper resiliente para `groupFetchAllParticipating()`.
 *
 * O Baileys pode lançar "Connection Closed" / timeouts logo após o `"open"`
 * porque ainda está rodando init queries internas. A solução é tentar de
 * novo com pequeno backoff — o socket auto-reconecta entre attempts.
 */
async function fetchGroupsWithRetry(
  sock: WASocket,
  attempts = 3,
): Promise<{ [_: string]: GroupMetadata }> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await sock.groupFetchAllParticipating();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(1500 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("group_fetch_failed");
}

/**
 * Garante que o registro User existe (auto-bootstrap p/ mocks `user_123` do MVP).
 *
 * Em modo de Auth real, esse helper vira no-op — o User já foi criado no signup.
 * Aqui ele é defensivo: se o frontend vier com um id que ainda não existe,
 * cria com um email determinístico para não quebrar a FK do WaSession.
 */
async function ensureUser(userId: string): Promise<void> {
  await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email: `${userId}@local.dev`,
    },
    update: {},
  });
}

/**
 * GET /api/whatsapp/:userId/status
 *
 * Resposta: { connected: boolean, qr?: string }
 *
 * - Se já conectado, retorna { connected: true }.
 * - Se não, dispara `initializeUser` (idempotente — fire-and-forget) e
 *   devolve o último QR data URL conhecido. Na primeira chamada o QR ainda
 *   pode não estar pronto — o frontend faz polling de 3s.
 */
whatsappRoutes.get(
  "/:userId/status",
  async (
    req: Request<UserIdParams>,
    res: Response,
  ): Promise<void> => {
    const { userId } = req.params;
    if (!userId) {
      res.status(400).json({ error: "userId_required" });
      return;
    }

    try {
      if (whatsappManager.isConnected(userId)) {
        res.json({ connected: true });
        return;
      }

      await ensureUser(userId);

      // Não bloqueia — abre socket em background, próxima chamada já pega QR.
      void whatsappManager.initializeUser(userId).catch((err) => {
        console.error(`[http] initializeUser(${userId}) falhou:`, err);
      });

      const qr = whatsappManager.getLatestQrDataUrl(userId);
      res.json({ connected: false, qr });
    } catch (err) {
      console.error(`[http] GET /status erro:`, err);
      res.status(500).json({ error: "status_failed" });
    }
  },
);

/**
 * GET /api/whatsapp/:userId/groups
 *
 * Retorna [{ id, name }] ordenado por nome (case-insensitive).
 * 409 se o usuário não estiver conectado.
 */
interface TestMessageBody {
  whatsappGroupId?: string;
  message?: string;
}

/**
 * POST /api/whatsapp/:userId/reset
 *
 * Desconecta o socket (se aberto), limpa `WaSession.sessionData` no banco
 * e emite `logged_out`. Próxima chamada em `/status` gera QR novo.
 *
 * Necessário quando o Signal ratchet corrompe (Bad MAC Error) — a sessão
 * fica "conectada" mas não decripta mensagens recebidas → comandos travam.
 */
whatsappRoutes.post(
  "/:userId/reset",
  async (
    req: Request<UserIdParams>,
    res: Response,
  ): Promise<void> => {
    const { userId } = req.params;
    if (!userId) {
      res.status(400).json({ error: "userId_required" });
      return;
    }

    try {
      await whatsappManager.resetSession(userId);
      res.json({ ok: true, resetAt: new Date().toISOString() });
    } catch (err) {
      console.error(`[http] POST /reset erro:`, err);
      const detail = err instanceof Error ? err.message : "reset_failed";
      res.status(500).json({ error: "reset_failed", detail });
    }
  },
);

/**
 * POST /api/whatsapp/:userId/test
 *
 * Body: { whatsappGroupId: string, message?: string }
 *
 * Envia uma mensagem de teste para o grupo informado usando a sessão do
 * usuário. Útil pra confirmar visualmente, ANTES do primeiro tick do
 * CronQueue, que:
 *   - a sessão Baileys está realmente OK
 *   - o bot é membro do grupo
 *   - o `whatsappGroupId` salvo bate com o JID real
 */
whatsappRoutes.post(
  "/:userId/test",
  async (
    req: Request<UserIdParams, unknown, TestMessageBody>,
    res: Response,
  ): Promise<void> => {
    const { userId } = req.params;
    const { whatsappGroupId, message } = req.body ?? {};

    if (!userId || !whatsappGroupId) {
      res.status(400).json({
        error: "missing_fields",
        required: ["userId (URL)", "whatsappGroupId (body)"],
      });
      return;
    }

    if (!whatsappManager.isConnected(userId)) {
      res.status(409).json({ error: "not_connected" });
      return;
    }

    try {
      await whatsappManager.waitForReady(userId, 15_000);

      const text =
        message?.trim() ||
        "🎮 *LoL Match Monitor* — teste de conexão\n" +
          "Se você está vendo isso, o bot está pronto para enviar alertas neste grupo.";

      await whatsappManager.sendGroupMessage(userId, whatsappGroupId, text);
      res.json({ ok: true, sentAt: new Date().toISOString() });
    } catch (err) {
      console.error(`[http] POST /test erro:`, err);
      const detail = err instanceof Error ? err.message : "send_failed";
      res.status(500).json({ error: "send_failed", detail });
    }
  },
);

whatsappRoutes.get(
  "/:userId/groups",
  async (
    req: Request<UserIdParams>,
    res: Response,
  ): Promise<void> => {
    const { userId } = req.params;
    if (!userId) {
      res.status(400).json({ error: "userId_required" });
      return;
    }

    try {
      if (!whatsappManager.isConnected(userId)) {
        res.status(409).json({ error: "not_connected" });
        return;
      }

      // Espera o Baileys terminar init queries. Sem isso o primeiro
      // `groupFetchAllParticipating` logo após o `connected: true` quase
      // sempre falha com "Connection Closed".
      const ready = await whatsappManager.waitForReady(userId, 20_000);
      if (!ready) {
        console.warn(
          `[http] /groups: timeout aguardando ready em ${userId} — tentando mesmo assim`,
        );
      }

      const sock = await whatsappManager.initializeUser(userId);
      const groupsMap = await fetchGroupsWithRetry(sock);

      const groups = Object.values(groupsMap)
        .map((g) => ({
          id: g.id,
          name: g.subject?.trim() || "(sem nome)",
        }))
        .sort((a, b) =>
          a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
        );

      res.json({ groups });
    } catch (err) {
      console.error(`[http] GET /groups erro:`, err);
      res.status(500).json({ error: "groups_fetch_failed" });
    }
  },
);
