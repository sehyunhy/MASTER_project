import { mkdirSync, writeFileSync } from "node:fs";
import { dbClient } from "./common";
import { EXPERIMENT } from "../config/experiment";
import { validateWilliamsSequences } from "../lib/experiment/assignment";
import { deriveBehaviorMetrics } from "../lib/experiment/behavior";

const report: any = { generatedAt: new Date().toISOString(), errors: [], checks: {} };
try { report.checks.williams = validateWilliamsSequences(); } catch (e) { report.errors.push(String(e)); }
const db = dbClient();
const { data: participants, error } = await db.from("participants").select("id,participant_code,intimacy_condition,sequence_id,role,is_mock").eq("is_mock", true);
if (error) report.errors.push(error.message);
const ps = participants ?? [];
report.checks.mockParticipants = { total: ps.length, high: ps.filter(p => p.intimacy_condition === "high").length, low: ps.filter(p => p.intimacy_condition === "low").length, cells: Object.fromEntries(["high", "low"].flatMap(level => ["S1", "S2", "S3", "S4"].map(seq => [`${level}-${seq}`, ps.filter(p => p.intimacy_condition === level && p.sequence_id === seq).length]))) };
if (ps.length !== 40 || report.checks.mockParticipants.high !== 20 || report.checks.mockParticipants.low !== 20 || Object.values(report.checks.mockParticipants.cells).some((n: any) => n !== 5)) report.errors.push("Mock participant balance must be 20/20 with five in each intimacy-by-sequence cell.");

