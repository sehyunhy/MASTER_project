import { NextResponse } from "next/server";
import { z } from "zod";
import { studySession, trialFor, logStudyEvent } from "@/lib/study/server";
import { MINIMUM_PHASE_MS } from "@/lib/study/config";

const schema = z.object({
  role: z.enum(["giver", "recipient"]), trialId: z.uuid(), type: z.enum([
    "activate", "ping", "candidatesVisible", "advance", "confirmCandidate", "finalizeHuman", "revealScriptedFinal",
    "survey", "skipTimeout", "event", "scriptedShown", "withdraw",
  ]),
  key: z.uuid().optional(), code: z.string().optional(), tabId: z.string().max(80).optional(),
  sequence: z.number().int().optional(), active: z.boolean().optional(),
  requestKey: z.uuid().optional(), productId: z.string().optional(), reason: z.string().optional(),
  messageId: z.number().int().positive().optional(),
  eventType: z.string().max(70).optional(), target: z.string().max(120).optional(),
  payload: z.record(z.string(), z.unknown()).optional(), clientAt: z.iso.datetime().optional(),
});

const allowedEvents = new Set([
  "screen_view", "tab_hidden", "tab_visible", "connection_lost", "connection_restored", "reconnected",
  "prompt_started", "prompt_changed", "prompt_submitted", "prompt_rejected", "candidate_request",
  "candidate_opened", "candidate_closed", "candidate_revisited", "candidate_dwell",
  "candidate_confirmation_attempt", "comparison_opened", "comparison_closed", "selection_draft",
  "selection_changed", "reason_started", "reason_changed", "reason_submitted",
  "survey_started", "transition_opened", "retry", "error", "observation_started",
]);

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const body = parsed.data;
  if (JSON.stringify(body.payload??{}).length>5000)
    return NextResponse.json({error:"행동 자료가 너무 깁니다."},{status:400});
  try {
    const { db, person } = await studySession(body.role);
    const { trial } = await trialFor(db, person.id, body.role, body.trialId);
    let result: any;
    if (body.type === "activate") {
      if (!body.key) throw new Error("REQUEST_KEY_REQUIRED");
      if (body.role === "recipient" && !trial.stimulus_id) {
        const {data:stimulus,error:stimulusError}=await db.from("study_stimuli")
          .select("id").eq("profile_code",trial.profile_code).eq("condition",trial.condition)
          .eq("stimulus_version",trial.stimulus_version_target ?? "birthday-friend-a-web-v1")
          .not("approved_at","is",null).maybeSingle();
        if (stimulusError) throw stimulusError;
        if (!stimulus) throw new Error("APPROVED_STIMULUS_MISSING");
      }
      const response = await db.rpc("study_activate", {
        p_person_id: person.id, p_trial_id: trial.id, p_code: body.code ?? "", p_attempt_key: body.key,
      });
      if (response.error) throw response.error;
      result = response.data;
      if (result.accepted && body.role === "recipient") {
        const attach = await db.rpc("study_attach_stimulus", { p_person_id: person.id, p_trial_id: trial.id });
        if (attach.error) throw attach.error;
      }
    } else if (body.type === "ping") {
      if (!body.tabId || body.sequence === undefined || body.active === undefined) throw new Error("PING_FIELDS_REQUIRED");
      const response = await db.rpc("study_ping", { p_trial_id: trial.id, p_tab_id: body.tabId,
        p_sequence: body.sequence, p_active: body.active });
      if (response.error) throw response.error;
      result = response.data;
    } else if (body.type === "candidatesVisible") {
      const response = await db.rpc("study_mark_candidates_visible", { p_trial_id: trial.id, p_person_id: person.id });
      if (response.error) throw response.error;
      result = response.data;
    } else if (body.type === "advance") {
      const response = await db.rpc("study_advance", { p_trial_id: trial.id, p_person_id: person.id });
      if (response.error) throw response.error;
      result = response.data;
    } else if (body.type === "confirmCandidate") {
      if (body.role !== "giver" || !body.requestKey || !body.key) throw new Error("CANDIDATE_CONFIRM_NOT_ALLOWED");
      const response = await db.rpc("study_confirm_candidate", { p_trial_id: trial.id, p_person_id: person.id,
        p_request_key: body.requestKey, p_event_key: body.key });
      if (response.error) throw response.error;
      result = response.data;
    } else if (body.type === "finalizeHuman") {
      if (body.role !== "giver" || trial.decision_actor !== "human" || !body.productId || !body.key)
        throw new Error("FINAL_ACTION_NOT_ALLOWED");
      const response = await db.rpc("study_finalize", { p_trial_id: trial.id, p_person_id: person.id,
        p_product_id: body.productId, p_actor: "human", p_reason: body.reason ?? "", p_event_key: body.key });
      if (response.error) throw response.error;
      result = response.data;
    } else if (body.type === "revealScriptedFinal") {
      if (body.role !== "recipient" || trial.phase !== "decision" || !trial.stimulus_id || !body.key)
        throw new Error("OBSERVATION_NOT_ALLOWED");
      const { data: stimulus, error } = await db.from("study_stimuli").select("final_product_id,transcript")
        .eq("id", trial.stimulus_id).not("approved_at", "is", null).single();
      if (error || !stimulus) throw error ?? new Error("APPROVED_STIMULUS_MISSING");
      const decision = Array.isArray(stimulus.transcript)
        ? stimulus.transcript.find((item: any) => item.phase === "decision" && item.kind === "final_selection") : null;
      const reason = String(decision?.content ?? "").trim();
      if (reason.length < 15) throw new Error("SCRIPTED_REASON_MISSING");
      const response = await db.rpc("study_finalize", { p_trial_id: trial.id, p_person_id: person.id,
        p_product_id: stimulus.final_product_id, p_actor: trial.decision_actor,
        p_reason: reason, p_event_key: body.key });
      if (response.error) throw response.error;
      result = response.data;
    } else if (body.type === "survey") {
      const response = await db.rpc("study_finish_survey", { p_trial_id: trial.id, p_person_id: person.id });
      if (response.error) throw response.error;
      result = response.data;
    } else if (body.type === "skipTimeout") {
      if (!body.key) throw new Error("REQUEST_KEY_REQUIRED");
      const response = await db.rpc("study_skip_timed_out", { p_trial_id: trial.id,
        p_person_id: person.id, p_event_key: body.key });
      if (response.error) throw response.error;
      result = response.data;
    } else if (body.type === "scriptedShown") {
      if (body.role!=="recipient" || !body.messageId) throw new Error("SCRIPTED_EVENT_NOT_ALLOWED");
      const {data:message,error}=await db.from("study_messages").select("*")
        .eq("id",body.messageId).eq("trial_id",trial.id).eq("origin","scripted").single();
      if (error||!message) throw error??new Error("SCRIPTED_MESSAGE_NOT_FOUND");
      const phaseOrder=["candidates","decision","survey","complete"];
      if (phaseOrder.indexOf(message.phase)<0 || phaseOrder.indexOf(message.phase)>phaseOrder.indexOf(trial.phase))
        throw new Error("SCRIPTED_PHASE_MISMATCH");
      if (message.phase===trial.phase && Number(message.payload?.offset_ms??0)>trial.phase_effective_ms)
        throw new Error("SCRIPTED_MESSAGE_NOT_YET_VISIBLE");
      const {error:insertError}=await db.from("study_events").insert({
        person_id:person.id,trial_id:trial.id,role:trial.role,condition:trial.condition,
        order_position:trial.order_position,phase:trial.phase,
        actor:message.speaker,origin:"scripted",event_type:"scripted_message_shown",
        target:String(message.id),payload:{stimulus_id:trial.stimulus_id,
          stimulus_version:message.payload?.stimulus_version,kind:message.kind,
          offset_ms:message.payload?.offset_ms},
      });
      if(insertError&&insertError.code!=="23505") throw insertError;
      result={stored:true};
    } else if (body.type === "event") {
      if (!body.eventType || !allowedEvents.has(body.eventType) || !body.key) throw new Error("EVENT_NOT_ALLOWED");
      await logStudyEvent(db, { personId: person.id, trial, type: body.eventType, key: body.key,
        target: body.target, payload: body.payload, clientAt: body.clientAt });
      result = { stored: true };
    } else {
      if (!body.key) throw new Error("REQUEST_KEY_REQUIRED");
      const { error } = await db.from("study_people").update({ status: "withdrawn", updated_at: new Date().toISOString() })
        .eq("id", person.id).eq("status", "active");
      if (error) throw error;
      await logStudyEvent(db, { personId: person.id, trial, type: "withdrawn", key: body.key });
      result = { withdrawn: true };
    }
    return NextResponse.json(result);
  } catch (cause) {
    console.error("Study action failed", { type: body.type, cause });
    const message = cause instanceof Error ? cause.message : "REQUEST_FAILED";
    const known: Record<string,string> = {
      MINIMUM_EXPOSURE_REQUIRED: `이 단계의 유효 확인시간 ${MINIMUM_PHASE_MS/1000}초가 지나야 합니다.`,
      THREE_CANDIDATES_REQUIRED: "후보 세 개를 먼저 확정해 주세요.",
      HUMAN_REASON_REQUIRED: "다른 두 후보가 아닌 이 선물을 고른 이유를 구체적으로 적어 주세요.",
      PREVIOUS_SURVEY_REQUIRED: "직전 조건의 종이 설문 완료를 먼저 확인해 주세요.",
      TIMEOUT_REQUIRED: "시간초과로 기록된 조건에서만 미완료로 넘어갈 수 있습니다.",
      APPROVED_STIMULUS_MISSING: "연구자가 검토한 관찰 자료가 아직 준비되지 않았습니다.",
      STIMULUS_CONTROL_MISMATCH: "조건 간 상품 통제가 일치하지 않습니다. 연구자에게 알려주세요.",
      OTHER_TAB_ACTIVE: "다른 탭에서 이 실험이 열려 있습니다.",
    };
    return NextResponse.json({ error: known[message] ?? "처리하지 못했습니다. 다시 시도하거나 연구자에게 알려주세요." }, { status: 409 });
  }
}
