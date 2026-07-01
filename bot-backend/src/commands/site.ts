import {
  pickTrackedPlayers,
  replyCommand,
} from "@/commands/shared";
import { formatHelpCommand } from "@/lib/formatMatch";
import type { RegisteredCommand } from "@/commands/types";

/** `!site` — link do dashboard web. */
export const siteCommand: RegisteredCommand = {
  meta: {
    name: "site",
    description: "Link do dashboard web ao vivo.",
    usage: "!site",
  },
  async execute(ctx) {
    const url = process.env.FRONTEND_URL?.trim();
    if (!url) {
      await replyCommand(
        ctx,
        "🌐 FRONTEND_URL não configurada no servidor. Defina a URL do site no .env.",
      );
      return;
    }
    await replyCommand(ctx, `🌐 Acompanhe o vexame ao vivo: ${url}`);
  },
};

/** `!ajuda` — lista completa no estilo legado. */
export const ajudaCommand: RegisteredCommand = {
  meta: {
    name: "ajuda",
    description: "Lista os comandos disponíveis.",
    usage: "!ajuda",
  },
  async execute(ctx) {
    const targets = pickTrackedPlayers(ctx);
    const monitored =
      targets.length > 0
        ? targets.map((tp) => tp.riotId).join(", ")
        : ctx.trackedPlayers.map((tp) => tp.riotId).join(", ") ||
          "nenhum jogador";

    await replyCommand(ctx, formatHelpCommand(monitored));
  },
};

export const helpCommandAlias: RegisteredCommand = {
  meta: {
    name: "help",
    description: "Alias de !ajuda.",
    usage: "!help",
  },
  execute: ajudaCommand.execute,
};
