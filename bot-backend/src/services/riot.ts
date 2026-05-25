import axios, { AxiosError } from "axios";
import type { TeamDamageEntry } from "@/types/team";
import type {
  LeagueEntryV4,
  MatchDetailResponse,
  MatchMetadata,
  RankedSnapshot,
  RankedStats,
  RiotAccount,
} from "@/types/riot";

const RIOT_REGION = () => process.env.RIOT_REGION ?? "americas";
/** Servidor local para League-V4 (ex: br1, na1) */
const RIOT_PLATFORM = () => process.env.RIOT_PLATFORM ?? "br1";

function getRegionalBaseUrl(): string {
  return `https://${RIOT_REGION()}.api.riotgames.com`;
}

function getPlatformBaseUrl(): string {
  return `https://${RIOT_PLATFORM()}.api.riotgames.com`;
}

function assertConfig(): { gameName: string; tagLine: string } {
  getApiKey();
  const gameName = process.env.RIOT_GAME_NAME;
  const tagLine = process.env.RIOT_TAG_LINE;
  if (!gameName || !tagLine) {
    throw new Error(
      "RIOT_GAME_NAME e RIOT_TAG_LINE são obrigatórios em bot-backend/.env",
    );
  }
  return { gameName, tagLine };
}

function getApiKey(): string {
  const key = process.env.RIOT_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "RIOT_API_KEY não configurada. Defina em bot-backend/.env",
    );
  }
  return key;
}

function riotHeaders() {
  return { "X-Riot-Token": getApiKey() };
}

/** Mensagens amigáveis para erros comuns da Riot API */
export function formatRiotApiError(status: number): string {
  switch (status) {
    case 403:
      return (
        "Chave da API inválida ou expirada (403 Forbidden).\n" +
        "→ Gere uma nova em developer.riotgames.com\n" +
        "→ Cole em RIOT_API_KEY em bot-backend/.env\n" +
        "→ Reinicie o servidor (npm run dev)\n" +
        "Chaves de desenvolvimento expiram em ~24 horas."
      );
    case 401:
      return "Chave da API não autorizada (401). Verifique se copiou a chave completa (RGAPI-...).";
    case 404:
      return "Jogador ou recurso não encontrado (404). Confira RIOT_GAME_NAME e RIOT_TAG_LINE.";
    case 429:
      return "Limite de requisições excedido (429). Aguarde alguns minutos e tente de novo.";
    default:
      return `Erro da Riot API (${status}).`;
  }
}

async function riotGet<T>(url: string): Promise<T> {
  try {
    const { data } = await axios.get<T>(url, { headers: riotHeaders() });
    return data;
  } catch (error) {
    if (error instanceof AxiosError && error.response) {
      const status = error.response.status;
      throw new Error(formatRiotApiError(status));
    }
    throw error;
  }
}

/** Busca o PUUID do jogador pelo Riot ID (gameName#tagLine) */
export async function getPlayerPuuid(): Promise<string> {
  const { gameName, tagLine } = assertConfig();
  const encodedName = encodeURIComponent(gameName);
  const encodedTag = encodeURIComponent(tagLine);
  const url = `${getRegionalBaseUrl()}/riot/account/v1/accounts/by-riot-id/${encodedName}/${encodedTag}`;

  const account = await riotGet<RiotAccount>(url);
  return account.puuid;
}

/** Retorna os IDs das últimas partidas ranqueadas do jogador (Match-V5) */
export async function getRecentMatchIds(
  puuid: string,
  count = 10,
): Promise<string[]> {
  const url = `${getRegionalBaseUrl()}/lol/match/v5/matches/by-puuid/${puuid}/ids?type=ranked&start=0&count=${count}`;
  return riotGet<string[]>(url);
}

/** Busca os detalhes completos de uma partida pelo ID */
export async function getMatchDetails(
  matchId: string,
): Promise<MatchDetailResponse> {
  const url = `${getRegionalBaseUrl()}/lol/match/v5/matches/${matchId}`;
  return riotGet<MatchDetailResponse>(url);
}

