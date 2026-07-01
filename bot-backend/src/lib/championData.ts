import axios from "axios";

let championNames: Map<number, string> | null = null;
let loadPromise: Promise<Map<number, string>> | null = null;

async function loadChampionNames(): Promise<Map<number, string>> {
  if (championNames) return championNames;

  if (!loadPromise) {
    loadPromise = (async () => {
      const { data: versions } = await axios.get<string[]>(
        "https://ddragon.leagueoflegends.com/api/versions.json",
        { timeout: 10_000 },
      );
      const version = versions[0];
      const { data } = await axios.get<{
        data: Record<string, { key: string; name: string }>;
      }>(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/pt_BR/champion.json`,
        { timeout: 10_000 },
      );

      const map = new Map<number, string>();
      for (const champ of Object.values(data.data)) {
        map.set(Number(champ.key), champ.name);
      }
      championNames = map;
      return map;
    })().catch((error) => {
      loadPromise = null;
      throw error;
    });
  }

  return loadPromise;
}

/** Resolve championId → nome (Data Dragon, cache em memória). */
export async function getChampionNameById(championId: number): Promise<string> {
  const names = await loadChampionNames();
  return names.get(championId) ?? `Campeão ${championId}`;
}
