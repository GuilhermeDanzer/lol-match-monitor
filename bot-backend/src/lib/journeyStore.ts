import fs from "fs/promises";
import path from "path";
import { getJourneyStorePath } from "@/lib/paths";
import type { JourneyMatch, JourneyStore } from "@/types/journey";

const DEFAULT_STORE: JourneyStore = { matches: [] };

function journeyPath(): string {
  return getJourneyStorePath();
}

function normalizeJourneyMatch(raw: Partial<JourneyMatch> & { matchId: string }): JourneyMatch {
  return {
    matchId: raw.matchId,
    timestamp: raw.timestamp ?? 0,
    championName: raw.championName ?? "Desconhecido",
    kills: raw.kills ?? 0,
    deaths: raw.deaths ?? 0,
    assists: raw.assists ?? 0,
    win: raw.win ?? false,
    damage: raw.damage ?? 0,
    matchMaxDamage: raw.matchMaxDamage ?? 0,
    gameDuration: raw.gameDuration ?? 0,
    gameMode: raw.gameMode ?? "Ranqueada",
    team: Array.isArray(raw.team) ? raw.team : [],
    tier: raw.tier ?? "",
    rank: raw.rank ?? "",
    leaguePoints: raw.leaguePoints ?? 0,
    lpChange: raw.lpChange ?? 0,
    notified: raw.notified ?? false,
  };
}

async function readJourney(): Promise<JourneyStore> {
  try {
    const raw = await fs.readFile(journeyPath(), "utf-8");
    const data = JSON.parse(raw) as Partial<JourneyStore>;
    const matches = Array.isArray(data.matches)
      ? data.matches.map((m) =>
          normalizeJourneyMatch(m as Partial<JourneyMatch> & { matchId: string }),
        )
      : [];
    return { matches };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

async function writeJourney(store: JourneyStore): Promise<void> {
  const filePath = journeyPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
}

/** Inicializa journey.json se ainda não existir */
export async function ensureJourneyExists(): Promise<void> {
  try {
    await fs.access(journeyPath());
  } catch {
    await writeJourney(DEFAULT_STORE);
  }
}

/** Retorna todas as partidas do histórico acumulado */
export async function getAllJourneyMatches(): Promise<JourneyMatch[]> {
  const store = await readJourney();
  return store.matches;
}

/** Partidas ainda não incluídas em relatório periódico */
export async function getUnnotifiedMatches(): Promise<JourneyMatch[]> {
  const store = await readJourney();
  return store.matches.filter((m) => !m.notified);
}

export async function hasJourneyMatch(matchId: string): Promise<boolean> {
  const store = await readJourney();
  return store.matches.some((m) => m.matchId === matchId);
}

/** Adiciona partida ao histórico (ignora duplicatas por matchId) */
export async function addJourneyMatch(match: JourneyMatch): Promise<void> {
  const store = await readJourney();
  if (store.matches.some((m) => m.matchId === match.matchId)) {
    return;
  }
  store.matches.push(match);
  await writeJourney(store);
}

/** Atualiza campos de uma partida existente (backfill / correção) */
export async function patchJourneyMatch(
  matchId: string,
  patch: Partial<Omit<JourneyMatch, "matchId">>,
): Promise<boolean> {
  const store = await readJourney();
  const index = store.matches.findIndex((m) => m.matchId === matchId);
  if (index < 0) return false;

  store.matches[index] = normalizeJourneyMatch({
    ...store.matches[index],
    ...patch,
    matchId,
  });
  await writeJourney(store);
  return true;
}

/** Marca partidas como notificadas após envio do relatório */
export async function markMatchesNotified(matchIds: string[]): Promise<void> {
  if (matchIds.length === 0) return;

  const ids = new Set(matchIds);
  const store = await readJourney();
  store.matches = store.matches.map((m) =>
    ids.has(m.matchId) ? { ...m, notified: true } : m,
  );
  await writeJourney(store);
}

/** Sequência de vitórias atual (partidas mais recentes primeiro) */
export function calculateCurrentWinStreak(matches: JourneyMatch[]): number {
  const sorted = [...matches].sort((a, b) => b.timestamp - a.timestamp);
  let streak = 0;

  for (const match of sorted) {
    if (match.win) {
      streak += 1;
    } else {
      break;
    }
  }

  return streak;
}

/** Maior sequência de vitórias consecutivas no histórico */
export function calculateMaxWinStreak(matches: JourneyMatch[]): number {
  const sorted = [...matches].sort((a, b) => a.timestamp - b.timestamp);
  let max = 0;
  let current = 0;

  for (const match of sorted) {
    if (match.win) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }

  return max;
}

/** Estatísticas agregadas do histórico monitorado */
export function summarizeJourneyMatches(matches: JourneyMatch[]): {
  total: number;
  wins: number;
  losses: number;
  winRatePercent: number;
  lpBalance: number;
} {
  const total = matches.length;
  const wins = matches.filter((m) => m.win).length;
  const losses = total - wins;
  const winRatePercent = total > 0 ? Math.round((wins / total) * 100) : 0;
  const lpBalance = matches.reduce((sum, m) => sum + m.lpChange, 0);

  return { total, wins, losses, winRatePercent, lpBalance };
}
