import "@/loadEnv";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { prisma } from "@/prisma/client";

/**
 * Utilitário interativo: lista todos os Users + WaSession, mostra
 * subscriptions e permite deletar sessões órfãs.
 *
 *   npm run sessions
 *
 * Use quando um número de WhatsApp foi pareado com user_id antigo, o usuário
 * pareou de novo num user_id novo (e o WhatsApp expulsou o antigo). O Worker
 * continua tentando reabrir a sessão órfã — esse script limpa.
 */

interface UserRow {
  id: string;
  email: string;
  createdAt: Date;
  waSession: { id: string; updatedAt: Date } | null;
  _count: { subscriptions: number };
}

async function listAll(): Promise<UserRow[]> {
  return prisma.user.findMany({
    select: {
      id: true,
      email: true,
      createdAt: true,
      waSession: { select: { id: true, updatedAt: true } },
      _count: { select: { subscriptions: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

function printUsers(users: UserRow[]): void {
  console.log("\n📋 Users cadastrados:\n");
  users.forEach((u, i) => {
    const wa = u.waSession
      ? `WA paired @ ${u.waSession.updatedAt.toISOString()}`
      : "sem WaSession";
    console.log(
      `  ${i + 1}. ${u.email}  (id=${u.id})\n     ${wa}  |  ${u._count.subscriptions} subscription(s)`,
    );
  });
}

async function deleteWaSession(userId: string): Promise<void> {
  await prisma.waSession.delete({ where: { userId } });
}

async function deleteUserCascade(userId: string): Promise<void> {
  // Subscriptions → WaSession → User (Prisma cascade configurado no schema)
  await prisma.user.delete({ where: { id: userId } });
}

async function run(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    const users = await listAll();
    if (users.length === 0) {
      console.log("Nenhum User cadastrado.");
      return;
    }

    printUsers(users);

    console.log("\nAções:");
    console.log("  s <n>  — deletar WaSession do user #n (libera novo QR)");
    console.log("  u <n>  — deletar User #n inteiro (User + WaSession + Subs)");
    console.log("  q      — sair");

    while (true) {
      const ans = (await rl.question("\n> ")).trim();
      if (!ans || ans === "q") break;

      const match = ans.match(/^([su])\s+(\d+)$/i);
      if (!match) {
        console.log("Formato inválido. Use: s 1 / u 2 / q");
        continue;
      }

      const action = match[1].toLowerCase();
      const idx = Number(match[2]) - 1;
      if (idx < 0 || idx >= users.length) {
        console.log("Índice fora do range.");
        continue;
      }

      const user = users[idx];
      try {
        if (action === "s") {
          if (!user.waSession) {
            console.log("Este user não tem WaSession para deletar.");
            continue;
          }
          await deleteWaSession(user.id);
          console.log(
            `✔ WaSession de ${user.email} deletada. Reinicie o worker para limpar do Map em memória.`,
          );
        } else {
          await deleteUserCascade(user.id);
          console.log(`✔ User ${user.email} removido em cascata.`);
        }
        // Refresh
        const refreshed = await listAll();
        printUsers(refreshed);
        users.length = 0;
        users.push(...refreshed);
      } catch (err) {
        console.error(
          `Falha: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
