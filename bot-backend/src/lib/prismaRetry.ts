import { Prisma } from "@prisma/client";
import { sleep } from "@/lib/delay";
import { prisma } from "@/prisma/client";

const CONNECTION_ERROR_MARKERS = [
  "Server has closed the connection",
  "ConnectionReset",
  "connection was closed",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "Connection terminated",
  "Can't reach database server",
  "Connection pool timeout",
] as const;

const RETRYABLE_PRISMA_CODES = new Set([
  "P1001", // unreachable
  "P1002", // timed out
  "P1008", // operations timed out
  "P1017", // server closed connection
  "P2024", // pool timeout
]);

export function isPrismaConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_PRISMA_CODES.has(error.code);
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return CONNECTION_ERROR_MARKERS.some((marker) => message.includes(marker));
}

/**
 * Executa uma query Prisma com retry + `$connect()` após queda de conexão.
 *
 * Supabase/pooler fecha sockets ociosos; o Baileys dispara vários `upsert` na
 * reconexão — sem isso a sessão WA corrompe ou o worker trava.
 */
export async function withPrismaRetry<T>(
  operation: () => Promise<T>,
  options?: { retries?: number; label?: string },
): Promise<T> {
  const retries = options?.retries ?? 4;
  const label = options?.label ?? "prisma";

  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = isPrismaConnectionError(error);
      if (!retryable || attempt >= retries - 1) {
        throw error;
      }

      const waitMs = 250 * 2 ** attempt;
      console.warn(
        `[${label}] conexão PostgreSQL caiu (tentativa ${attempt + 1}/${retries}) — reconectando em ${waitMs}ms…`,
      );

      try {
        await prisma.$disconnect();
      } catch {
        // ignore — socket já estava morto
      }
      await sleep(waitMs);
      await prisma.$connect();
    }
  }

  throw lastError;
}
