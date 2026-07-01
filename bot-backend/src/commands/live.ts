import {
  displayName,
  pickTrackedPlayers,
  replyCommand,
  replyPlayerNotFound,
} from "@/commands/shared";
import {
  formatLiveGameCommand,
  formatNotInGameCommand,
} from "@/lib/formatMatch";
import { getLiveGameSnapshot } from "@/services/riot";
import type { RegisteredCommand } from "@/commands/types";

/** `!live [nome]` — partida ao vivo via Spectator-V5. */
export const liveCommand: RegisteredCommand = {
  meta: {
    name: "live",
    description: "Verifica se o jogador está em partida (campeão, fila, tempo).",
    usage: "!live [nome]",
  },
  async execute(ctx) {
    const targets = pickTrackedPlayers(ctx);
    if (targets.length === 0) {
      await replyPlayerNotFound(ctx, ctx.args.join(" "));
      return;
    }

    const blocks: string[] = [];
    for (const tp of targets) {
      const name = displayName(tp);
      const live = await getLiveGameSnapshot(tp.puuid);
      blocks.push(
        live
          ? formatLiveGameCommand(name, live)
          : formatNotInGameCommand(name),
      );
    }

    await replyCommand(ctx, blocks.join("\n\n────────────\n\n"));
  },
};

export const partidaCommand: RegisteredCommand = {
  meta: {
    name: "partida",
    description: "Alias de !live.",
    usage: "!partida [nome]",
  },
  execute: liveCommand.execute,
};

export const ingameCommand: RegisteredCommand = {
  meta: {
    name: "ingame",
    description: "Alias de !live.",
    usage: "!ingame [nome]",
  },
  execute: liveCommand.execute,
};
