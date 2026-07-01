import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function buildDatasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    const params = url.searchParams;

    // Pooler Supabase (porta 6543) exige pgbouncer=true no Prisma.
    if (url.port === "6543" && !params.has("pgbouncer")) {
      params.set("pgbouncer", "true");
    }

    // Worker 24/7: evita esgotar o pool do Supabase com muitas conexões.
    if (!params.has("connection_limit")) {
      params.set("connection_limit", process.env.DATABASE_CONNECTION_LIMIT ?? "5");
    }

    // Fecha sockets ociosos antes do pooler derrubar (mitiga code 10054).
    if (!params.has("pool_timeout")) {
      params.set("pool_timeout", "30");
    }

    url.search = params.toString();
    return url.toString();
  } catch {
    return raw;
  }
}

const datasourceUrl = buildDatasourceUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: datasourceUrl
      ? { db: { url: datasourceUrl } }
      : undefined,
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
