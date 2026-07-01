import "@/loadEnv";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { prisma } from "@/prisma/client";
import { resolvePuuidByRiotId, getCurrentRankedStats } from "@/services/riot";

/**
 * Seed CLI — popula o banco com o mínimo necessário para o Worker SaaS
 * começar a operar:
 *
 *   User  ──▶  WaSession (vazia, dispara QR no boot)
 *          ╲
 *           ╲──▶  Subscription  ──▶  TrackedPlayer (PUUID via Riot API)
 *
 * Idempotente: re-rodar com o mesmo email reusa o usuário e adiciona novas
 * Subscriptions. Identifica o jogador globalmente pelo PUUID (deduplicado).
 */

function normalizeRiotId(gameName: string, tagLine: string): string {
  return `${gameName.trim()}#${tagLine.trim()}`.toLowerCase();
}

function parseRiotId(raw: string): { gameName: string; tagLine: string } {
  const trimmed = raw.trim();
  const hashIdx = trimmed.lastIndexOf("#");
  if (hashIdx <= 0 || hashIdx === trimmed.length - 1) {
    throw new Error(
      "Riot ID inválido. Use o formato Nome#Tag (ex: Faker#KR1).",
    );
  }
  return {
    gameName: trimmed.slice(0, hashIdx).trim(),
    tagLine: trimmed.slice(hashIdx + 1).trim(),
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeGroupJid(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Group ID vazio.");
  return trimmed.includes("@") ? trimmed : `${trimmed}@g.us`;
}

async function run(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  try {
    console.log("\n🌱 LoL Match Monitor — Seed interativo\n");

    // -----------------------------------------------------------------
    // 1. Email do usuário → upsert User + WaSession vazia
    // -----------------------------------------------------------------
    const emailRaw = await rl.question(
      "1. Digite o e-mail do usuário dono do bot: ",
    );
    if (!isValidEmail(emailRaw)) {
      throw new Error("E-mail inválido.");
    }
    const email = emailRaw.trim().toLowerCase();

    const nameRaw = await rl.question(
      "   (opcional) Nome do usuário [Enter para pular]: ",
    );
    const name = nameRaw.trim() || null;

    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name },
      update: name ? { name } : {},
    });

    // WaSession em branco — o WhatsAppManager detecta na próxima boot e
    // emite o QR no terminal (sem creds = QR pairing).
    await prisma.waSession.upsert({
      where: { userId: user.id },
      create: { userId: user.id, sessionData: {} },
      update: {},
    });

    console.log(`   ✔ User pronto: ${user.email} (id=${user.id})\n`);

    // -----------------------------------------------------------------
    // 2. Riot ID → resolve PUUID na Riot API + upsert TrackedPlayer
    // -----------------------------------------------------------------
    const riotIdRaw = await rl.question(
      "2. Digite o Riot ID do jogador a monitorar (Nome#Tag): ",
    );
    const { gameName, tagLine } = parseRiotId(riotIdRaw);

    if (!process.env.RIOT_API_KEY) {
      throw new Error(
        "RIOT_API_KEY não configurada no .env — necessária para resolver o PUUID.",
      );
    }

    console.log(`   → consultando Riot API para ${gameName}#${tagLine}...`);
    const account = await resolvePuuidByRiotId(gameName, tagLine);
    const ranked = await getCurrentRankedStats(account.puuid).catch(() => null);

    const player = await prisma.trackedPlayer.upsert({
      where: { puuid: account.puuid },
      create: {
        puuid: account.puuid,
        riotId: normalizeRiotId(account.gameName, account.tagLine),
        eloSnapshot: {
          gameName: account.gameName,
          tagLine: account.tagLine,
          tier: ranked?.tier ?? null,
          rank: ranked?.rank ?? null,
          leaguePoints: ranked?.leaguePoints ?? null,
          updatedAt: new Date().toISOString(),
        },
      },
      update: {
        riotId: normalizeRiotId(account.gameName, account.tagLine),
        eloSnapshot: {
          gameName: account.gameName,
          tagLine: account.tagLine,
          tier: ranked?.tier ?? null,
          rank: ranked?.rank ?? null,
          leaguePoints: ranked?.leaguePoints ?? null,
          updatedAt: new Date().toISOString(),
        },
      },
    });

    const eloLabel = ranked
      ? `${ranked.tier} ${ranked.rank} ${ranked.leaguePoints} PDL`
      : "unranked";
    console.log(
      `   ✔ TrackedPlayer pronto: ${account.gameName}#${account.tagLine}\n` +
        `     puuid=${account.puuid.slice(0, 16)}…  elo=${eloLabel}\n`,
    );

    // -----------------------------------------------------------------
    // 3. Group JID → Subscription
    // -----------------------------------------------------------------
    const groupRaw = await rl.question(
      "3. Digite o ID do Grupo do WhatsApp (ex: 120363000000000000@g.us): ",
    );
    const whatsappGroupId = normalizeGroupJid(groupRaw);

    const subscription = await prisma.subscription.upsert({
      where: {
        userId_trackedPlayerId_whatsappGroupId: {
          userId: user.id,
          trackedPlayerId: player.id,
          whatsappGroupId,
        },
      },
      create: {
        userId: user.id,
        trackedPlayerId: player.id,
        whatsappGroupId,
      },
      update: {},
    });

    console.log(`   ✔ Subscription pronta (id=${subscription.id})\n`);

    // -----------------------------------------------------------------
    // 4. Resumo final
    // -----------------------------------------------------------------
    console.log("─".repeat(70));
    console.log("✅ Seed concluído com sucesso!");
    console.log("─".repeat(70));
    console.log(`   userId           : ${user.id}`);
    console.log(`   email            : ${user.email}`);
    console.log(`   trackedPlayerId  : ${player.id}`);
    console.log(`   riotId           : ${account.gameName}#${account.tagLine}`);
    console.log(`   whatsappGroupId  : ${whatsappGroupId}`);
    console.log(`   subscriptionId   : ${subscription.id}`);
    console.log("─".repeat(70));
    console.log(
      "\n📲 Para gerar o QR Code, inicie o Worker. O WhatsAppManager detectará\n" +
        "   o usuário sem sessão e emitirá o QR no terminal.\n\n" +
        "   $ npm run dev\n",
    );
  } finally {
    rl.close();
  }
}

run()
  .catch((err) => {
    console.error("\n❌ Falha no seed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
