import { prisma } from "@/prisma/client";
import type { MatchDetailResponse } from "@/types/riot";

/** Cache global de Match-V5 no PostgreSQL (imutável após fim da partida). */
export async function getCachedMatchFromDb(
  matchId: string,
): Promise<MatchDetailResponse | null> {
  const row = await prisma.matchCache.findUnique({ where: { matchId } });
  if (!row) return null;
  return row.data as unknown as MatchDetailResponse;
}

export async function cacheMatchInDb(
  matchId: string,
  detail: MatchDetailResponse,
): Promise<void> {
  await prisma.matchCache.upsert({
    where: { matchId },
    create: { matchId, data: detail as object },
    update: { data: detail as object },
  });
}
