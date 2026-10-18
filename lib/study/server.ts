import { supabaseAdmin } from "@/lib/supabase/server";
import { currentParticipantIdFromSession } from "@/lib/auth/participant";
import profiles from "@/config/study-profiles.json";
import type { StudyProfile } from "@/lib/study/agent";

export function profileFor(code: string): StudyProfile | null {
  const item = profiles.profiles.find(profile => profile.profile_code === code);
  return item ? { name: item.name, age: item.age, hobbies: item.hobbies,
    recent_interest: item.recent_interest, preference: item.preference,
    dislike: item.dislike, gift_budget: item.gift_budget } : null;
}

export async function studySession(role?: "giver" | "recipient") {
  const personId = await currentParticipantIdFromSession();
  if (!personId) throw new Error("SESSION_REQUIRED");
  const db = supabaseAdmin();
  const { data: person, error } = await db.from("study_people").select("*").eq("id", personId).single();
  if (error || !person) throw new Error("SESSION_REQUIRED");
  if (person.status === "withdrawn") throw new Error("STUDY_WITHDRAWN");
  if (role && person.current_role !== role) throw new Error("ROLE_LOCKED");
  return { db, person };
}

export async function trialFor(db: any, personId: string, role: string, trialId?: string) {
  const { data, error } = await db.from("study_trials").select("*")
    .eq("person_id", personId).eq("role", role).order("order_position");
  if (error) throw error;
  const trials = data ?? [];
  const trial = trials.find((item: any) => item.phase !== "complete") ?? trials[trials.length - 1];
  if (!trial || (trialId && trial.id !== trialId)) throw new Error("TRIAL_LOCKED");
  return { trial, trials };
}

export async function logStudyEvent(db: any, input: {
  personId: string; trial?: any; actor?: "participant" | "agent" | "scripted_giver" | "system";
  origin?: "participant" | "agent" | "scripted" | "system"; type: string;
  target?: string; payload?: Record<string, unknown>; clientAt?: string; key?: string;
}) {
  const row = { person_id: input.personId, trial_id: input.trial?.id ?? null,
    role: input.trial?.role ?? null, condition: input.trial?.condition ?? null,
    order_position: input.trial?.order_position ?? null, phase: input.trial?.phase ?? null,
    actor: input.actor ?? "participant", origin: input.origin ?? "participant",
    event_type: input.type, target: input.target ?? null, payload: input.payload ?? {},
    client_at: input.clientAt ?? null, idempotency_key: input.key ?? null,
  };
  const { error } = await db.from("study_events").upsert(row, { onConflict: "trial_id,idempotency_key", ignoreDuplicates: true });
  if (error) throw error;
}
