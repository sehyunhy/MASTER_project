import { dbClient, seedFixtures } from "./common";
import { EXPERIMENT, CANDIDATES } from "../config/experiment";

const db = dbClient();
const iso = (start: number, offset: number) => new Date(start + offset).toISOString();
const rand = (seed: number, min: number, max: number) => min + ((seed * 9301 + 49297) % 233280) / 233280 * (max - min);
const now = Date.now();

// Refresh synthetic rows only. Cascades remove their events, responses, selections,
// trials, and candidate links; real participant data is untouched.
const { error: deleteError } = await db.from("participants").delete().eq("is_mock", true);
if (deleteError) throw deleteError;
await seedFixtures(db);

const participantRows = Array.from({ length: 40 }, (_, i) => {
  const cellIndex = i < 20 ? i : i - 20;
  return {
    participant_code: `MOCK-P${String(i + 1).padStart(3, "0")}`,
    role: "giver", intimacy_condition: i < 20 ? "high" : "low",
    sequence_id: `S${Math.floor(cellIndex / 5) + 1}`, status: "completed",
    experiment_version: EXPERIMENT.version,
    started_at: iso(now, -7 * 24 * 60 * 60 * 1000 + i * 60_000),
    completed_at: iso(now, -7 * 24 * 60 * 60 * 1000 + i * 60_000 + 4 * 60_000), is_mock: true,
  };
});
const { data: participants, error: participantError } = await db.from("participants").insert(participantRows).select("id,participant_code,intimacy_condition,sequence_id,role");
if (participantError || !participants) throw participantError ?? new Error("Could not create mock participants.");

const profileIds = Object.keys(CANDIDATES);
const trialRows: any[] = [];
for (const [pi, p] of participants.entries()) {
  const sequence = EXPERIMENT.sequences[p.sequence_id as keyof typeof EXPERIMENT.sequences];
  for (let n = 1; n <= 4; n++) {
    const conditionId = sequence[n - 1];
    const condition = EXPERIMENT.conditions[conditionId as keyof typeof EXPERIMENT.conditions];
    const started = now - 7 * 24 * 60 * 60 * 1000 + pi * 60_000 + n * 1000;
    trialRows.push({ participant_id: p.id, trial_number: n, profile_id: profileIds[(pi + n - 1) % profileIds.length], condition_id: conditionId, execution_autonomy: condition.autonomy, decision_authority: condition.authority, status: "completed", experiment_version: EXPERIMENT.version, started_at: iso(started, 0), completed_at: iso(started, 150_000), is_mock: true });
  }
}
const { data: trials, error: trialError } = await db.from("trials").insert(trialRows).select("id,participant_id,trial_number,profile_id,condition_id,execution_autonomy,decision_authority,started_at,experiment_version");
if (trialError || !trials) throw trialError ?? new Error("Could not create mock trials.");

const { data: catalog, error: catalogError } = await db.from("gift_candidates").select("id,profile_id,product_name,overall_score").eq("candidate_set_id", "set-v1");
if (catalogError || !catalog) throw catalogError ?? new Error("Could not load candidate catalog.");
const participantsById = Object.fromEntries(participants.map((p: any) => [p.id, p]));
const events: any[] = [], responseRows: any[] = [], linkRows: any[] = [], selectionRows: any[] = [];

function addEvent(t: any, p: any, event_type: string, offset: number, event_target?: string, event_value?: string, payload: Record<string, unknown> = {}) {
  const stamp = iso(new Date(t.started_at).getTime(), offset);
  events.push({ participant_id: p.id, trial_id: t.id, event_type, event_target: event_target ?? null, event_value: event_value ?? null, payload, payload_json: payload, client_timestamp: stamp, server_timestamp: stamp, created_at: stamp, elapsed_from_trial_start_ms: offset, elapsed_ms: null, experiment_version: t.experiment_version, role: p.role, trial_number: t.trial_number, profile_id: t.profile_id, condition_id: t.condition_id, intimacy_condition: p.intimacy_condition, sequence_id: p.sequence_id, execution_autonomy: t.execution_autonomy, decision_authority: t.decision_authority, is_mock: true });
}

