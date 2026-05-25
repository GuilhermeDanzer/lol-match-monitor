import path from "path";

/** Diretório para sessão WhatsApp, lastMatch.json e outros dados persistentes */
export function getPersistentDataDir(): string {
  const dir = process.env.PERSISTENT_DATA_DIR?.trim();
  return dir ? path.resolve(dir) : process.cwd();
}

export function getWhatsAppAuthPath(): string {
  return path.join(getPersistentDataDir(), ".wwebjs_auth");
}

export function getMatchStorePath(): string {
  return path.join(getPersistentDataDir(), "data", "lastMatch.json");
}

export function getJourneyStorePath(): string {
  return path.join(getPersistentDataDir(), "data", "journey.json");
}
