import { buildLiveStatusMessage } from "@/commands/buildStatus";
import {
  pickTrackedPlayers,
  replyCommand,
  replyPlayerNotFound,
} from "@/commands/shared";
import type { RegisteredCommand } from "@/commands/types";

/**
 * `!status [riotId|gameName]` / alias `!lol`
 *
 * Última partida não-remake + elo, PDL, win rate da season e partidas nas 6h.
 */
export const statusCommand: RegisteredCommand = {
  meta: {
    name: "status",
    description:
      "Última partida + elo, PDL, win rate e dano do time (partidas nas últimas 6h).",
    usage: "!status [nome]",
  },
  async execute(ctx) {
    const targets = pickTrackedPlayers(ctx);
    if (targets.length === 0) {
      await replyPlayerNotFound(ctx, ctx.args.join(" "));
      return;
    }

    const messages = await Promise.all(
      targets.map((tp) => buildLiveStatusMessage(tp)),
    );

    await replyCommand(ctx, messages.join("\n\n────────────\n\n"));
  },
};

/** Alias legado do `!status`. */
export const lolCommand: RegisteredCommand = {
  meta: {
    name: "lol",
    description: "Alias de !status — última partida e stats da conta.",
    usage: "!lol [nome]",
  },
  execute: statusCommand.execute,
};
