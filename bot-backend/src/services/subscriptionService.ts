import { prisma } from "@/prisma/client";
import { upsertTrackedPlayer } from "@/services/trackedPlayerService";

/**
 * Operações de Subscription usadas pelo Worker.
 *
 * `createSubscription` é útil para seed/CLI; o Worker em si chama apenas
 * `listSubscriptionsForPlayer`.
 */

export async function createSubscription(input: {
  userId: string;
  gameName: string;
  tagLine: string;
  whatsappGroupId: string;
}) {
  const player = await upsertTrackedPlayer(input.gameName, input.tagLine);

  return prisma.subscription.upsert({
    where: {
      userId_trackedPlayerId_whatsappGroupId: {
        userId: input.userId,
        trackedPlayerId: player.id,
        whatsappGroupId: input.whatsappGroupId.trim(),
      },
    },
    create: {
      userId: input.userId,
      trackedPlayerId: player.id,
      whatsappGroupId: input.whatsappGroupId.trim(),
    },
    update: {},
    include: { trackedPlayer: true },
  });
}

/** Quem recebe alertas desse TrackedPlayer e em qual grupo. */
export async function listSubscriptionsForPlayer(trackedPlayerId: string) {
  return prisma.subscription.findMany({
    where: { trackedPlayerId },
    select: {
      id: true,
      userId: true,
      whatsappGroupId: true,
    },
  });
}

/** Todos os userIds que possuem ao menos 1 subscription ativa. */
export async function listActiveUserIds(): Promise<string[]> {
  const rows = await prisma.subscription.findMany({
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}
