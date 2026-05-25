import "@/loadEnv";
import { backfillJourneyMatches } from "@/lib/journeyBackfill";
import { ensureJourneyExists } from "@/lib/journeyStore";

async function main(): Promise<void> {
  await ensureJourneyExists();
  const result = await backfillJourneyMatches();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
