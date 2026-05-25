import {
  getAllJourneyMatches,
  patchJourneyMatch,
} from "@/lib/journeyStore";
import {
  extractPlayerMatchData,
  getMatchDetails,
  getPlayerPuuid,
} from "@/services/riot";
import type { JourneyMatch } from "@/types/journey";

const RIOT_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Partidas antigas sem campos novos do monitor */
export function matchNeedsEnrichment(match: JourneyMatch): boolean {
  return (
    (match.gameDuration <= 0 && match.matchMaxDamage <= 0) ||
    match.team.length === 0
  );
}

let backfillPromise: Promise<{ updated: number; failed: number }> | null = null;

/**
 * Busca Match-V5 e preenche dano, duração, modo e timestamp corretos.
 * Idempotente — só processa partidas incompletas.
 */
export async function backfillJourneyMatches(): Promise<{
  updated: number;
  failed: number;
}> {
  if (backfillPromise) return backfillPromise;

  backfillPromise = (async () => {
    const puuid = await getPlayerPuuid();
    const matches = await getAllJourneyMatches();
    const pending = matches.filter(matchNeedsEnrichment);

    if (pending.length === 0) {
      return { updated: 0, failed: 0 };
    }

    console.log(
      `[backfill] Enriquecendo ${pending.length} partida(s) via Riot API...`,
    );

    let updated = 0;
    let failed = 0;

    for (const match of pending) {
      try {
        const details = await getMatchDetails(match.matchId);
        const data = extractPlayerMatchData(details, puuid);

        const ok = await patchJourneyMatch(match.matchId, {
          championName: data.championName,
          kills: data.kills,
          deaths: data.deaths,
          assists: data.assists,
          win: data.win,
          damage: data.damage,
          matchMaxDamage: data.matchMaxDamage,
          gameDuration: data.gameDuration,
          gameMode: data.gameMode,
          team: data.team,
          timestamp: data.gameCreation,
        });

        if (ok) updated += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[backfill] Falha em ${match.matchId}: ${msg}`);
      }

      await sleep(RIOT_DELAY_MS);
    }

    console.log(`[backfill] Concluído: ${updated} ok, ${failed} falha(s).`);
    return { updated, failed };
  })();

  try {
    return await backfillPromise;
  } finally {
    backfillPromise = null;
  }
}

/** Garante backfill uma vez por processo antes de servir histórico */
export async function ensureJourneyBackfilled(): Promise<void> {
  try {
    await backfillJourneyMatches();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[backfill] Pulado: ${msg}`);
  }
}
