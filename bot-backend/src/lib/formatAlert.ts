import { formatEloLabel } from "@/lib/lpCalculator";
import type { PendingAlert } from "@/services/trackedPlayerService";
import type { RankedStats } from "@/types/riot";

/**
 * Resumo periódico (6 h) — mesmo layout do `formatPeriodicReport` legado.
 * Só é enviado quando há partidas novas acumuladas desde o último relatório.
 */

export function formatPeriodicDigest(ctx: {
  displayName: string;
  alerts: PendingAlert[];
  rankedStats: RankedStats | null;
}): string {
  const { displayName, alerts, rankedStats } = ctx;
  const total = alerts.length;
  const wins = alerts.filter((a) => a.win).length;
  const losses = total - wins;
  const winRatePercent = total > 0 ? Math.round((wins / total) * 100) : 0;
  const lpBalance = alerts.reduce((sum, a) => sum + (a.lpChange ?? 0), 0);
  const lpSign = lpBalance >= 0 ? "+" : "";

  const lines = [
    "📊 *RESUMO DAS ÚLTIMAS 6 HORAS*",
    `🎮 *Jogador:* ${displayName}`,
    `⚔️ *Partidas disputadas:* ${total}`,
    `✅ *Vitórias:* ${wins} | ❌ *Derrotas:* ${losses} (Win Rate: ${winRatePercent}%)`,
    `📈 *Saldo de PDL:* ${lpSign}${lpBalance} PDL`,
  ];

  if (rankedStats) {
    lines.push(
      `🏆 *Elo Atual:* ${formatEloLabel(rankedStats)} (${rankedStats.leaguePoints} PDL)`,
    );
  }

  if (total <= 5) {
    lines.push("", "*Partidas:*");
    for (const a of alerts) {
      const result = a.win ? "V" : "D";
      const kda = `${a.kills}/${a.deaths}/${a.assists}`;
      const lp =
        a.lpChange != null
          ? ` (${a.lpChange >= 0 ? "+" : ""}${a.lpChange} PDL)`
          : "";
      lines.push(
        `• ${result} | ${a.championName} | ${kda} | ${a.gameMode}${lp}`,
      );
    }
  }

  lines.push("", "_Use !status para detalhes da última partida._");

  return lines.join("\n");
}
