import path from "path";

/** Diretório para sessão WhatsApp, lastMatch.json e outros dados persistentes */
export function getPersistentDataDir(): string {
  const dir = process.env.PERSISTENT_DATA_DIR?.trim();
  return dir ? path.resolve(dir) : process.cwd();
}

export function getWhatsAppAuthPath(): string {
  return path.join(getPersistentDataDir(), ".wwebjs_auth");
}

/**
 * Pasta dos JSONs (lastMatch, journey).
 * Aceita PERSISTENT_DATA_DIR=/app ou /app/data sem gerar /app/data/data.
 */
export function getDataDir(): string {
  const base = getPersistentDataDir();
  const normalized = base.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized.endsWith("/data")) {
    return base;
  }
  return path.join(base, "data");
}

export function getMatchStorePath(): string {
  return path.join(getDataDir(), "lastMatch.json");
}

export function getJourneyStorePath(): string {
  return path.join(getDataDir(), "journey.json");
}
