import { dbClient, seedFixtures } from "./common";
import { EXPERIMENT } from "../config/experiment";

async function main() {
  const db = dbClient();
  await seedFixtures(db);

  const role = process.env.PARTICIPANT_ROLE === "recipient" ? "recipient" : "giver";
  const rows = Array.from({ length: 40 }, (_, index) => {
    const participantNumber = index + 1;
    const groupIndex = participantNumber <= 20 ? participantNumber - 1 : participantNumber - 21;
    return {
      participant_code: `P${String(participantNumber).padStart(3, "0")}`,
      role,
      intimacy_condition: participantNumber <= 20 ? "high" : "low",
      sequence_id: `S${Math.floor(groupIndex / 5) + 1}`,
      status: "assigned",
      experiment_version: EXPERIMENT.version,
      is_mock: false,
    };
  });

  const { data: existing, error: lookupError } = await db
    .from("participants")
    .select("participant_code")
    .like("participant_code", "P___")
    .eq("is_mock", false);
  if (lookupError) throw lookupError;

  const existingCodes = new Set((existing ?? []).map((participant) => participant.participant_code));
  const missing = rows.filter((participant) => !existingCodes.has(participant.participant_code));
  if (missing.length) {
    const { error } = await db.from("participants").insert(missing);
    if (error) throw error;
  }

  console.log(`Provisioned ${missing.length} new real slots (${role}; high/low 20 each, 5 per sequence cell). Existing assignments were preserved.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
