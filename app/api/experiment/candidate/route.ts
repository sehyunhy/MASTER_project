import { NextResponse } from "next/server";
import { z } from "zod";
import { studySession, trialFor, profileFor, logStudyEvent } from "@/lib/study/server";
import { isBroadDelegation, preflightHumanRequest, proposeOne, proposeThree, chooseFinal, groundedReason, verifiedEvidence, type StudyProduct } from "@/lib/study/agent";
import { STUDY_PROMPT_VERSION } from "@/lib/study/config";

const schema = z.object({
  role: z.literal("giver"), trialId: z.uuid(), task: z.enum(["one","batch","final"]),
  key: z.uuid(), request: z.string().max(1500).optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "요청을 다시 확인해 주세요." }, { status: 400 });
  const body = parsed.data;
  let db: ReturnType<typeof import("@/lib/supabase/server").supabaseAdmin> | undefined;
  let personId = "";
  let claimed = false;
  try {
    const session = await studySession("giver");
    db = session.db; personId = session.person.id;
    const { trial } = await trialFor(db, personId, "giver", body.trialId);
    const profile = profileFor(trial.profile_code);
    if (!profile) throw new Error("PROFILE_MISSING");
    const { data: products, error: catalogError } = await db.from("study_products").select("*")
      .eq("reviewed", true).contains("profile_codes", [trial.profile_code])
      .lte("price_krw", profile.gift_budget);
    if (catalogError) throw catalogError;
    const pool = (products ?? []) as StudyProduct[];
    if (pool.length < 3) throw new Error("APPROVED_POOL_INCOMPLETE");
    if (body.task === "one") {
      const requestText = body.request?.trim() ?? "";
      const guidance = preflightHumanRequest(requestText, profile);
      if (guidance) {
        const broad = isBroadDelegation(requestText);
        await logStudyEvent(db, { personId, trial, type: broad ? "delegation_rejected" : "prompt_rejected", key: body.key,
          payload: { request: requestText, reason: broad ? "broad_delegation" : "empty_request" } });
        return NextResponse.json({ error: guidance }, { status: 422 });
      }
      const prior = await db.from("study_messages").select("content")
        .eq("trial_id", trial.id).eq("kind", "clarification")
        .contains("payload", { request_key: body.key }).maybeSingle();
      if (prior.error) throw prior.error;
      if (prior.data) return NextResponse.json({ clarification: prior.data.content, idempotent: true });
    }
    const claim = await db.rpc("study_claim_agent", { p_trial_id: trial.id,
      p_person_id: personId, p_kind: body.task, p_key: body.key });
    if (claim.error) throw claim.error;
    if (claim.data?.busy) return NextResponse.json({ error: "Agent 응답을 준비 중입니다. 잠시 기다려 주세요." }, { status: 409 });
    if (claim.data?.ready) return NextResponse.json({ ready: true });
    claimed = true;
    if (body.task === "one") {
      const requestText = body.request!.trim();
      const { error: messageError } = await db.from("study_messages").insert({
        trial_id: trial.id, phase: "candidates", speaker: "participant", origin: "participant",
        kind: "candidate_request", content: requestText, request_key: body.key,
      });
      if (messageError && messageError.code !== "23505") throw messageError;
      await logStudyEvent(db, { personId, trial, type: "candidate_request_sent", key: body.key,
        payload: { slot: trial.candidate_snapshots.length + 1, request: requestText } });
      const existing = trial.candidate_snapshots as StudyProduct[];
      const available = pool.filter(item => !existing.some(saved => saved.source_product_id === item.source_product_id));
      const result = await proposeOne({ profile, condition: trial.condition, products: available,
        existing, request: requestText });
      if (!result.value.valid_request) {
        const clarification = result.value.clarification.trim() || "지금 준비된 상품 중에는 요청에 맞는 상품이 없습니다. 다른 방향으로 다시 요청해 주세요.";
        const clarificationMessage = await db.from("study_messages").insert({ trial_id: trial.id, phase: "candidates", speaker: "agent",
          origin: "agent", kind: "clarification", content: clarification,
          payload: { model: result.model, response_id: result.responseId, latency_ms: result.latencyMs,
            request_key: body.key } });
        if (clarificationMessage.error) throw clarificationMessage.error;
        await logStudyEvent(db, { personId, trial, type: "agent_no_matching_product",
          payload: { model: result.model, response_id: result.responseId, latency_ms: result.latencyMs } });
        await db.rpc("study_release_agent", { p_trial_id: trial.id, p_person_id: personId, p_key: body.key });
        claimed = false;
        return NextResponse.json({ clarification });
      }
      const selected=available.find(item=>item.source_product_id===result.value.product_id)!;
      const evidence=verifiedEvidence(selected,result.value.evidence_quote);
      const saved = await db.rpc("study_store_proposal", { p_trial_id: trial.id, p_person_id: personId,
        p_request_key: body.key, p_source_id: result.value.product_id,
        p_reply: "기록된 상품 정보에서 후보 한 개를 제안했습니다.",
        p_reason: groundedReason(profile,selected,evidence),
        p_model: result.model, p_response_id: result.responseId,
        p_latency_ms: result.latencyMs,p_evidence_quote:evidence });
      if (saved.error) throw saved.error;
      claimed = false;
      return NextResponse.json({ proposal: saved.data });
    }
    if (body.task === "batch") {
      const result = await proposeThree({ profile, condition: trial.condition, products: pool });
      const evidenceQuotes=Object.fromEntries(result.value.product_ids.map((id,index)=>[id,
        verifiedEvidence(pool.find(item=>item.source_product_id===id)!,result.value.evidence_quotes[index])]));
      const reasons = Object.fromEntries(result.value.product_ids.map(id => [id,
        groundedReason(profile,pool.find(item=>item.source_product_id===id)!,evidenceQuotes[id])]));
      const saved = await db.rpc("study_store_batch", { p_trial_id: trial.id, p_person_id: personId,
        p_request_key: body.key, p_source_ids: result.value.product_ids, p_reasons: reasons,
        p_reply: "기록된 상품 정보에서 후보 세 개를 준비했습니다.",
        p_model: result.model, p_response_id: result.responseId,
        p_latency_ms: result.latencyMs,p_evidence_quotes:evidenceQuotes });
      if (saved.error) throw saved.error;
      claimed = false;
      return NextResponse.json({ candidates: saved.data.candidates });
    }
    const ids = (trial.candidate_snapshots as StudyProduct[]).map(item => item.source_product_id);
    const chosen = pool.filter(item => ids.includes(item.source_product_id));
    if (chosen.length !== 3) throw new Error("SAVED_CANDIDATES_MISSING");
    const result = await chooseFinal({ profile, condition: trial.condition, products: chosen });
    const selected=chosen.find(item=>item.source_product_id===result.value.product_id)!;
    const evidence=verifiedEvidence(selected,result.value.evidence_quote);
    const saved = await db.rpc("study_finalize", { p_trial_id: trial.id, p_person_id: personId,
      p_product_id: result.value.product_id, p_actor: "agent",
      p_reason: groundedReason(profile,selected,evidence),
      p_event_key: body.key, p_model: result.model, p_response_id: result.responseId,
      p_latency_ms: result.latencyMs, p_prompt_version: STUDY_PROMPT_VERSION,
      p_evidence_quote: evidence });
    if (saved.error) throw saved.error;
    claimed = false;
    return NextResponse.json({ final: saved.data });
  } catch (cause) {
    console.error("Study Agent task failed", { task: body.task, requestKey: body.key, cause });
    if (db && personId && claimed) await db.rpc("study_release_agent", {
      p_trial_id: body.trialId, p_person_id: personId, p_key: body.key,
    });
    if (db && personId) {
      try {
        const { trial } = await trialFor(db, personId, "giver", body.trialId);
        await logStudyEvent(db, { personId, trial, type: "agent_error",
          payload: { task: body.task, code: cause instanceof Error ? cause.message : "UNKNOWN" } });
      } catch {}
    }
    return NextResponse.json({ error: "상품 정보를 준비하지 못했습니다. 연구자에게 오류번호를 알려주세요.", errorRef: body.key.slice(0,8) }, { status: 503 });
  }
}
