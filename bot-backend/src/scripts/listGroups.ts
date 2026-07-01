import "@/loadEnv";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { GroupMetadata } from "@whiskeysockets/baileys";
import { prisma } from "@/prisma/client";
import { readSnapshot } from "@/services/trackedPlayerService";
import {
  whatsappManager,
  type ConnectionEvent,
} from "@/whatsapp/WhatsAppManager";

/**
 * CLI — lista grupos WhatsApp da conta paireada e (opcionalmente) atribui o
 * JID escolhido a uma Subscription existente, substituindo o placeholder
 * que ficou no banco depois do `npm run seed`.
 *
 * Uso:
 *   npm run groups               (escolhe User interativamente)
 *   npm run groups -- <userId>   (pula a escolha de User)
 *
 * IMPORTANTE: pare o Worker (Ctrl+C em `npm run dev`) antes de rodar.
 * Duas instâncias usando a mesma sessão WhatsApp disputam o socket e ambas
 * caem com "Stream Errored (conflict)".
 */

interface PairedUser {
  id: string;
  email: string;
  hasCreds: boolean;
}

async function listPairedUsers(): Promise<PairedUser[]> {
  const rows = await prisma.user.findMany({
    where: { waSession: { isNot: null } },
    select: {
      id: true,
      email: true,
      waSession: { select: { sessionData: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((u) => {
    const data = u.waSession?.sessionData as
      | { creds?: { me?: { id?: string } } }
      | null
      | undefined;
    return {
      id: u.id,
      email: u.email,
      hasCreds: Boolean(data?.creds?.me?.id),
    };
  });
}

async function pickUserId(rl: readline.Interface): Promise<string> {
  const arg = process.argv[2]?.trim();
  if (arg) return arg;

  const users = await listPairedUsers();
  if (users.length === 0) {
    throw new Error(
      "Nenhum usuário com WaSession. Rode `npm run seed` para criar um.",
    );
  }

  if (users.length === 1) {
    const only = users[0];
    if (!only.hasCreds) {
      throw new Error(
        `Usuário ${only.email} não está paireado. Rode \`npm run dev\` e escaneie o QR primeiro.`,
      );
    }
    console.log(`→ usando único user disponível: ${only.email} (${only.id})\n`);
    return only.id;
  }

  console.log("Usuários cadastrados:");
  users.forEach((u, i) => {
    const tag = u.hasCreds ? "✓ paireado" : "✗ sem pareamento";
    console.log(`  [${i + 1}] ${u.email}  (${tag})`);
  });

  const ans = await rl.question("\nEscolha o número do usuário: ");
  const idx = parseInt(ans.trim(), 10) - 1;
  if (Number.isNaN(idx) || !users[idx]) {
    throw new Error("Seleção inválida.");
  }
  if (!users[idx].hasCreds) {
    throw new Error("Esse usuário não está paireado. Rode `npm run dev` primeiro.");
  }
  return users[idx].id;
}

/** Aguarda a conexão Baileys ficar pronta (ou falhar com motivo claro). */
function waitForConnected(userId: string, timeoutMs = 60_000): Promise<void> {
  if (whatsappManager.isConnected(userId)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      whatsappManager.events.off("connection", handler);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timeout (${timeoutMs / 1000}s) aguardando conexão WhatsApp. ` +
            "Verifique se não há outra instância do Worker rodando.",
        ),
      );
    }, timeoutMs);

    const handler = (evt: ConnectionEvent): void => {
      if (evt.userId !== userId) return;
      if (evt.status === "connected" || evt.status === "ready") {
        cleanup();
        resolve();
      } else if (evt.status === "qr") {
        cleanup();
        reject(
          new Error(
            "Sessão sem creds — Baileys está pedindo QR. Pareie via `npm run dev` antes.",
          ),
        );
      } else if (evt.status === "logged_out") {
        cleanup();
        reject(new Error("Sessão deslogada. Pareie de novo via `npm run dev`."));
      }
    };

    whatsappManager.events.on("connection", handler);
  });
}

/**
 * Espera o sinal `ready` do Baileys (init queries completas — fetchProps +
 * sync de grupos). Sem isso, queries como `groupFetchAllParticipating` podem
 * falhar com "Connection Closed" / "Timed Out" porque o socket ainda está
 * em init. Tem fallback de timeout — se o sinal não vier (Baileys às vezes
 * não emite em sessões pequenas), seguimos em frente e o retry cobre o resto.
 */
function waitForReady(userId: string, timeoutMs = 30_000): Promise<boolean> {
  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      whatsappManager.events.off("connection", handler);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const handler = (evt: ConnectionEvent): void => {
      if (evt.userId !== userId) return;
      if (evt.status === "ready") {
        cleanup();
        resolve(true);
      }
    };

    whatsappManager.events.on("connection", handler);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * `groupFetchAllParticipating` é flaky em redes lentas — pode cair com
 * "Connection Closed" se o socket ainda estiver finalizando init. Tenta
 * até `attempts` vezes com pausa entre uma e outra, esperando a reconexão
 * automática do WhatsAppManager quando necessário.
 */
async function fetchGroupsWithRetry(
  userId: string,
  attempts = 4,
): Promise<GroupMetadata[]> {
  for (let i = 1; i <= attempts; i++) {
    try {
      const sock = whatsappManager.getSocket(userId);
      if (!sock) {
        await waitForConnected(userId, 30_000);
        continue;
      }
      const groupsByJid = await sock.groupFetchAllParticipating();
      return Object.values(groupsByJid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (i === attempts) throw err;
      console.warn(
        `   tentativa ${i}/${attempts} falhou (${msg}). Aguardando reconexão...`,
      );
      await sleep(4_000);
    }
  }
  throw new Error("unreachable");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function printGroupsTable(groups: GroupMetadata[]): void {
  console.log("\n" + "─".repeat(96));
  console.log(
    `${"  #".padEnd(4)}${"participantes".padEnd(16)}${"JID (whatsappGroupId)".padEnd(40)}nome`,
  );
  console.log("─".repeat(96));
  groups.forEach((g, i) => {
    const num = `${String(i + 1).padStart(2, " ")}.`.padEnd(4);
    const count = String(g.participants?.length ?? 0).padStart(4, " ").padEnd(16);
    const jid = g.id.padEnd(40);
    const name = truncate(g.subject ?? "(sem nome)", 40);
    console.log(`${num}${count}${jid}${name}`);
  });
  console.log("─".repeat(96));
  console.log(`Total: ${groups.length} grupo(s).\n`);
}

interface SubscriptionRow {
  id: string;
  whatsappGroupId: string;
  trackedPlayer: { id: string; riotId: string; eloSnapshot: unknown };
}

async function assignFlow(
  rl: readline.Interface,
  userId: string,
  groups: GroupMetadata[],
): Promise<void> {
  const subs = (await prisma.subscription.findMany({
    where: { userId },
    select: {
      id: true,
      whatsappGroupId: true,
      trackedPlayer: {
        select: { id: true, riotId: true, eloSnapshot: true },
      },
    },
    orderBy: { createdAt: "asc" },
  })) as SubscriptionRow[];

  if (subs.length === 0) {
    console.log(
      "(esse user não tem Subscriptions — rode `npm run seed` para criar uma)\n",
    );
    return;
  }

  // Set de JIDs reais para flagear placeholders
  const realJids = new Set(groups.map((g) => g.id));

  console.log("Subscriptions do usuário:");
  console.log("─".repeat(96));
  subs.forEach((s, i) => {
    const snap = readSnapshot({ eloSnapshot: s.trackedPlayer.eloSnapshot });
    const display = snap.gameName
      ? `${snap.gameName}#${snap.tagLine ?? ""}`
      : s.trackedPlayer.riotId;
    const valid = realJids.has(s.whatsappGroupId) ? "✓" : "⚠";
    console.log(
      `  [${i + 1}] ${valid}  ${display.padEnd(28)} ${s.whatsappGroupId}`,
    );
  });
  console.log("─".repeat(96));
  console.log("  Legenda: ✓ = JID válido (grupo existe) | ⚠ = placeholder/inválido\n");

  const subAns = await rl.question(
    "Atribuir grupo a qual subscription? (número, ou Enter para sair) ",
  );
  if (!subAns.trim()) {
    console.log("→ nenhuma alteração feita.\n");
    return;
  }
  const subIdx = parseInt(subAns.trim(), 10) - 1;
  if (Number.isNaN(subIdx) || !subs[subIdx]) {
    throw new Error("Seleção de subscription inválida.");
  }
  const sub = subs[subIdx];

  const grpAns = await rl.question(
    `Atribuir qual grupo da lista a essa subscription? (1-${groups.length}) `,
  );
  const grpIdx = parseInt(grpAns.trim(), 10) - 1;
  if (Number.isNaN(grpIdx) || !groups[grpIdx]) {
    throw new Error("Seleção de grupo inválida.");
  }
  const group = groups[grpIdx];

  if (group.id === sub.whatsappGroupId) {
    console.log(
      `→ subscription já aponta para esse grupo (${group.subject}). Nada a fazer.\n`,
    );
    return;
  }

  // Verifica conflito com unique [userId, trackedPlayerId, whatsappGroupId]
  const conflict = await prisma.subscription.findUnique({
    where: {
      userId_trackedPlayerId_whatsappGroupId: {
        userId,
        trackedPlayerId: sub.trackedPlayer.id,
        whatsappGroupId: group.id,
      },
    },
  });
  if (conflict && conflict.id !== sub.id) {
    throw new Error(
      `Já existe uma subscription para esse player + grupo (id=${conflict.id}). ` +
        "Apague a antiga antes ou escolha outra subscription.",
    );
  }

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { whatsappGroupId: group.id },
  });

  console.log("\n" + "─".repeat(70));
  console.log("✅ Subscription atualizada!");
  console.log("─".repeat(70));
  console.log(`   subscriptionId   : ${sub.id}`);
  console.log(`   antes            : ${sub.whatsappGroupId}`);
  console.log(`   depois           : ${group.id}`);
  console.log(`   nome do grupo    : ${group.subject ?? "(sem nome)"}`);
  console.log("─".repeat(70));
  console.log(
    "\nAgora é só iniciar o Worker (`npm run dev`) que as notificações\n" +
      "vão chegar nesse grupo na próxima partida detectada.\n",
  );
}

async function run(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    console.log("\n📋 LoL Match Monitor — Listagem & atribuição de grupos\n");

    const userId = await pickUserId(rl);

    console.log("→ conectando ao WhatsApp...");
    await whatsappManager.initializeUser(userId);
    await waitForConnected(userId);
    console.log("✔ conectado. Aguardando fim das init queries do Baileys...");

    const ready = await waitForReady(userId, 30_000);
    console.log(
      ready
        ? "✔ init queries concluídas.\n"
        : "⚠ init queries não sinalizaram fim em 30s — seguindo com retry.\n",
    );

    console.log("→ buscando grupos via groupFetchAllParticipating()...");
    const groups = (await fetchGroupsWithRetry(userId)).sort(
      (a, b) => (b.participants?.length ?? 0) - (a.participants?.length ?? 0),
    );

    if (groups.length === 0) {
      console.log("\n(esta conta WhatsApp não participa de nenhum grupo)\n");
      return;
    }

    printGroupsTable(groups);
    await assignFlow(rl, userId, groups);
  } finally {
    rl.close();
  }
}

run()
  .catch((err) => {
    console.error("\n❌ Falha:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await whatsappManager.shutdown();
    await prisma.$disconnect();
    // Pino + Baileys têm timers/streams residuais. Força saída limpa.
    process.exit();
  });
