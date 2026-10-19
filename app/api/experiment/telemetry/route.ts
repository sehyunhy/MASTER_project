import { NextResponse } from "next/server";
import { z } from "zod";
import { studySession } from "@/lib/study/server";
import { clientStudyEvents } from "@/lib/study/telemetry-types";

const eventSchema = z.object({
  role: z.enum(["giver", "recipient"]), trialId: z.uuid(), phaseAtCapture: z.enum([
    "locked", "candidates", "decision", "survey", "complete", "timeout", "skipped",
  ]),
  eventType: z.string().max(70), target: z.string().max(150).optional(),
  payload: z.record(z.string(), z.unknown()), key: z.uuid(),
  clientAt: z.iso.datetime(), visitId: z.uuid(), tabId: z.string().max(80),
  clientSequence: z.number().int().nonnegative(), clientElapsedMs: z.number().int().nonnegative(),
  uiSurface: z.string().max(70).optional(), operationId: z.uuid().optional(),
});
const schema = z.object({ events: z.array(eventSchema).min(1).max(20) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.events.some(event =>
    !clientStudyEvents.has(event.eventType) || JSON.stringify(event.payload).length > 5000))
    return NextResponse.json({ error: "INVALID_TELEMETRY" }, { status: 400 });
  try {
    const { db, person } = await studySession();
    const trialIds = [...new Set(parsed.data.events.map(event => event.trialId))];
    const { data: trials, error } = await db.from("study_trials")
      .select("id,role,condition,order_position,person_id")
      .eq("person_id", person.id).in("id", trialIds);
    if (error) throw error;
    const byId = new Map((trials ?? []).map(trial => [trial.id, trial]));
    if (byId.size !== trialIds.length || parsed.data.events.some(event =>
      byId.get(event.trialId)?.role !== event.role))
      return NextResponse.json({ error: "TRIAL_FORBIDDEN" }, { status: 403 });
    const rows = parsed.data.events.map(event => {
      const trial = byId.get(event.trialId)!;
      return {
        person_id: person.id, trial_id: trial.id, role: trial.role,
        condition: trial.condition, order_position: trial.order_position,
        phase: event.phaseAtCapture, phase_at_capture: event.phaseAtCapture,
        actor: "participant", origin: "participant", event_type: event.eventType,
        target: event.target ?? null, payload: event.payload,
        client_at: event.clientAt,
        idempotency_key: event.key, visit_id: event.visitId, tab_id: event.tabId,
        client_sequence: event.clientSequence, client_elapsed_ms: event.clientElapsedMs,
        ui_surface: event.uiSurface ?? null, operation_id: event.operationId ?? null,
        event_schema_version: 2,
      };
    });
    const { error: insertError } = await db.from("study_events").upsert(rows,
      { onConflict: "trial_id,idempotency_key", ignoreDuplicates: true });
    if (insertError) throw insertError;
    return NextResponse.json({ stored: rows.length });
  } catch (cause) {
    console.error("Study telemetry failed", cause);
    return NextResponse.json({ error: "TELEMETRY_UNAVAILABLE" }, { status: 503 });
  }
}
