import { formatDamageCompact } from "@/lib/formatDamage";
import {
  calculateLpChange,
  formatEloCompactLabel,
  formatEloLabel,
} from "@/lib/lpCalculator";
import type { JourneyMatch } from "@/types/journey";
import type { MatchMetadata, RankedSnapshot, RankedStats } from "@/types/riot";
import {
  calculateMaxWinStreak,
  summarizeJourneyMatches,
} from "@/lib/journeyStore";

export interface MatchNotificationContext {
  displayName: string;
  rankedAfter: RankedSnapshot | null;
  rankedBefore: RankedSnapshot | null;
}

export interface ExtendedMatchNotificationContext extends MatchNotificationContext {
  rankedStats: RankedStats | null;
  matchesLast6h: number;
  eloProgression: string | null;
}

/** Formata duração em segundos para "MM:SS" */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatMatchLine(match: MatchMetadata, index?: number): string {
  const result = match.win ? "V" : "D";
  const kda = `${match.kills}/${match.deaths}/${match.assists}`;
  const duration = formatDuration(match.gameDuration);
  const dmg = formatDamageCompact(match.damage);
  const prefix = index !== undefined ? `${index}. ` : "";
  return `${prefix}${result} | ${match.championName} | ${kda} | 💥${dmg} | ${duration} | ${match.gameMode}`;
}

/** Resposta do comando !status — última partida */
export function formatStatusCommand(
  match: MatchMetadata,
  gameName: string,
): string {
  const result = match.win ? "🏆 Vitória" : "💀 Derrota";
  const kda = `${match.kills}/${match.deaths}/${match.assists}`;
  const duration = formatDuration(match.gameDuration);
  const when = new Date(match.gameCreation).toLocaleString("pt-BR");

  return [
    `⚔️ *Status — ${gameName}*`,
    "",
    `📊 *Última partida:* ${result}`,
    `🎮 *Campeão:* ${match.championName}`,
    `🗡️ *KDA:* ${kda}`,
    `💥 *Dano:* ${formatDamageCompact(match.damage)}`,
    `⏱️ *Duração:* ${duration}`,
    `🎯 *Modo:* ${match.gameMode}`,
    `📅 *Quando:* ${when}`,
    "",
    "_Use !historico para ver as últimas 5 partidas._",
  ].join("\n");
}

/** Resposta do comando !historico */
export function formatHistoryCommand(
  matches: MatchMetadata[],
  gameName: string,
): string {
  if (matches.length === 0) {
    return `⚔️ *${gameName}* — nenhuma partida encontrada.`;
  }

  const wins = matches.filter((m) => m.win).length;
  const lines = matches.map((m, i) => formatMatchLine(m, i + 1));

  return [
    `⚔️ *Histórico — ${gameName}*`,
    `📈 Últimas ${matches.length}: ${wins}V / ${matches.length - wins}D`,
    "",
    ...lines,
    "",
    "_V=Vitória D=Derrota | Use !status ou !lol para a partida mais recente._",
  ].join("\n");
}

/** Lista de comandos disponíveis */
export function formatHelpCommand(gameName: string): string {
  return [
    "⚔️ *LoL Match Monitor — Comandos*",
    "",
    `👤 Monitorando: *${gameName}*`,
    "",
    "*!status* / *!lol* — última partida + elo, PDL, win rate e partidas nas últimas 6h",
    "*!historico* / *!history* — últimas 5 partidas ranqueadas",
    "*!jornada* — estatísticas gerais da temporada monitorada",
    "*!site* — link do dashboard web ao vivo",
    "*!ajuda* / *!help* — esta mensagem",
    "",
    "O bot envia um *resumo automático a cada 6 horas* com as partidas ranqueadas do período.",
  ].join("\n");
}

/** Monta alerta de nova partida com elo e variação de PDL */
export function formatWhatsAppMessage(
  match: MatchMetadata,
  ctx: MatchNotificationContext,
): string {
  const kda = `${match.kills}/${match.deaths}/${match.assists}`;
  const durationMin = Math.floor(match.gameDuration / 60);
  const resultLabel = match.win ? "Vitória 🟢" : "Derrota 🔴";

  const lines = [
    "🚨 *Alerta de Histórico!*",
    `🎮 ${ctx.displayName} jogou de ${match.championName}`,
    `⚔️ *Resultado:* ${resultLabel} (KDA: ${kda})`,
    `💥 *Dano:* ${formatDamageCompact(match.damage)}`,
    `⏱️ *Duração:* ${durationMin} min`,
  ];

  if (ctx.rankedAfter) {
    const eloLabel = formatEloLabel(ctx.rankedAfter);
    const lp = calculateLpChange(ctx.rankedBefore, ctx.rankedAfter, match.win);
    const lpIcon = match.win ? "📈" : "📉";

    lines.push(`🏆 *Elo:* ${eloLabel}`);
    lines.push(`${lpIcon} *PDL:* ${lp.lpLine}`);
  } else {
    lines.push("🏆 *Elo:* Sem dados ranqueados Solo/Duo");
  }

  return lines.join("\n");
}

