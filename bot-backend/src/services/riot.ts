import { AxiosError } from "axios";
import { getChampionNameById } from "@/lib/championData";
import {
  cacheMatchInDb,
  getCachedMatchFromDb,
} from "@/services/matchCacheService";
import {
  scheduleRiotRequest,
  type RiotRequestPriority,
} from "@/lib/riotClient";
import type { TeamDamageEntry } from "@/types/team";
import type {
  LeagueEntryV4,
  MatchDetailResponse,
  MatchMetadata,
  RankedSnapshot,
  RankedStats,
  RiotAccount,
} from "@/types/riot";
import type {
  LiveGameSnapshot,
  SpectatorActiveGame,
} from "@/types/spectator";

/**
 * Cliente Riot API — versão SaaS / worker (multi-tenant).
 *
 * Apenas funções consumidas pelos Workers do BullMQ. As helpers
 * legadas single-tenant (`getPlayerPuuid`, `getMatchHistory`, etc.) foram
 * removidas: cada operação aqui recebe explicitamente o `puuid` de quem
 * está sendo monitorado.
 */

const RIOT_REGION = () => process.env.RIOT_REGION ?? "americas";
const RIOT_PLATFORM = () => process.env.RIOT_PLATFORM ?? "br1";

function getRegionalBaseUrl(): string {
  return `https://${RIOT_REGION()}.api.riotgames.com`;
}

function getPlatformBaseUrl(): string {
  return `https://${RIOT_PLATFORM()}.api.riotgames.com`;
}

const QUEUE_LABELS: Record<number, string> = {
  420: "Solo/Duo",
  440: "Flex",
  450: "ARAM",
  1700: "Arena",
};

const GAME_MODE_LABELS: Record<string, string> = {
  CLASSIC: "Solo/Duo",
  ARAM: "ARAM",
  CHERRY: "Arena",
};

export function formatQueueLabel(info: {
  queueId?: number;
  gameMode?: string;
}): string {
  if (info.queueId !== undefined && QUEUE_LABELS[info.queueId]) {
    return QUEUE_LABELS[info.queueId];
  }
  if (info.gameMode && GAME_MODE_LABELS[info.gameMode]) {
    return GAME_MODE_LABELS[info.gameMode];
  }
  return info.gameMode ?? "Ranqueada";
}

export function isRemakeMatch(
  match: MatchDetailResponse,
  puuid: string,
): boolean {
  if (match.info.gameEndedInEarlySurrender) return true;
  const participant = match.info.participants.find((p) => p.puuid === puuid);
  if (!participant) return false;
  const noCombat =
    participant.kills === 0 &&
    participant.deaths === 0 &&
    participant.assists === 0 &&
    (participant.totalDamageDealtToChampions ?? 0) === 0;
  return noCombat && match.info.gameDuration <= 360;
}

function getApiKey(): string {
  const key = process.env.RIOT_API_KEY?.trim();
  if (!key) {
    throw new Error("RIOT_API_KEY ausente — defina no .env do worker.");
  }
  return key;
}

function riotHeaders() {
  return { "X-Riot-Token": getApiKey() };
}

function formatRiotApiError(status: number): string {
  switch (status) {
    case 403:
      return "Riot API 403 — chave inválida/expirada. Gere uma nova em developer.riotgames.com.";
    case 401:
      return "Riot API 401 — chave não autorizada (RIOT_API_KEY).";
    case 404:
      return "Riot API 404 — recurso não encontrado.";
    case 429:
      return "Riot API 429 — rate limit excedido. BullMQ irá retentar.";
    default:
      return `Riot API ${status}.`;
  }
}

async function riotGet<T>(
  url: string,
  priority: RiotRequestPriority = "high",
): Promise<T> {
  try {
    const { data } = await scheduleRiotRequest<T>(
      { url, method: "GET", headers: riotHeaders(), timeout: 12_000 },
      priority,
    );
    return data;
  } catch (error) {
    if (error instanceof AxiosError && error.code === "ECONNABORTED") {
      throw new Error("Timeout ao consultar a Riot API.");
    }
    if (error instanceof AxiosError && error.response) {
      throw new Error(formatRiotApiError(error.response.status));
    }
    throw error;
  }
}

/** Account-V1 — resolve PUUID a partir de `gameName#tagLine`. */
export async function resolvePuuidByRiotId(
  gameName: string,
  tagLine: string,
): Promise<{ puuid: string; gameName: string; tagLine: string }> {
  const encodedName = encodeURIComponent(gameName.trim());
  const encodedTag = encodeURIComponent(tagLine.trim());
  const url = `${getRegionalBaseUrl()}/riot/account/v1/accounts/by-riot-id/${encodedName}/${encodedTag}`;
  const account = await riotGet<RiotAccount>(url);
  return {
    puuid: account.puuid,
    gameName: account.gameName,
    tagLine: account.tagLine,
  };
}

/** Match-V5 — últimos IDs ranqueados do PUUID. */
export async function getRecentMatchIds(
  puuid: string,
  count = 10,
): Promise<string[]> {
  const url = `${getRegionalBaseUrl()}/lol/match/v5/matches/by-puuid/${puuid}/ids?type=ranked&start=0&count=${count}`;
  return riotGet<string[]>(url);
}

/**
 * Match-V5 — detalhes completos com cache em PostgreSQL.
 *
 * Match-V5 é imutável depois que a partida acaba, então o cache global
 * pode ser compartilhado entre todos os tenants (deduplica chamadas Riot).
 */
