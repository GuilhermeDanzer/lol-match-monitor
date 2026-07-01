import {
  displayName,
  pickTrackedPlayers,
  replyCommand,
  replyPlayerNotFound,
} from "@/commands/shared";
import { formatHistoryCommand } from "@/lib/formatMatch";
import { getRankedMatchHistory } from "@/services/matchQueryService";
import type { RegisteredCommand } from "@/commands/types";

/** `!historico [nome]` / alias `!history` */
export const historicoCommand: RegisteredCommand = {
  meta: {
    name: "historico",
    description: "Últimas 5 partidas ranqueadas com KDA e dano do time.",
    usage: "!historico [nome]",
  },
  async execute(ctx) {
    const targets = pickTrackedPlayers(ctx);
    if (targets.length === 0) {
      await replyPlayerNotFound(ctx, ctx.args.join(" "));
      return;
    }

    const blocks: string[] = [];
    for (const tp of targets) {
      const matches = await getRankedMatchHistory(tp.puuid, 5);
      blocks.push(formatHistoryCommand(matches, displayName(tp)));
    }

    await replyCommand(ctx, blocks.join("\n\n────────────\n\n"));
  },
};

export const historyCommand: RegisteredCommand = {
  meta: {
    name: "history",
    description: "Alias de !historico.",
    usage: "!history [nome]",
  },
  execute: historicoCommand.execute,
};
