import {
  extractPlayerMatchData,
  getMatchDetails,
  getRecentMatchIds,
  isRemakeMatch,
} from "@/services/riot";
import type { JourneyMatch } from "@/types/journey";
import type { MatchMetadata } from "@/types/riot";

/**
 * Última partida ranqueada “útil” — pula remakes ao escanear IDs recentes.
 * Se só houver remakes no buffer, retorna a mais recente como fallback.
 */
export async function getLatestMeaningfulRankedMatch(
  puuid: string,
  scanCount = 15,
): Promise<MatchMetadata | null> {
  const matchIds = await getRecentMatchIds(puuid, scanCount);
  if (matchIds.length === 0) return null;

  let fallback: MatchMetadata | null = null;

  for (const matchId of matchIds) {
    const details = await getMatchDetails(matchId);
    const data = extractPlayerMatchData(details, puuid);
    if (!fallback) fallback = data;
    if (!isRemakeMatch(details, puuid)) return data;
  }

  return fallback;
}

/** Últimas N partidas ranqueadas, pulando remakes. */
export async function getRankedMatchHistory(
  puuid: string,
  count = 5,
): Promise<MatchMetadata[]> {
  const fetchCount = Math.max(count * 3, 15);
  const matchIds = await getRecentMatchIds(puuid, fetchCount);
  const matches: MatchMetadata[] = [];

  for (const id of matchIds) {
    const details = await getMatchDetails(id);
    if (isRemakeMatch(details, puuid)) continue;
    matches.push(extractPlayerMatchData(details, puuid));
    if (matches.length >= count) break;
  }

  return matches;
}

/**
 * Agrega partidas recentes da Riot em formato compatível com `!jornada`.
 * Usa MatchCache quando disponível; `lpChange` fica 0 (sem journey persistido).
 */
export async function buildJourneyFromRecentMatches(
  puuid: string,
  scanCount = 80,
): Promise<JourneyMatch[]> {
  const matchIds = await getRecentMatchIds(puuid, scanCount);
  const journey: JourneyMatch[] = [];

  for (const id of matchIds) {
    const details = await getMatchDetails(id, "low");
    if (isRemakeMatch(details, puuid)) continue;
    const meta = extractPlayerMatchData(details, puuid);
    journey.push({
      matchId: meta.matchId,
      timestamp: meta.gameCreation,
      championName: meta.championName,
      kills: meta.kills,
      deaths: meta.deaths,
      assists: meta.assists,
      win: meta.win,
      damage: meta.damage,
      matchMaxDamage: meta.matchMaxDamage,
      gameDuration: meta.gameDuration,
      gameMode: meta.gameMode,
      team: meta.team,
      tier: "",
      rank: "",
      leaguePoints: 0,
      lpChange: 0,
      notified: false,
    });
  }

  return journey;
}