/** Monta array de dano do time aliado */
export function extractTeamDamage(
  match: MatchDetailResponse,
  puuid: string,
): TeamDamageEntry[] {
  const player = match.info.participants.find((p) => p.puuid === puuid);
  if (!player) {
    throw new Error(
      `Jogador não encontrado na partida ${match.metadata.matchId}`,
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

/** Extrai os dados relevantes do jogador monitorado em uma partida */
export function extractPlayerMatchData(
  match: MatchDetailResponse,
  puuid: string,
): MatchMetadata {
  const participant = match.info.participants.find((p) => p.puuid === puuid);

  if (!participant) {
    throw new Error(`Jogador não encontrado na partida ${match.metadata.matchId}`);
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
    gameMode: match.info.gameMode,
    team: extractTeamDamage(match, puuid),
  };
}

/** Busca e formata as últimas N partidas para exibição no frontend */
export async function getMatchHistory(count = 10): Promise<MatchMetadata[]> {
  const puuid = await getPlayerPuuid();
  const matchIds = await getRecentMatchIds(puuid, count);

  const matches = await Promise.all(
    matchIds.map(async (id) => {
      const details = await getMatchDetails(id);
      return extractPlayerMatchData(details, puuid);
    }),
  );

  return matches;
}

/** Retorna o gameName configurado (para mensagens) */
export function getConfiguredGameName(): string {
  const { gameName, tagLine } = assertConfig();
  return `${gameName}#${tagLine}`;
}

/** Nome exibido sem tag (ex: "Fulano") */
export function getDisplayName(): string {
  const { gameName } = assertConfig();
  return gameName;
}

/**
 * League-V4 — GET br1.api.riotgames.com/lol/league/v4/entries/by-puuid/{puuid}
 * Retorna entrada RANKED_SOLO_5x5 ou null se unranked.
 */
export async function getRankedSoloEntry(
  puuid: string,
): Promise<LeagueEntryV4 | null> {
  const url = `${getPlatformBaseUrl()}/lol/league/v4/entries/by-puuid/${puuid}`;
  const entries = await riotGet<LeagueEntryV4[]>(url);
  return entries.find((e) => e.queueType === "RANKED_SOLO_5x5") ?? null;
}

/** Calcula totais e win rate a partir de wins/losses da League-V4 */
export function computeRankedWinRate(
  wins: number,
  losses: number,
): Pick<RankedStats, "totalGames" | "winRatePercent"> {
  const totalGames = wins + losses;
  const winRatePercent =
    totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
  return { totalGames, winRatePercent };
}

/** Converte LeagueEntryV4 em snapshot com estatísticas da season */
export function toRankedStats(entry: LeagueEntryV4): RankedStats {
  const { totalGames, winRatePercent } = computeRankedWinRate(
    entry.wins,
    entry.losses,
  );
  return {
    tier: entry.tier,
    rank: entry.rank,
    leaguePoints: entry.leaguePoints,
    wins: entry.wins,
    losses: entry.losses,
    totalGames,
    winRatePercent,
  };
}

/** Converte LeagueEntryV4 em snapshot simplificado (sem wins/losses) */
export function toRankedSnapshot(entry: LeagueEntryV4): RankedSnapshot {
  return {
    tier: entry.tier,
    rank: entry.rank,
    leaguePoints: entry.leaguePoints,
  };
}

/** Busca elo Solo/Duo atual a partir do PUUID já conhecido */
export async function getCurrentRankedSnapshot(
  puuid: string,
): Promise<RankedSnapshot | null> {
  const entry = await getRankedSoloEntry(puuid);
  return entry ? toRankedSnapshot(entry) : null;
}

/** Busca elo e estatísticas da season (wins, losses, win rate) */
export async function getCurrentRankedStats(
  puuid: string,
): Promise<RankedStats | null> {
  const entry = await getRankedSoloEntry(puuid);
  return entry ? toRankedStats(entry) : null;
}

/**
 * Conta partidas ranqueadas nas últimas N horas (Match-V5).
 * Usa startTime em segundos e count=100 para cobrir o intervalo.
 */
export async function getMatchesCountLastHours(
  puuid: string,
  hours: number,
): Promise<number> {
  const startTime = Math.floor(Date.now() / 1000) - hours * 3600;
  const url = `${getRegionalBaseUrl()}/lol/match/v5/matches/by-puuid/${puuid}/ids?type=ranked&startTime=${startTime}&count=100`;
  const matchIds = await riotGet<string[]>(url);
  return matchIds.length;
}