export async function getMatchDetails(
  matchId: string,
  priority: RiotRequestPriority = "high",
): Promise<MatchDetailResponse> {
  const cached = await getCachedMatchFromDb(matchId);
  if (cached) return cached;
  const url = `${getRegionalBaseUrl()}/lol/match/v5/matches/${matchId}`;
  const detail = await riotGet<MatchDetailResponse>(url, priority);
  await cacheMatchInDb(matchId, detail);
  return detail;
}

function extractTeamDamage(
  match: MatchDetailResponse,
  puuid: string,
): TeamDamageEntry[] {
  const player = match.info.participants.find((p) => p.puuid === puuid);
  if (!player) {
    throw new Error(
      `Jogador ${puuid} não encontrado na partida ${match.metadata.matchId}`,
    );
  }
  return match.info.participants
    .filter((p) => p.teamId === player.teamId)
    .map((p) => ({
      championName: p.championName,
      damageDealt: p.totalDamageDealtToChampions ?? 0,
      isPlayer: p.puuid === puuid,
    }))
    .sort((a, b) => b.damageDealt - a.damageDealt);
}

export function extractPlayerMatchData(
  match: MatchDetailResponse,
  puuid: string,
): MatchMetadata {
  const participant = match.info.participants.find((p) => p.puuid === puuid);
  if (!participant) {
    throw new Error(
      `Jogador ${puuid} não encontrado na partida ${match.metadata.matchId}`,
    );
  }
  const matchMaxDamage = Math.max(
    ...match.info.participants.map((p) => p.totalDamageDealtToChampions ?? 0),
    0,
  );
  return {
    matchId: match.metadata.matchId,
    championName: participant.championName,
    win: participant.win,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    damage: participant.totalDamageDealtToChampions ?? 0,
    matchMaxDamage,
    gameDuration: match.info.gameDuration,
    gameCreation: match.info.gameCreation,
    gameMode: formatQueueLabel(match.info),
    team: extractTeamDamage(match, puuid),
  };
}

/** League-V4 — entry Solo/Duo Queue do PUUID (null = unranked). */
async function getRankedSoloEntry(puuid: string): Promise<LeagueEntryV4 | null> {
  const url = `${getPlatformBaseUrl()}/lol/league/v4/entries/by-puuid/${puuid}`;
  const entries = await riotGet<LeagueEntryV4[]>(url);
  return entries.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? null;
}

function toRankedSnapshot(entry: LeagueEntryV4): RankedSnapshot {
  return {
    tier: entry.tier,
    rank: entry.rank,
    leaguePoints: entry.leaguePoints,
  };
}

function toRankedStats(entry: LeagueEntryV4): RankedStats {
  const totalGames = entry.wins + entry.losses;
  return {
    tier: entry.tier,
    rank: entry.rank,
    leaguePoints: entry.leaguePoints,
    wins: entry.wins,
    losses: entry.losses,
    totalGames,
    winRatePercent:
      totalGames > 0 ? Math.round((entry.wins / totalGames) * 100) : 0,
  };
}

export async function getCurrentRankedSnapshot(
  puuid: string,
): Promise<RankedSnapshot | null> {
  const entry = await getRankedSoloEntry(puuid);
  return entry ? toRankedSnapshot(entry) : null;
}

export async function getCurrentRankedStats(
  puuid: string,
): Promise<RankedStats | null> {
  const entry = await getRankedSoloEntry(puuid);
  return entry ? toRankedStats(entry) : null;
}

/** Match-V5 — conta partidas ranqueadas nas últimas N horas. */
export async function getMatchesCountLastHours(
  puuid: string,
  hours: number,
): Promise<number> {
  const startTime = Math.floor(Date.now() / 1000) - hours * 3600;
  const url = `${getRegionalBaseUrl()}/lol/match/v5/matches/by-puuid/${puuid}/ids?type=ranked&startTime=${startTime}&count=100`;
  const matchIds = await riotGet<string[]>(url);
  return matchIds.length;
}

/** Spectator-V5 — partida ativa ou `null` se não estiver em jogo. */
export async function getActiveGame(
  puuid: string,
): Promise<SpectatorActiveGame | null> {
  const url = `${getPlatformBaseUrl()}/lol/spectator/v5/active-games/by-summoner/${puuid}`;
  try {
    return await riotGet<SpectatorActiveGame>(url, "high");
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }
    throw error;
  }
}

/** Monta snapshot legível da partida ao vivo (campeões + tempo). */
export async function getLiveGameSnapshot(
  puuid: string,
): Promise<LiveGameSnapshot | null> {
  const game = await getActiveGame(puuid);
  if (!game) return null;

  const player = game.participants.find((p) => p.puuid === puuid);
  if (!player) return null;

  const allyTeamId = player.teamId;
  const allies: string[] = [];
  const enemies: string[] = [];

  for (const participant of game.participants) {
    const name = await getChampionNameById(participant.championId);
    if (participant.teamId === allyTeamId) {
      if (participant.puuid !== puuid) allies.push(name);
    } else {
      enemies.push(name);
    }
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - game.gameStartTime) / 1000),
  );

  return {
    gameMode: game.gameMode,
    queueLabel: formatQueueLabel({ queueId: game.gameQueueConfigId }),
    elapsedSeconds,
    playerChampion: await getChampionNameById(player.championId),
    allies,
    enemies,
  };
}