/** Monta alerta completo com progressão, win rate e volume de jogo recente */
export function formatExtendedWhatsAppMessage(
  match: MatchMetadata,
  ctx: ExtendedMatchNotificationContext,
): string {
  const kda = `${match.kills}/${match.deaths}/${match.assists}`;
  const durationMin = Math.floor(match.gameDuration / 60);
  const resultLabel = match.win ? "Vitória 🟢" : "Derrota 🔴";

  const lines = [
    "🚨 *Alerta de Histórico!*",
    `🎮 ${ctx.displayName} jogou de ${match.championName}`,
    `⚔️ *Resultado:* ${resultLabel} (KDA: ${kda})`,
    `💥 *Dano:* ${formatDamageCompact(match.damage)}`,
    `⏱️ *Duração:* ${durationMin} min`,
    "",
    "📊 *Status da Conta:*",
  ];

  if (ctx.rankedStats) {
    const lp = calculateLpChange(
      ctx.rankedBefore,
      ctx.rankedStats,
      match.win,
    );
    const lpIcon = match.win ? "📈" : "📉";
    const progressionLabel =
      ctx.eloProgression ??
      `Manteve ${formatEloCompactLabel(ctx.rankedStats)}`;

    lines.push(`🏆 *Progressão:* ${progressionLabel}`);
    lines.push(`${lpIcon} *PDL:* ${lp.lpLine}`);
    lines.push(
      `📈 *Win Rate:* ${ctx.rankedStats.winRatePercent}% (${ctx.rankedStats.wins} V / ${ctx.rankedStats.losses} D)`,
    );
    lines.push(`🕹️ *Partidas na season:* ${ctx.rankedStats.totalGames}`);

    const grindSuffix =
      ctx.matchesLast6h >= 3 ? " (Ta viciado!)" : "";
    lines.push(
      `🔥 *Partidas nas últimas 6h:* ${ctx.matchesLast6h}${grindSuffix}`,
    );
  } else {
    lines.push("🏆 *Elo:* Sem dados ranqueados Solo/Duo");
    if (ctx.matchesLast6h > 0) {
      const grindSuffix =
        ctx.matchesLast6h >= 3 ? " (Ta viciado!)" : "";
      lines.push(
        `🔥 *Partidas nas últimas 6h:* ${ctx.matchesLast6h}${grindSuffix}`,
      );
    }
  }

  return lines.join("\n");
}

/** Relatório automático de 6 horas (partidas com notified=false) */
export function formatPeriodicReport(ctx: {
  displayName: string;
  summary: ReturnType<typeof summarizeJourneyMatches>;
  rankedStats: RankedStats | null;
}): string {
  const { displayName, summary, rankedStats } = ctx;
  const lpSign = summary.lpBalance >= 0 ? "+" : "";

  const lines = [
    "📊 *RESUMO DAS ÚLTIMAS 6 HORAS*",
    `🎮 *Jogador:* ${displayName}`,
    `⚔️ *Partidas disputadas:* ${summary.total}`,
    `✅ *Vitórias:* ${summary.wins} | ❌ *Derrotas:* ${summary.losses} (Win Rate: ${summary.winRatePercent}%)`,
    `📈 *Saldo de PDL:* ${lpSign}${summary.lpBalance} PDL`,
  ];

  if (rankedStats) {
    lines.push(
      `🏆 *Elo Atual:* ${formatEloLabel(rankedStats)} (${rankedStats.leaguePoints} PDL)`,
    );
  }

  return lines.join("\n");
}

/** Resposta do comando !jornada — histórico acumulado da temporada */
export function formatJourneyCommand(ctx: {
  displayName: string;
  matches: JourneyMatch[];
  rankedStats: RankedStats | null;
}): string {
  const { displayName, matches, rankedStats } = ctx;

  if (matches.length === 0) {
    return [
      `🗺️ *A JORNADA DE ${displayName.toUpperCase()} NESTA TEMPORADA*`,
      "",
      "Nenhuma partida ranqueada monitorada ainda.",
    ].join("\n");
  }

  const summary = summarizeJourneyMatches(matches);
  const maxWinStreak = calculateMaxWinStreak(matches);

  const lines = [
    `🗺️ *A JORNADA DE ${displayName.toUpperCase()} NESTA TEMPORADA*`,
    `🕹️ *Total de Ranqueadas Monitoradas:* ${summary.total}`,
    `🔥 *Win Rate Geral:* ${summary.winRatePercent}% (${summary.wins} V / ${summary.losses} D)`,
    `📊 *Maior sequência de vitórias registrada:* ${maxWinStreak}`,
  ];

  if (rankedStats) {
    lines.push(
      `🏆 *Status Atual:* ${formatEloLabel(rankedStats)} - ${rankedStats.leaguePoints} PDL`,
    );
  } else {
    lines.push("🏆 *Status Atual:* Sem dados ranqueados Solo/Duo");
  }

  return lines.join("\n");
}
