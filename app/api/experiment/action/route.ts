import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { answerSchema, finalSelectionSchema, eventSchema } from "@/lib/validation/schemas";
import { logEvent } from "@/lib/events";
import { EXPERIMENT, CANDIDATES } from "@/config/experiment";
import { generateLiveCandidates } from "@/lib/liveCandidates";
import { participantSessionMatches } from "@/lib/auth/participant";
import { selectControlledCandidates } from "@/lib/experiment/candidates";

async function checkTrialAccess(db:ReturnType<typeof supabaseAdmin>,participantId:string,trialId:string){
  const {count:passed}=await db.from("training_attempts").select("id",{count:"exact",head:true}).eq("participant_id",participantId).eq("passed",true);
  if(!passed)throw new Error("Training not completed.");
  const {data:trials}=await db.from("trials").select("id,status,trial_number").eq("participant_id",participantId).order("trial_number");
  const current=(trials??[]).find(t=>t.status!=="completed");
  if(!current||current.id!==trialId)throw new Error("Trial is not the current participant step.");
}

export async function POST(request: Request) {
  const input = await request.json();
  const db = supabaseAdmin();
  if(input.action!=="show_candidates"&&!await participantSessionMatches(String(input.participantId??"")))return NextResponse.json({error:"참가자 세션이 만료되었습니다."},{status:401});
  if(input.action==="show_candidates"){
    const {data:t}=await supabaseAdmin().from("trials").select("participant_id").eq("id",String(input.trialId??"")).single();
    if(!t||!await participantSessionMatches(t.participant_id))return NextResponse.json({error:"참가자 세션이 만료되었습니다."},{status:401});
    try{await checkTrialAccess(supabaseAdmin(),t.participant_id,String(input.trialId));}catch{return NextResponse.json({error:"연습을 완료한 뒤 순서에 따라 진행해 주세요."},{status:403});}
  }
  if(input.trialId&&input.action!=="show_candidates")try{await checkTrialAccess(db,String(input.participantId??""),String(input.trialId));}catch{return NextResponse.json({error:"연습을 완료한 뒤 현재 단계에서 진행해 주세요."},{status:403});}
  try {
    if (input.action === "event") {
      const v = eventSchema.safeParse(input);
      if (!v.success) return NextResponse.json({ error: "이벤트 정보를 확인해 주세요." }, { status: 400 });
      if(v.data.eventType==="trial_started"&&v.data.trialId){await db.from("trials").update({started_at:new Date().toISOString()}).eq("id",v.data.trialId).is("started_at",null);}
      await logEvent({ participantId: v.data.participantId, trialId: v.data.trialId, eventType: v.data.eventType, payload: v.data.payload, elapsedMs: v.data.elapsedMs,eventTarget:v.data.eventTarget,eventValue:v.data.eventValue,clientTimestamp:v.data.clientTimestamp,elapsedFromTrialStartMs:v.data.elapsedFromTrialStartMs });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "answer") {
      const v = answerSchema.safeParse(input);
      if (!v.success || !v.data.trialId) return NextResponse.json({ error: "응답을 확인해 주세요." }, { status: 400 });
      const q = EXPERIMENT.questions.find(x => x.id === v.data.questionId);
      if (!q || !(q.options as readonly string[]).includes(v.data.answer)) return NextResponse.json({ error: "응답 선택이 올바르지 않습니다." }, { status: 400 });
      const {data:answerTrial}=await db.from("trials").select("status,execution_autonomy").eq("id",v.data.trialId).single();
      if(answerTrial?.status!=="pending"||answerTrial.execution_autonomy!=="human_guided")return NextResponse.json({error:"현재 단계에서는 응답을 수정할 수 없습니다."},{status:409});
      const {data:prior}=await db.from("guided_responses").select("answer_value,revision_count,shown_at").eq("trial_id",v.data.trialId).eq("question_id",q.id).maybeSingle();
      const serverNow=new Date().toISOString();const clientNow=v.data.clientTimestamp??serverNow;const responseTime=Math.max(0,v.data.responseTimeMs??0);const shownAt=prior?.shown_at??new Date(new Date(clientNow).getTime()-responseTime).toISOString();const revisionCount=(prior?.revision_count??0)+(prior&&prior.answer_value!==v.data.answer?1:0);
      const { error } = await db.from("guided_responses").upsert({ trial_id: v.data.trialId, question_id: q.id, question_text: q.text, answer_value: v.data.answer, shown_at: shownAt, answered_at: clientNow,response_time_ms:responseTime,revision_count:revisionCount,confirmed_at:null }, { onConflict: "trial_id,question_id" });
      if (error) throw error;
      await logEvent({ participantId: v.data.participantId, trialId: v.data.trialId, eventType:prior?(prior.answer_value===v.data.answer?"guided_option_selected":"guided_answer_changed"):"guided_option_selected",eventTarget:q.id,eventValue:v.data.answer,payload: { questionId: q.id, answer: v.data.answer,revisionCount }, elapsedMs: responseTime,clientTimestamp:clientNow });
      return NextResponse.json({ ok: true });
    }
    if(input.action==="confirm_guided_answers"){
      const {participantId,trialId}=input;const {data:trial}=await db.from("trials").select("execution_autonomy,status").eq("id",trialId).eq("participant_id",participantId).single();
      if(!trial||trial.status!=="pending"||trial.execution_autonomy!=="human_guided")return NextResponse.json({error:"질문을 확정할 수 없는 단계입니다."},{status:409});
      const {data:responses,error}=await db.from("guided_responses").select("question_id,answer_value,shown_at").eq("trial_id",trialId);if(error)throw error;
      if((responses??[]).length!==3||EXPERIMENT.questions.some(q=>!responses?.some(r=>r.question_id===q.id)))return NextResponse.json({error:"세 질문에 모두 응답해 주세요."},{status:409});
      const now=new Date().toISOString();for(const r of responses??[]){await db.from("guided_responses").update({confirmed_at:now}).eq("trial_id",trialId).eq("question_id",r.question_id);await logEvent({participantId,trialId,eventType:"guided_answer_confirmed",eventTarget:r.question_id,eventValue:r.answer_value,clientTimestamp:now});}
      return NextResponse.json({ok:true});
    }
    if (input.action === "show_candidates") {
      const trialId = String(input.trialId ?? "");
      const { data: trial, error: tErr } = await db.from("trials").select("id,profile_id,participant_id,status,condition_id,execution_autonomy").eq("id", trialId).single();
      if (tErr || !trial) return NextResponse.json({ error: "실험 단계를 찾지 못했습니다." }, { status: 404 });
      if(trial.status!=="pending")return NextResponse.json({error:"이 단계의 후보는 이미 생성되었습니다."},{status:409});
      const profileId = trial.profile_id as keyof typeof CANDIDATES;
      const { data: profile } = await db.from("recipient_profiles").select("*").eq("id", profileId).single();
      const candidateMode = process.env.EXPERIMENT_CANDIDATE_MODE === "live" ? "live" : "controlled";
      const generation = candidateMode === "live" ? await generateLiveCandidates(profile) : null;
      let source:any[] = generation ? generation.candidates : [];
      if(!generation){const pool=CANDIDATES[profileId]??[];let guidedAnswers:string[]|undefined;if(trial.execution_autonomy==="human_guided"){const {data:person}=await db.from("participants").select("role").eq("id",trial.participant_id).single();if(person?.role==="giver"){const {data:responses}=await db.from("guided_responses").select("question_id,answer_value").eq("trial_id",trialId);guidedAnswers=EXPERIMENT.questions.map(q=>responses?.find(r=>r.question_id===q.id)?.answer_value).filter(Boolean) as string[];if(guidedAnswers.length!==3)return NextResponse.json({error:"세 질문에 모두 답한 뒤 진행해 주세요."},{status:409});}}source=selectControlledCandidates(pool,guidedAnswers);}
      const candidateSetId = candidateMode === "live" ? `live-${trialId}` : "set-v1";
      const rows = source.map((c, i) => ({ ...c, profile_id: profileId, candidate_set_id: candidateSetId, version: candidateMode === "live" ? "live-demo-v1" : "candidates-v1", is_mock: false, display_order: i + 1 }));
      const displayedCandidates:any[]=[];
      for (const row of rows) {
        const { data: candidate, error } = await db.from("gift_candidates").upsert({ profile_id: profileId, candidate_set_id: row.candidate_set_id, product_name: row.product_name, category: row.category, price: row.price, description: row.description, fit_reason: row.fit_reason, preference_score: row.preference_score, practicality_score: row.practicality_score, budget_score: row.budget_score, overall_score: row.overall_score, version: row.version, is_mock: false }, { onConflict: "profile_id,candidate_set_id,product_name" }).select("id").single();
        if (error) throw error;
        const { error: linkErr } = await db.from("trial_candidates").upsert({ trial_id: trialId, gift_candidate_id: candidate.id, display_order: row.display_order, is_mock: false }, { onConflict: "trial_id,gift_candidate_id" });
        if (linkErr) throw linkErr;
        displayedCandidates.push({gift_candidate_id:candidate.id,display_order:row.display_order,product_name:row.product_name,overall_score:row.overall_score});
      }
      const {data:person}=await db.from("participants").select("role").eq("id",trial.participant_id).single();
      if(input.scriptedPlayback&&person?.role!=="recipient")return NextResponse.json({error:"관찰 재생에서만 사용할 수 있습니다."},{status:403});
      if(!(person?.role==="recipient"&&input.scriptedPlayback)){await db.from("trials").update({ status: "active" }).eq("id", trialId);}
      if(!(person?.role==="recipient"&&input.scriptedPlayback)){
        await logEvent({participantId:trial.participant_id,trialId,eventType:"system_processing_completed"});
        if(trial.execution_autonomy==="agent_autonomous")await logEvent({participantId:trial.participant_id,trialId,eventType:"autonomous_processing_completed"});
      }
      await logEvent({ participantId: trial.participant_id, trialId, eventType: "candidates_shown", payload: { count: rows.length,scriptedPlayback:Boolean(input.scriptedPlayback) },clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined });
      if(generation)await logEvent({participantId:trial.participant_id,trialId,eventType:"live_candidate_generation_metadata",payload:generation.metadata,elapsedMs:generation.metadata.latency_ms});
      return NextResponse.json({ ok: true,candidates:displayedCandidates });
    }
    if (input.action === "select") {
      const v = finalSelectionSchema.safeParse(input);
      if (!v.success) return NextResponse.json({ error: "선택 정보를 확인해 주세요." }, { status: 400 });
      const { data: trial, error: tErr } = await db.from("trials").select("decision_authority,participant_id,condition_id,status").eq("id", v.data.trialId).eq("participant_id", v.data.participantId).single();
      if (tErr || !trial) return NextResponse.json({ error: "실험 단계를 찾지 못했습니다." }, { status: 404 });
      if (trial.decision_authority !== "human") return NextResponse.json({ error: "이 단계의 최종 선택은 시스템이 진행합니다." }, { status: 403 });
      if(trial.status!=="active"){if(trial.status==="awaiting_survey"||trial.status==="completed")await logEvent({participantId:v.data.participantId,trialId:v.data.trialId,eventType:"duplicate_submission",payload:{action:"human_final_selection"}});return NextResponse.json({error:"현재 단계에서 선택할 수 없습니다."},{status:409});}
      const { data: link } = await db.from("trial_candidates").select("gift_candidate_id").eq("trial_id", v.data.trialId).eq("gift_candidate_id", v.data.candidateId).single();
      if (!link) return NextResponse.json({ error: "후보를 찾을 수 없습니다." }, { status: 400 });
      const { error } = await db.from("final_selections").upsert({ trial_id: v.data.trialId, selected_candidate_id: v.data.candidateId, selected_by: "human" }, { onConflict: "trial_id" });
      if (error) throw error;
      await logEvent({ participantId: v.data.participantId, trialId: v.data.trialId, eventType: "human_final_selection", payload: { candidateId: v.data.candidateId },eventTarget:typeof input.eventTarget==="string"?input.eventTarget:undefined,eventValue:v.data.candidateId,clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined });
      await db.from("trials").update({ status: "awaiting_survey" }).eq("id", v.data.trialId);
      return NextResponse.json({ ok: true });
    }
    if (input.action === "agent_select") {
      const { participantId, trialId } = input;
      const { data: trial, error: tErr } = await db.from("trials").select("decision_authority,participant_id,status").eq("id", trialId).eq("participant_id", participantId).single();
      if (tErr || !trial || trial.decision_authority !== "agent") return NextResponse.json({ error: "이 단계에서 AI 선택을 진행할 수 없습니다." }, { status: 403 });
      if(trial.status!=="active"){if(trial.status==="awaiting_survey"||trial.status==="completed")await logEvent({participantId,trialId,eventType:"duplicate_submission",payload:{action:"agent_final_selection"}});return NextResponse.json({error:"현재 단계에서 선택할 수 없습니다."},{status:409});}
      const { data: picks, error: picksErr } = await db.from("trial_candidates").select("gift_candidate_id,gift_candidates(overall_score)").eq("trial_id", trialId);
      if (picksErr) throw picksErr;
      const best: any = [...(picks ?? [])].sort((a: any, b: any) => Number(b.gift_candidates.overall_score) - Number(a.gift_candidates.overall_score))[0];
      if (!best) return NextResponse.json({ error: "선택 가능한 후보가 없습니다." }, { status: 409 });
      const { error } = await db.from("final_selections").upsert({ trial_id: trialId, selected_candidate_id: best.gift_candidate_id, selected_by: "agent" }, { onConflict: "trial_id" });
      if (error) throw error;
      await db.from("trials").update({ status: "awaiting_survey" }).eq("id", trialId);
      await logEvent({ participantId, trialId, eventType: "agent_final_selection", payload: { candidateId: best.gift_candidate_id },clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined });
      await logEvent({ participantId, trialId, eventType: "system_processing_completed",clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "playback_select") {
      const { participantId, trialId } = input;
      const { data: trial, error: tErr } = await db.from("trials").select("decision_authority,participant_id,status").eq("id", trialId).eq("participant_id", participantId).single();
      const { data: participant } = await db.from("participants").select("role").eq("id", participantId).single();
      if (tErr || !trial || participant?.role !== "recipient") return NextResponse.json({ error: "관찰 재생 단계에서만 수행할 수 있습니다." }, { status: 403 });
      if(trial.status!=="pending"&&trial.status!=="active")return NextResponse.json({error:"재생 선택을 완료할 수 없습니다."},{status:409});
      const { data: picks } = await db.from("trial_candidates").select("gift_candidate_id,gift_candidates(overall_score)").eq("trial_id", trialId);
      const requestedCandidate=typeof input.candidateId==="string"?input.candidateId:null;
      const best: any = requestedCandidate?(picks??[]).find((p:any)=>p.gift_candidate_id===requestedCandidate):[...(picks ?? [])].sort((a: any, b: any) => Number(b.gift_candidates.overall_score) - Number(a.gift_candidates.overall_score))[0];
      if (!best) return NextResponse.json({ error: "선택 가능한 후보가 없습니다." }, { status: 409 });
      const { error } = await db.from("final_selections").upsert({ trial_id: trialId, selected_candidate_id: best.gift_candidate_id, selected_by: trial.decision_authority }, { onConflict: "trial_id" });
      if (error) throw error;
      await db.from("trials").update({ status: "awaiting_survey" }).eq("id", trialId);
      await logEvent({ participantId, trialId, eventType: trial.decision_authority === "human" ? "human_final_selection" : "agent_final_selection", payload: { candidateId: best.gift_candidate_id, scriptedPlayback: true },clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined });
      if(trial.decision_authority==="agent")await logEvent({participantId,trialId,eventType:"system_processing_completed",clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined});
      return NextResponse.json({ ok: true });
    }
    if (input.action === "confirm_survey") {
      const { participantId, trialId } = input;
      const { data: trial } = await db.from("trials").select("decision_authority,participant_id,status,final_selections(id)").eq("id", trialId).eq("participant_id", participantId).single();
      if (!trial) return NextResponse.json({ error: "실험 단계를 찾지 못했습니다." }, { status: 404 });
      if(trial.status!=="awaiting_survey")return NextResponse.json({error:"설문 확인 단계가 아닙니다."},{status:409});
      const existingSelections=Array.isArray(trial.final_selections)?trial.final_selections:trial.final_selections?[trial.final_selections]:[];
      if (!existingSelections.length) return NextResponse.json({ error: "최종 선택 기록이 없습니다." }, { status: 409 });
      await logEvent({ participantId, trialId, eventType: "paper_survey_completed_confirmed",clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined });
      await logEvent({ participantId, trialId, eventType: "trial_completed",clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined });
      await db.from("trials").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", trialId);
      const { count } = await db.from("trials").select("id", { count: "exact", head: true }).eq("participant_id", participantId).neq("status", "completed");
      if (count === 0) {
        await db.from("participants").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", participantId);
        await logEvent({ participantId, eventType: "experiment_completed" });
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });
  } catch (e) { if(input.action==="show_candidates"){try{const {data:t}=await db.from("trials").select("participant_id").eq("id",String(input.trialId??"")).single();if(t)await logEvent({participantId:t.participant_id,trialId:String(input.trialId),eventType:"candidate_generation_failed",payload:{message:e instanceof Error?e.message:"unknown"}});}catch{}}return NextResponse.json({ error: e instanceof Error ? e.message : "저장에 실패했습니다." }, { status: 500 }); }
}