const counts = { trials: 0, candidates: 0, responses: 0, selections: 0, events: 0 };
const stamp = (e: any) => new Date(e.client_timestamp ?? e.server_timestamp ?? e.created_at).getTime();
for (const p of ps) {
  const { data: trials, error: trialError } = await db.from("trials").select("id,trial_number,profile_id,condition_id,execution_autonomy,decision_authority,is_mock,status").eq("participant_id", p.id).order("trial_number");
  if (trialError) { report.errors.push(trialError.message); continue; }
  const ts = trials ?? []; counts.trials += ts.length;
  const expected = EXPERIMENT.sequences[p.sequence_id as keyof typeof EXPERIMENT.sequences];
  if (ts.length !== 4 || ts.some((t, i) => t.condition_id !== expected[i]) || new Set(ts.map(t => t.condition_id)).size !== 4) report.errors.push(`${p.participant_code}: trial conditions/order do not match assigned sequence.`);
  if (new Set(ts.map(t => t.profile_id)).size !== 4) report.errors.push(`${p.participant_code}: must see four unique profiles.`);
  for (const trial of ts) {
    const prefix = `${p.participant_code}/T${trial.trial_number}`;
    const [candidateResult, selectionResult, responseResult, eventResult] = await Promise.all([
      db.from("trial_candidates").select("id", { count: "exact", head: true }).eq("trial_id", trial.id),
      db.from("final_selections").select("selected_by").eq("trial_id", trial.id).maybeSingle(),
      db.from("guided_responses").select("question_id,response_time_ms,revision_count,shown_at,answered_at,is_mock").eq("trial_id", trial.id),
      db.from("event_logs").select("event_type,event_target,event_value,client_timestamp,server_timestamp,created_at,elapsed_from_trial_start_ms,is_mock").eq("trial_id", trial.id),
    ]);
    const candidateCount = candidateResult.count ?? 0; counts.candidates += candidateCount;
    if (candidateCount !== 3) report.errors.push(`${prefix}: expected exactly three candidates.`);
    const selection = selectionResult.data;
    if (selection) { counts.selections++; if (selection.selected_by !== trial.decision_authority) report.errors.push(`${prefix}: selected_by does not match assigned authority.`); }
    else report.errors.push(`${prefix}: final selection missing.`);
    const responses: any[] = responseResult.data ?? []; counts.responses += responses.length;
    const guided = trial.execution_autonomy === "human_guided";
    if (guided && (responses.length !== 3 || new Set(responses.map(r => r.question_id)).size !== 3)) report.errors.push(`${prefix}: guided trial must have three unique responses.`);
    if (!guided && responses.length !== 0) report.errors.push(`${prefix}: autonomous trial has guided responses.`);
    if (!trial.is_mock || responses.some(r => !r.is_mock)) report.errors.push(`${prefix}: mock trial or responses are missing is_mock flag.`);
    const events: any[] = eventResult.data ?? []; counts.events += events.length;
    if (events.some(e => !e.is_mock)) report.errors.push(`${prefix}: event is missing is_mock flag.`);
    const count = (name: string) => events.filter(e => e.event_type === name).length;
    if (trial.decision_authority === "human" && count("human_final_selection") !== 1) report.errors.push(`${prefix}: human-selected trial must have exactly one human_final_selection.`);
    if (trial.decision_authority === "agent" && (count("human_final_selection") !== 0 || count("agent_final_selection") !== 1)) report.errors.push(`${prefix}: agent-selected trial must have zero human finals and exactly one agent final.`);
    if (guided && (count("guided_question_shown") !== 3 || count("guided_answer_confirmed") !== 3)) report.errors.push(`${prefix}: guided trial must show and confirm three questions.`);
    if (!guided && (count("guided_question_shown") !== 0 || count("guided_answer_confirmed") !== 0)) report.errors.push(`${prefix}: autonomous trial must not log guided answers.`);
    if (count("candidates_shown") !== 1) report.errors.push(`${prefix}: candidate display event must occur exactly once.`);

    const ordered = [...events].sort((a, b) => stamp(a) - stamp(b));
    const first = (type: string) => { const e = ordered.find(x => x.event_type === type); return e ? stamp(e) : null; };
    const finalType = trial.decision_authority === "human" ? "human_final_selection" : "agent_final_selection";
    const candidatesAt = first("candidates_shown"), compareAt = first("comparison_shown"), finalAt = first(finalType);
    if (candidatesAt === null || compareAt === null || finalAt === null || !(candidatesAt <= compareAt && compareAt <= finalAt)) report.errors.push(`${prefix}: expected candidates_shown ≤ comparison_shown ≤ final selection.`);
    const selectionStage = first(trial.decision_authority === "human" ? "human_selection_screen_shown" : "agent_selection_started");
    if (compareAt === null || selectionStage === null || finalAt === null || !(compareAt <= selectionStage && selectionStage <= finalAt)) report.errors.push(`${prefix}: comparison, decision-stage, and final-selection timestamps are out of order.`);
    if (candidatesAt !== null && compareAt !== null && ordered.some(e => ["candidate_opened", "candidate_reopened", "candidate_detail_viewed"].includes(e.event_type) && !(stamp(e) >= candidatesAt && stamp(e) <= compareAt))) report.errors.push(`${prefix}: candidate interaction is outside candidate-inspection interval.`);
    if (guided) for (const questionId of EXPERIMENT.questions.map(q => q.id)) {
      const shown = ordered.find(e => e.event_type === "guided_question_shown" && e.event_target === questionId);
      const confirmed = ordered.find(e => e.event_type === "guided_answer_confirmed" && e.event_target === questionId);
      if (!shown || !confirmed || stamp(shown) > stamp(confirmed) || (candidatesAt !== null && stamp(confirmed) > candidatesAt)) report.errors.push(`${prefix}: guided question ${questionId} timestamps are out of order.`);
    }
    if (events.some(e => !Number.isFinite(stamp(e)))) report.errors.push(`${prefix}: event has invalid timestamp.`);
    if (responses.some(r => r.response_time_ms < 0 || new Date(r.answered_at).getTime() < new Date(r.shown_at).getTime())) report.errors.push(`${prefix}: negative guided response duration.`);
    const metrics = deriveBehaviorMetrics(events, responses, trial.decision_authority, guided, trial.status === "completed");
    for (const key of ["total_task_time_ms", "human_active_time_ms", "system_processing_time_ms", "candidate_inspection_time_ms", "active_candidate_inspection_time_ms", "comparison_time_ms", "active_comparison_time_ms", "visibility_hidden_time_ms"]) {
      const value = (metrics as any)[key]; if (typeof value === "number" && value < 0) report.errors.push(`${prefix}: ${key} is negative.`);
    }
    if (metrics.visibility_hidden_time_ms < 0) report.errors.push(`${prefix}: hidden tab duration is negative.`);
    if (metrics.total_task_time_ms !== null && metrics.human_active_time_ms !== null && metrics.human_active_time_ms + metrics.system_processing_time_ms > metrics.total_task_time_ms + 1) report.errors.push(`${prefix}: human active + system processing exceeds total task time.`);
    if (trial.decision_authority === "agent" && (metrics.final_choice_latency_ms !== null || metrics.final_choice_revision_count !== null)) report.errors.push(`${prefix}: agent-selected human-only metrics must be null.`);
    if (trial.decision_authority === "human" && (metrics.final_choice_latency_ms === null || metrics.final_choice_revision_count === null)) report.errors.push(`${prefix}: human-selected choice metrics must be present.`);
    if (!guided && (metrics.guided_total_response_time_ms !== null || metrics.guided_mean_response_time_ms !== null || metrics.guided_answer_revision_count !== null)) report.errors.push(`${prefix}: autonomous guided metrics must be null.`);
    if (guided && (metrics.guided_total_response_time_ms === null || metrics.guided_mean_response_time_ms === null || metrics.guided_answer_revision_count === null)) report.errors.push(`${prefix}: guided-only metrics must be present.`);
    if (!trial.is_mock) report.errors.push(`${prefix}: trial is missing is_mock flag.`);
  }
}
report.checks.mockRows = counts;
report.result = report.errors.length ? "failed" : "passed";
mkdirSync("reports", { recursive: true });
writeFileSync("reports/experiment-validation.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exitCode = 1;
