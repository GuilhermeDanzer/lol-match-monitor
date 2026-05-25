import { getRankedUpdateDelayMs, sleep } from "@/lib/delay";
import { formatPeriodicReport } from "@/lib/formatMatch";
import {
  addJourneyMatch,
  getUnnotifiedMatches,
  markMatchesNotified,
  summarizeJourneyMatches,
} from "@/lib/journeyStore";
import { calculateLpChange } from "@/lib/lpCalculator";
import {
  getLastMatchId,
  getStoredRankedSnapshot,
  setLastMatchId,
  setRankedSnapshot,
  updateMatchStore,
} from "@/lib/matchStore";
import {
  extractPlayerMatchData,
  getCurrentRankedStats,
  getDisplayName,
  getMatchDetails,
  getPlayerPuuid,
  getRecentMatchIds,
} from "@/services/riot";
import { isWhatsAppReady, sendGroupMessage } from "@/services/whatsapp";

/** IDs ranqueados novos desde a última sincronização (ordem cronológica) */
async function getUnprocessedRankedMatchIds(
  puuid: string,
  lastProcessedId: string,
): Promise<string[]> {
  const recentIds = await getRecentMatchIds(puuid, 20);
  const newIds: string[] = [];

  for (const id of recentIds) {
    if (id === lastProcessedId) break;
    newIds.push(id);
  }

  return newIds.reverse();
}

/**
 * Cron silencioso (15 min): detecta partidas ranqueadas novas,
 * calcula PDL e salva no journey.json sem enviar WhatsApp.
 */
export async function syncRankedMatches(): Promise<void> {
  console.log(
    `[${new Date().toISOString()}] Sincronizando partidas ranqueadas...`,
  );

  try {
    const puuid = await getPlayerPuuid();
    const recentIds = await getRecentMatchIds(puuid, 1);

    if (recentIds.length === 0) {
      console.log("Nenhuma partida ranqueada encontrada.");
      return;
    }

    const latestMatchId = recentIds[0];
    const lastProcessedId = await getLastMatchId();

    if (!lastProcessedId) {
      const rankedStats = await getCurrentRankedStats(puuid);
      await updateMatchStore({ lastMatchId: latestMatchId });
      if (rankedStats) {
        await setRankedSnapshot(rankedStats);
      }
      console.log(`Baseline ranqueada definida: ${latestMatchId}`);
      return;
    }

    const newIds = await getUnprocessedRankedMatchIds(puuid, lastProcessedId);
    if (newIds.length === 0) {
      console.log("Nenhuma partida ranqueada nova.");
      return;
    }

    let rankedBefore = await getStoredRankedSnapshot();
    const delayMs = getRankedUpdateDelayMs();

    for (const matchId of newIds) {
      const matchDetails = await getMatchDetails(matchId);
      const matchData = extractPlayerMatchData(matchDetails, puuid);

      console.log(
        `Nova partida ranqueada ${matchId}. Aguardando ${delayMs / 1000}s para PDL...`,
      );
      await sleep(delayMs);

      const rankedAfter = await getCurrentRankedStats(puuid);
      let lpChange = 0;

      if (rankedBefore && rankedAfter) {
        const lp = calculateLpChange(rankedBefore, rankedAfter, matchData.win);
        lpChange = lp.delta ?? 0;
      }

      await addJourneyMatch({
        matchId: matchData.matchId,
        timestamp: matchData.gameCreation,
        championName: matchData.championName,
        kills: matchData.kills,
        deaths: matchData.deaths,
        assists: matchData.assists,
        win: matchData.win,
        damage: matchData.damage,
        matchMaxDamage: matchData.matchMaxDamage,
        gameDuration: matchData.gameDuration,
        gameMode: matchData.gameMode,
        tier: rankedAfter?.tier ?? "",
        rank: rankedAfter?.rank ?? "",
        leaguePoints: rankedAfter?.leaguePoints ?? 0,
        lpChange,
        notified: false,
      });

      if (rankedAfter) {
        rankedBefore = rankedAfter;
        await setRankedSnapshot(rankedAfter);
      }

      const lpLabel = lpChange >= 0 ? `+${lpChange}` : `${lpChange}`;
      console.log(
        `Partida ${matchId} salva no histórico (PDL: ${lpLabel}).`,
      );
    }

    const lastSyncedId = newIds[newIds.length - 1];
    if (lastSyncedId) {
      await setLastMatchId(lastSyncedId);
    }
  } catch (error) {
    console.error("Erro ao sincronizar partidas ranqueadas:", error);
  }
}

/**
 * Cron de relatório (6 h): envia resumo das partidas com notified=false
 * e marca como notificadas. Não envia nada se não houver partidas pendentes.
 */
export async function sendJourneyReport(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Gerando relatório periódico...`);

  try {
    const pending = await getUnnotifiedMatches();
    if (pending.length === 0) {
      console.log(
        "Nenhuma partida pendente de notificação. Relatório omitido.",
      );
      return;
    }

    const puuid = await getPlayerPuuid();
    const rankedStats = await getCurrentRankedStats(puuid);
    const displayName = getDisplayName();
    const summary = summarizeJourneyMatches(pending);

    const message = formatPeriodicReport({
      displayName,
      summary,
      rankedStats,
    });

    if (isWhatsAppReady()) {
      await sendGroupMessage(message);
      await markMatchesNotified(pending.map((m) => m.matchId));
      console.log(`Relatório enviado (${pending.length} partida(s)).`);
    } else {
      console.warn("Relatório pendente: WhatsApp offline.");
    }
  } catch (error) {
    console.error("Erro ao enviar relatório periódico:", error);
  }
}
