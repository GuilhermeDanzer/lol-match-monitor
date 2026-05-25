import {
  addJourneyMatch,
  getAllJourneyMatches,
  hasJourneyMatch,
} from "@/lib/journeyStore";
import {
  getLastMatchId,
  setLastMatchId,
  setRankedSnapshot,
  updateMatchStore,
} from "@/lib/matchStore";
import {
  extractPlayerMatchData,
  getCurrentRankedStats,
  getMatchDetails,
  getPlayerPuuid,
  getRecentMatchIds,
} from "@/services/riot";

const RIOT_DELAY_MS = 250;
const DEFAULT_SEED_COUNT = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let seedPromise: Promise<number> | null = null;

/**
 * Se journey.json estiver vazio (ex.: Render sem volume),
 * importa as últimas partidas ranqueadas da Riot API.
 */
export async function seedJourneyFromRiot(
  count = DEFAULT_SEED_COUNT,
): Promise<number> {
  const existing = await getAllJourneyMatches();
  if (existing.length > 0) return 0;

  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    console.log(`[seed] journey vazio — importando até ${count} partidas...`);

    const puuid = await getPlayerPuuid();
    const ids = await getRecentMatchIds(puuid, count);
    const rankedStats = await getCurrentRankedStats(puuid);

    if (ids.length === 0) {
      console.log("[seed] Nenhuma partida ranqueada na Riot.");
      return 0;
    }

    let added = 0;

    for (const matchId of [...ids].reverse()) {
      if (await hasJourneyMatch(matchId)) continue;

      try {
        const details = await getMatchDetails(matchId);
        const data = extractPlayerMatchData(details, puuid);

        await addJourneyMatch({
          matchId: data.matchId,
          timestamp: data.gameCreation,
          championName: data.championName,
          kills: data.kills,
          deaths: data.deaths,
          assists: data.assists,
          win: data.win,
          damage: data.damage,
          matchMaxDamage: data.matchMaxDamage,
          gameDuration: data.gameDuration,
          gameMode: data.gameMode,
          tier: rankedStats?.tier ?? "",
          rank: rankedStats?.rank ?? "",
          leaguePoints: rankedStats?.leaguePoints ?? 0,
          lpChange: 0,
          notified: true,
        });
        added += 1;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[seed] Falha em ${matchId}: ${msg}`);
      }

      await sleep(RIOT_DELAY_MS);
    }

    const latestId = ids[0];
    const lastKnown = await getLastMatchId();
    if (!lastKnown && latestId) {
      await updateMatchStore({ lastMatchId: latestId });
      if (rankedStats) {
        await setRankedSnapshot(rankedStats);
      }
      await setLastMatchId(latestId);
    }

    console.log(`[seed] Concluído: ${added} partida(s) importada(s).`);
    return added;
  })();

  try {
    return await seedPromise;
  } finally {
    seedPromise = null;
  }
}

export async function ensureJourneySeeded(): Promise<void> {
  try {
    await seedJourneyFromRiot();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[seed] Pulado: ${msg}`);
  }
}
