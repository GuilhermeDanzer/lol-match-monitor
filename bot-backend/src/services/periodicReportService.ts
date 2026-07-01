import { formatPeriodicDigest } from "@/lib/formatAlert";
import { getCurrentRankedStats } from "@/services/riot";
import { listSubscriptionsForPlayer } from "@/services/subscriptionService";
import {
  drainPendingAlerts,
  listPlayersWithPendingAlerts,
} from "@/services/trackedPlayerService";
import { whatsappManager } from "@/whatsapp/WhatsAppManager";

/**
 * Envia relatórios WhatsApp acumulados (tick de 6 h).
 *
 * Só notifica grupos quando o jogador teve partida nova desde o último
 * relatório. A detecção continua a cada 15 min via RiotApiWorker.
 */
export async function deliverPeriodicReports(): Promise<{
  players: number;
  messages: number;
  skipped: number;
}> {
  const players = await listPlayersWithPendingAlerts();
  if (players.length === 0) {
    console.log("[report] nenhuma partida pendente — nada a enviar");
    return { players: 0, messages: 0, skipped: 0 };
  }

  let messages = 0;
  let skipped = 0;

  for (const player of players) {
    const subs = await listSubscriptionsForPlayer(player.id);
    if (subs.length === 0) {
      await drainPendingAlerts(player.id);
      skipped += 1;
      continue;
    }

    const rankedStats = await getCurrentRankedStats(player.puuid).catch(
      () => null,
    );
    const text = formatPeriodicDigest({
      displayName: player.riotId,
      alerts: player.alerts,
      rankedStats,
    });

    const results = await Promise.allSettled(
      subs.map(async (sub) => {
        if (!whatsappManager.isConnected(sub.userId)) {
          await whatsappManager.initializeUser(sub.userId);
        }
        await whatsappManager.sendGroupMessage(
          sub.userId,
          sub.whatsappGroupId,
          text,
        );
      }),
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    if (ok === 0) {
      const reasons = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) =>
          r.reason instanceof Error ? r.reason.message : String(r.reason),
        )
        .join("; ");
      throw new Error(
        `[report] falha ao enviar para ${player.riotId}: ${reasons}`,
      );
    }

    if (ok < results.length) {
      console.warn(
        `[report] entrega parcial ${player.riotId}: ${ok}/${results.length}`,
      );
    }

    await drainPendingAlerts(player.id);
    messages += ok;

    console.log(
      `[report] enviado ${player.riotId} — ${player.alerts.length} partida(s) → ${ok} grupo(s)`,
    );
  }

  return { players: players.length, messages, skipped };
}
