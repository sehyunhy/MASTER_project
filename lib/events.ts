import { supabaseAdmin } from "@/lib/supabase/server";

export async function logEvent(input: { participantId: string; trialId?: string; eventType: string; payload?: Record<string, unknown>; elapsedMs?: number; elapsedFromTrialStartMs?:number; eventTarget?:string; eventValue?:string; clientTimestamp?:string }) {
  const db = supabaseAdmin();
  const { data: p } = await db.from("participants").select("role,intimacy_condition,sequence_id,is_mock").eq("id", input.participantId).single();
  const { data: t } = input.trialId ? await db.from("trials").select("trial_number,profile_id,condition_id,execution_autonomy,decision_authority,started_at").eq("id", input.trialId).single() : { data: null };
  const serverTimestamp=new Date().toISOString();
  const elapsedFromStart=input.elapsedFromTrialStartMs??(t?.started_at?Math.max(0,Date.now()-new Date(t.started_at).getTime()):null);
  const { error } = await db.from("event_logs").insert({ participant_id: input.participantId, trial_id: input.trialId ?? null, event_type: input.eventType, event_target:input.eventTarget??null,event_value:input.eventValue??null,payload: input.payload ?? {},payload_json:input.payload??{}, elapsed_ms: input.elapsedMs ?? null,elapsed_from_trial_start_ms:elapsedFromStart,client_timestamp:input.clientTimestamp??null,server_timestamp:serverTimestamp,created_at:serverTimestamp,experiment_version: "1.0.0", role: p?.role, intimacy_condition: p?.intimacy_condition, sequence_id: p?.sequence_id, is_mock: p?.is_mock ?? false, trial_number: t?.trial_number, profile_id: t?.profile_id, condition_id: t?.condition_id,execution_autonomy:t?.execution_autonomy,decision_authority:t?.decision_authority });
  if (error) throw error;
}
