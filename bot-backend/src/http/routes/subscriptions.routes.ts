import { Router, type Request, type Response } from "express";
import { prisma } from "@/prisma/client";
import { createSubscription } from "@/services/subscriptionService";
import { whatsappManager } from "@/whatsapp/WhatsAppManager";

export const subscriptionRoutes = Router();

interface CreateSubscriptionBody {
  userId?: string;
  riotId?: string;
  whatsappGroupId?: string;
}

type UserIdParams = { userId: string };

function splitRiotId(
  riotId: string,
): { gameName: string; tagLine: string } | null {
  const trimmed = riotId.trim();
  const hashIdx = trimmed.lastIndexOf("#");
  if (hashIdx < 1 || hashIdx === trimmed.length - 1) return null;
  const gameName = trimmed.slice(0, hashIdx).trim();
  const tagLine = trimmed.slice(hashIdx + 1).trim();
  if (!gameName || !tagLine) return null;
  return { gameName, tagLine };
}

/**
 * POST /api/subscriptions
 *
 * Body: { userId, riotId, whatsappGroupId }
 *
 * 1. Faz parse de `riotId` em `gameName#tagLine`.
 * 2. Garante o User (auto-bootstrap p/ MVP).
 * 3. `createSubscription` resolve o PUUID via Riot, faz upsert do
 *    TrackedPlayer e cria/atualiza a Subscription idempotentemente.
 */
subscriptionRoutes.post(
  "/",
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as CreateSubscriptionBody;
    const userId = body.userId?.trim();
    const riotId = body.riotId?.trim();
    const whatsappGroupId = body.whatsappGroupId?.trim();

    if (!userId || !riotId || !whatsappGroupId) {
      res.status(400).json({
        error: "missing_fields",
        required: ["userId", "riotId", "whatsappGroupId"],
      });
      return;
    }

    const parsed = splitRiotId(riotId);
    if (!parsed) {
      res
        .status(400)
        .json({ error: "invalid_riot_id", hint: "use GameName#TagLine" });
      return;
    }

    try {
      await prisma.user.upsert({
        where: { id: userId },
        create: { id: userId, email: `${userId}@local.dev` },
        update: {},
      });

      const sub = await createSubscription({
        userId,
        gameName: parsed.gameName,
        tagLine: parsed.tagLine,
        whatsappGroupId,
      });

      res.status(201).json({
        subscription: {
          id: sub.id,
          userId: sub.userId,
          whatsappGroupId: sub.whatsappGroupId,
        },
        trackedPlayer: {
          id: sub.trackedPlayer.id,
          riotId: sub.trackedPlayer.riotId,
          puuid: sub.trackedPlayer.puuid,
        },
      });
    } catch (err) {
      console.error(`[http] POST /subscriptions erro:`, err);
      const message = err instanceof Error ? err.message : "subscribe_failed";
      res.status(500).json({ error: message });
    }
  },
);

/**
 * GET /api/subscriptions/:userId
 *
 * Lista todas as Subscriptions do usuário enriquecidas com:
 *   - `trackedPlayer.riotId` (PUUID + nome)
 *   - `groupName` resolvido via `groupMetadata()` quando o socket está
 *     conectado e ready. Se o nome não puder ser obtido, retorna `null`.
 *
 * Usado pela tela de diagnóstico do wizard para o usuário verificar quais
 * jogadores estão sendo monitorados e disparar mensagens de teste.
 */
subscriptionRoutes.get(
  "/:userId",
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
      const rows = await prisma.subscription.findMany({
        where: { userId },
        select: {
          id: true,
          whatsappGroupId: true,
          createdAt: true,
          trackedPlayer: {
            select: { id: true, riotId: true, puuid: true },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      // Hidrata nomes dos grupos via socket — best-effort. Se falhar
      // (socket não-ready, grupo removido, etc.), `groupName` fica null.
      const sock = whatsappManager.getSocket(userId);
      const groupNames = new Map<string, string>();

      if (sock && whatsappManager.isReady(userId)) {
        try {
          const groupsMap = await sock.groupFetchAllParticipating();
          for (const g of Object.values(groupsMap)) {
            groupNames.set(g.id, g.subject?.trim() || "");
          }
        } catch (err) {
          console.warn(
            `[http] /subscriptions/${userId} — falha ao hidratar nomes:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      const subscriptions = rows.map((r) => ({
        id: r.id,
        whatsappGroupId: r.whatsappGroupId,
        groupName: groupNames.get(r.whatsappGroupId) ?? null,
        riotId: r.trackedPlayer.riotId,
        trackedPlayerId: r.trackedPlayer.id,
        createdAt: r.createdAt.toISOString(),
      }));

      res.json({ subscriptions });
    } catch (err) {
      console.error(`[http] GET /subscriptions/:userId erro:`, err);
      res.status(500).json({ error: "list_failed" });
    }
  },
);
