import {
  formatExtendedWhatsAppMessage,
  formatHelpCommand,
  formatHistoryCommand,
  formatJourneyCommand,
} from "@/lib/formatMatch";
import { formatEloCompactLabel, formatEloProgression } from "@/lib/lpCalculator";
import { getAllJourneyMatches } from "@/lib/journeyStore";
import { getStoredRankedSnapshot } from "@/lib/matchStore";
import {
  extractPlayerMatchData,
  getConfiguredGameName,
  getCurrentRankedStats,
  getDisplayName,
  getMatchDetails,
  getMatchHistory,
  getMatchesCountLastHours,
  getPlayerPuuid,
  getRecentMatchIds,
} from "@/services/riot";

const COMMANDS = [
  "status",
  "historico",
  "history",
  "lol",
  "jornada",
  "ajuda",
  "help",
] as const;

const MATCHES_WINDOW_HOURS = 6;

function getCommandPrefix(): string {
  return process.env.WHATSAPP_COMMAND_PREFIX ?? "!";
}

/** Verifica se o texto é um comando (ex: !status) */
export function isCommandMessage(body: string): boolean {
  return parseCommand(body) !== null;
}

/** Extrai o nome do comando (ex: "!status" → "status") */
function parseCommand(body: string): string | null {
  const prefix = getCommandPrefix();
  const trimmed = body.trim().toLowerCase();

  if (!trimmed.startsWith(prefix)) return null;

  const command = trimmed.slice(prefix.length).split(/\s+/)[0];
  if (!command || !COMMANDS.includes(command as (typeof COMMANDS)[number])) {
    return null;
  }

  return command;
}

/** Monta alerta completo ao vivo (última partida + stats), sem depender de partida nova */
async function buildLiveStatusMessage(): Promise<string> {
  const puuid = await getPlayerPuuid();
  const displayName = getDisplayName();

  const [matchIds, rankedStats, matchesLast6h, rankedBefore] =
    await Promise.all([
      getRecentMatchIds(puuid, 1),
      getCurrentRankedStats(puuid),
      getMatchesCountLastHours(puuid, MATCHES_WINDOW_HOURS),
      getStoredRankedSnapshot(),
    ]);

  if (matchIds.length === 0) {
    return `⚔️ *${getConfiguredGameName()}* — nenhuma partida recente encontrada.`;
  }

  const matchDetails = await getMatchDetails(matchIds[0]);
  const matchData = extractPlayerMatchData(matchDetails, puuid);

  const progression =
    rankedBefore && rankedStats
      ? formatEloProgression(rankedBefore, rankedStats)
      : rankedStats
        ? {
            kind: "held" as const,
            label: `Manteve ${formatEloCompactLabel(rankedStats)}`,
          }
        : null;

  return formatExtendedWhatsAppMessage(matchData, {
    displayName,
    rankedBefore,
    rankedAfter: rankedStats,
    rankedStats,
    matchesLast6h,
    eloProgression: progression?.label ?? null,
  });
}

/** Processa comandos enviados no grupo do WhatsApp */
export async function handleWhatsAppCommand(
  body: string,
  reply: (text: string) => Promise<void>,
): Promise<void> {
  const command = parseCommand(body);
  if (!command) return;

  const gameName = getConfiguredGameName();

  try {
    if (command === "ajuda" || command === "help") {
      await reply(formatHelpCommand(gameName));
      return;
    }

    if (command === "status" || command === "lol") {
      await reply(await buildLiveStatusMessage());
      return;
    }

    if (command === "historico" || command === "history") {
      const matches = await getMatchHistory(5);
      await reply(formatHistoryCommand(matches, gameName));
      return;
    }

    if (command === "jornada") {
      const puuid = await getPlayerPuuid();
      const [matches, rankedStats] = await Promise.all([
        getAllJourneyMatches(),
        getCurrentRankedStats(puuid),
      ]);
      await reply(
        formatJourneyCommand({
          displayName: getDisplayName(),
          matches,
          rankedStats,
        }),
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao consultar a Riot API";
    console.error("[WhatsApp comando]", message);
    await reply(`❌ *Erro*\n\n${message}`);
  }
}
