import { dbClient, seedFixtures } from "./common";
import { EXPERIMENT } from "../config/experiment";
import { profileRotationOffsetForSlot } from "../lib/experiment/assignment";

async function main() {
  const db = dbClient();
  await seedFixtures(db);

  const role = process.env.PARTICIPANT_ROLE === "recipient" ? "recipient" : "giver";
  // participant_code is globally unique. Reserve P001–P040 for giver slots and
  // P041–P080 for recipient slots so the two roles cannot collide.
  const firstCodeNumber = role === "recipient" ? 41 : 1;
  const rows = Array.from({ length: 40 }, (_, index) => {
    const participantNumber = index + 1;
    const groupIndex = participantNumber <= 20 ? participantNumber - 1 : participantNumber - 21;
    return {
      participant_code: `P${String(firstCodeNumber + index).padStart(3, "0")}`,
      role,
      intimacy_condition: participantNumber <= 20 ? "high" : "low",
      sequence_id: `S${Math.floor(groupIndex / 5) + 1}`,
      profile_rotation_offset: profileRotationOffsetForSlot(participantNumber,participantNumber<=20?"high":"low"),
      status: "assigned",
      experiment_version: EXPERIMENT.version,
      is_mock: false,
    };
  });

  const { data: existing, error: lookupError } = await db
    .from("participants")
    .select("participant_code,role,intimacy_condition,sequence_id,experiment_version,status,started_at")
    .in("participant_code", rows.map(row => row.participant_code))
    .eq("is_mock", false);
  if (lookupError) throw lookupError;

  const existingByCode = new Map((existing ?? []).map((participant) => [participant.participant_code, participant]));
  const conflicts = rows.filter(row => {
    const found = existingByCode.get(row.participant_code);
    return found && (found.role !== row.role || found.intimacy_condition !== row.intimacy_condition || found.sequence_id !== row.sequence_id);
  });
  if (conflicts.length) throw new Error(`Existing participant assignments differ from the requested ${role} slots: ${conflicts.map(row=>row.participant_code).join(", ")}. Existing assignments were not changed.`);
  const missing = rows.filter((participant) => !existingByCode.has(participant.participant_code));
  if (missing.length) {
    const { error } = await db.from("participants").insert(missing);
    if (error) throw error;
  }

  console.log(`Provisioned ${missing.length} new ${role} slots (${rows[0].participant_code}–${rows[rows.length-1].participant_code}; high/low 20 each, 5 per sequence cell). Existing assignments were preserved.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