for (const [index, t] of trials.entries()) {
  const p: any = participantsById[t.participant_id], seed = index + 13;
  const pool = (catalog as any[]).filter(c => c.profile_id === t.profile_id).slice(0, 3);
  if (pool.length !== 3) throw new Error(`Expected three catalog candidates for ${t.profile_id}.`);
  linkRows.push(...pool.map((c, i) => ({ trial_id: t.id, gift_candidate_id: c.id, display_order: i + 1, is_mock: true })));
  const add = (type: string, at: number, target?: string, value?: string, payload: Record<string, unknown> = {}) => addEvent(t, p, type, at, target, value, payload);
  if (t.trial_number === 1) add("experiment_started", 0);
  add("trial_started", 0); add("profile_shown", 0);
  let cursor = 1000;
  if (t.execution_autonomy === "human_guided") {
    for (const [qi, q] of EXPERIMENT.questions.entries()) {
      const shownAt = cursor, elapsed = Math.round(rand(seed + qi, 8000, 25000)), answeredAt = shownAt + elapsed;
      const answer = q.options[(seed + qi) % q.options.length];
      add("guided_question_shown", shownAt, q.id);
      add("guided_option_selected", answeredAt, q.id, answer);
      const revised = (seed + qi) % 4 === 0;
      if (revised) add("guided_answer_changed", answeredAt + 500, q.id, q.options[(seed + qi + 1) % q.options.length], { revision: 1 });
      add("guided_answer_confirmed", answeredAt + 1000, q.id, answer);
      responseRows.push({ trial_id: t.id, question_id: q.id, question_text: q.text, answer_value: answer, shown_at: iso(new Date(t.started_at).getTime(), shownAt), answered_at: iso(new Date(t.started_at).getTime(), answeredAt), confirmed_at: iso(new Date(t.started_at).getTime(), answeredAt + 1000), response_time_ms: elapsed, revision_count: revised ? 1 : 0, is_mock: true });
      cursor = answeredAt + 1500;
    }
  }
  add("system_processing_started", cursor);
  if (t.execution_autonomy === "agent_autonomous") {
    add("autonomous_processing_started", cursor);
    add("autonomous_processing_step", cursor + 1500, "candidate_analysis");
  }
  const processingMs = Math.round(rand(seed, 3000, 8000)); cursor += processingMs;
  add("system_processing_completed", cursor);
  if (t.execution_autonomy === "agent_autonomous") add("autonomous_processing_completed", cursor);
  cursor += 500;
  add("candidates_shown", cursor, undefined, undefined, { count: 3 });
  add("candidate_opened", cursor + 1000, "A"); add("candidate_detail_viewed", cursor + 1000, "A");
  add("candidate_closed", cursor + 6000, "A"); add("candidate_opened", cursor + 7000, "B"); add("candidate_detail_viewed", cursor + 7000, "B");
  add("candidate_closed", cursor + 11000, "B"); add("candidate_reopened", cursor + 12000, "A"); add("candidate_detail_viewed", cursor + 12000, "A");
  const comparisonAt = cursor + Math.round(rand(seed + 1, 10000, 60000));
  add("comparison_shown", comparisonAt); add("comparison_interacted", comparisonAt + 2000, "sort", "price");
  const nextAt = comparisonAt + Math.round(rand(seed + 2, 5000, 18000));
  const selected = pool[seed % 3]; let finalAt: number;
  if (t.decision_authority === "human") {
    add("human_selection_screen_shown", nextAt); add("human_candidate_selected", nextAt + 1000, "A", pool[0].id);
    if (seed % 3 === 0) add("human_candidate_changed", nextAt + 2500, "B", pool[1].id);
    finalAt = nextAt + Math.round(rand(seed + 3, 5000, 30000));
    add("human_final_selection", finalAt, undefined, selected.id, { candidateId: selected.id });
  } else {
    add("agent_selection_started", nextAt); add("system_processing_started", nextAt);
    finalAt = nextAt + Math.round(rand(seed + 3, 3000, 8000));
    add("agent_final_selection", finalAt, undefined, selected.id, { candidateId: selected.id }); add("system_processing_completed", finalAt);
  }
  add("paper_survey_prompt_shown", finalAt + 1000); add("paper_survey_completed_confirmed", finalAt + 91000); add("trial_completed", finalAt + 92000);
  selectionRows.push({ trial_id: t.id, selected_candidate_id: selected.id, selected_by: t.decision_authority, selected_at: iso(new Date(t.started_at).getTime(), finalAt), is_mock: true });
}

for (const [table, rows] of [["trial_candidates", linkRows], ["guided_responses", responseRows], ["final_selections", selectionRows], ["event_logs", events]] as const) {
  for (let i = 0; i < rows.length; i += 500) { const { error } = await db.from(table).insert(rows.slice(i, i + 500) as any[]); if (error) throw error; }
}
console.log(`Created synthetic QA dataset: ${participants.length} participants, ${trials.length} trials, ${events.length} behavior events. All rows have is_mock=true.`);
