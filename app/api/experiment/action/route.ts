import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { answerSchema, finalSelectionSchema, eventSchema } from "@/lib/validation/schemas";
import { logEvent } from "@/lib/events";
import { storeTranscriptMessage } from "@/lib/experiment/transcript";
import { EXPERIMENT } from "@/config/experiment";
import { participantSessionMatches } from "@/lib/auth/participant";

async function checkTrialAccess(db:ReturnType<typeof supabaseAdmin>,participantId:string,trialId:string){
  const {count:passed}=await db.from("training_attempts").select("id",{count:"exact",head:true}).eq("participant_id",participantId).eq("passed",true);
  if(!passed)throw new Error("Training not completed.");
  const {data:trials}=await db.from("trials").select("id,status,trial_number,experiment_version").eq("participant_id",participantId).order("trial_number");
  const current=(trials??[]).find(t=>t.status!=="completed");
  if(!current||current.id!==trialId)throw new Error("Trial is not the current participant step.");
  if(current.experiment_version!==EXPERIMENT.version)throw new Error("This trial belongs to an older experiment version.");
}

export async function POST(request: Request) {
  const input = await request.json();
  const db = supabaseAdmin();
  if(["show_candidates","playback_select","agent_select"].includes(input.action))return NextResponse.json({error:"이전 직접 실행 경로는 종료되었습니다. 서버가 현재 단계와 권한에 따라 진행합니다."},{status:410});
  if(!await participantSessionMatches(String(input.participantId??"")))return NextResponse.json({error:"참가자 세션이 만료되었습니다."},{status:401});
  if(input.trialId&&input.action!=="confirm_survey")try{await checkTrialAccess(db,String(input.participantId??""),String(input.trialId));}catch{return NextResponse.json({error:"연습을 완료한 뒤 현재 단계에서 진행해 주세요."},{status:403});}
  try {
    if (input.action === "event") {
      const v = eventSchema.safeParse(input);
      if (!v.success) return NextResponse.json({ error: "이벤트 정보를 확인해 주세요." }, { status: 400 });
      const serverOwnedEvents=new Set(["phase_entered","content_ready","phase_exposure_satisfied","phase_exited","candidate_shown","candidates_shown","comparison_shown","user_task_requested","agent_task_started","agent_task_completed","human_final_selection","agent_final_selection","message_rendered","human_selection_screen_shown","paper_survey_prompt_shown","paper_survey_completed_confirmed","trial_completed"]);
      if(serverOwnedEvents.has(v.data.eventType))return NextResponse.json({error:"이 이벤트는 서버가 실제 단계 전이에 따라 기록합니다."},{status:403});
      const allowed=new Set(["page_hidden","page_visible","page_refreshed","connection_lost","connection_restored","error_occurred","retry","duplicate_rejected","candidate_opened","candidate_closed","candidate_reopened","candidate_revisited","candidate_detail_viewed","comparison_interacted","human_candidate_selected","human_candidate_changed","observation_started"]);
      if(!allowed.has(v.data.eventType))return NextResponse.json({error:"지원하지 않는 이벤트입니다."},{status:400});
      if(["human_candidate_selected","human_candidate_changed"].includes(v.data.eventType)) {
        const [{data:choiceTrial},{data:choiceParticipant}]=await Promise.all([
          db.from("trials").select("decision_authority,current_phase,status").eq("id",v.data.trialId).eq("participant_id",v.data.participantId).single(),
          db.from("participants").select("role").eq("id",v.data.participantId).single(),
        ]);
        if(choiceParticipant?.role!=="giver"||choiceTrial?.decision_authority!=="human"||choiceTrial?.current_phase!=="decision"||choiceTrial?.status!=="active")return NextResponse.json({error:"현재 조건에서는 사람의 최종 선택을 기록할 수 없습니다."},{status:403});
      }
      if(v.data.trialId&&["candidate_opened","candidate_closed","candidate_reopened","candidate_detail_viewed","human_candidate_selected","human_candidate_changed"].includes(v.data.eventType)){
        if(!v.data.eventValue)return NextResponse.json({error:"후보 식별자가 필요합니다."},{status:400});
        const {data:link}=await db.from("trial_candidates").select("gift_candidate_id").eq("trial_id",v.data.trialId).eq("gift_candidate_id",v.data.eventValue).maybeSingle();
        if(!link)return NextResponse.json({error:"현재 trial의 후보가 아닙니다."},{status:403});
      }
      if(v.data.eventType==="observation_started"){
        const {data:observer}=await db.from("participants").select("role").eq("id",v.data.participantId).single();
        if(observer?.role!=="recipient"||!v.data.trialId)return NextResponse.json({error:"관찰 시작 이벤트가 올바르지 않습니다."},{status:403});
      }
      await logEvent({ participantId: v.data.participantId, trialId: v.data.trialId, eventType: v.data.eventType, payload: v.data.payload, eventTarget:v.data.eventTarget,eventValue:v.data.eventValue,clientTimestamp:v.data.clientTimestamp,idempotencyKey:v.data.idempotencyKey?`client:${v.data.idempotencyKey}`:undefined });
      return NextResponse.json({ ok: true });
    }
    if(input.action==="withdraw"){
      const {data:person}=await db.from("participants").select("status").eq("id",input.participantId).single();
      if(!person)return NextResponse.json({error:"참가자 정보를 찾지 못했습니다."},{status:404});
      if(person.status!=="withdrawn"){
        const {error}=await db.from("participants").update({status:"withdrawn"}).eq("id",input.participantId);
        if(error)throw error;
        await logEvent({participantId:input.participantId,trialId:input.trialId,eventType:"research_withdrawn",actorType:"participant",eventOrigin:"participant",idempotencyKey:"withdraw:"+input.participantId});
      }
      return NextResponse.json({ok:true});
    }
    if (input.action === "answer") {
      const v = answerSchema.safeParse(input);
      if (!v.success || !v.data.trialId) return NextResponse.json({ error: "응답을 확인해 주세요." }, { status: 400 });
      const q = EXPERIMENT.questions.find(x => x.id === v.data.questionId);
      if (!q || !(q.options as readonly string[]).includes(v.data.answer)) return NextResponse.json({ error: "응답 선택이 올바르지 않습니다." }, { status: 400 });
      const {data:answerTrial}=await db.from("trials").select("status,current_phase,execution_autonomy,participant_id").eq("id",v.data.trialId).eq("participant_id",v.data.participantId).single();
      const {data:answerParticipant}=await db.from("participants").select("role").eq("id",v.data.participantId).single();
      if(answerTrial?.status!=="pending"||answerTrial.current_phase!=="criteria"||answerTrial.execution_autonomy!=="human_guided"||answerParticipant?.role!=="giver")return NextResponse.json({error:"현재 단계에서는 응답을 수정할 수 없습니다."},{status:409});
      const {data:shownEvent}=await db.from("event_logs").select("server_timestamp").eq("trial_id",v.data.trialId).eq("event_type","guided_question_shown").eq("event_target",q.id).order("server_timestamp").limit(1).maybeSingle();
      if(!shownEvent?.server_timestamp)return NextResponse.json({error:"질문이 표시된 뒤 응답해 주세요."},{status:409});
      const {data:prior}=await db.from("guided_responses").select("answer_value,revision_count,shown_at").eq("trial_id",v.data.trialId).eq("question_id",q.id).maybeSingle();
      const serverNow=new Date().toISOString();const responseTime=Math.max(0,Date.now()-new Date(shownEvent.server_timestamp).getTime());const shownAt=prior?.shown_at??shownEvent.server_timestamp;const revisionCount=(prior?.revision_count??0)+(prior&&prior.answer_value!==v.data.answer?1:0);
      const { error } = await db.from("guided_responses").upsert({ trial_id: v.data.trialId, question_id: q.id, question_text: q.text, answer_value: v.data.answer, shown_at: shownAt, answered_at: serverNow,response_time_ms:responseTime,revision_count:revisionCount,confirmed_at:null }, { onConflict: "trial_id,question_id" });
      if (error) throw error;
      await logEvent({ participantId: v.data.participantId, trialId: v.data.trialId, eventType:prior?(prior.answer_value===v.data.answer?"guided_option_selected":"guided_answer_changed"):"guided_option_selected",eventTarget:q.id,eventValue:v.data.answer,payload: { questionId: q.id, answer: v.data.answer,revisionCount }, elapsedMs: responseTime,phase:"criteria",actorType:"participant" });
      return NextResponse.json({ ok: true });
    }
    if(input.action==="confirm_guided_answers"){
      const {participantId,trialId}=input;const {data:trial}=await db.from("trials").select("execution_autonomy,status,current_phase").eq("id",trialId).eq("participant_id",participantId).single();
      const {data:person}=await db.from("participants").select("role").eq("id",participantId).single();
      if(!trial||trial.status!=="pending"||trial.current_phase!=="criteria"||trial.execution_autonomy!=="human_guided"||person?.role!=="giver")return NextResponse.json({error:"질문을 확정할 수 없는 단계입니다."},{status:409});
      const {data:responses,error}=await db.from("guided_responses").select("question_id,answer_value,shown_at").eq("trial_id",trialId);if(error)throw error;
      if((responses??[]).length!==3||EXPERIMENT.questions.some(q=>!responses?.some(r=>r.question_id===q.id)))return NextResponse.json({error:"세 질문에 모두 응답해 주세요."},{status:409});
      const now=new Date().toISOString();for(const r of responses??[]){const {error:updateError}=await db.from("guided_responses").update({confirmed_at:now}).eq("trial_id",trialId).eq("question_id",r.question_id);if(updateError)throw updateError;await logEvent({participantId,trialId,eventType:"guided_answer_confirmed",eventTarget:r.question_id,eventValue:r.answer_value,phase:"criteria",actorType:"participant",idempotencyKey:`guided-answer-confirmed:${trialId}:${r.question_id}`});}
      return NextResponse.json({ok:true});
    }
    if (input.action === "select") {
      const v = finalSelectionSchema.safeParse(input);
      if (!v.success) return NextResponse.json({ error: "선택 정보를 확인해 주세요." }, { status: 400 });
      const { data: trial, error: tErr } = await db.from("trials").select("decision_authority,participant_id,condition_id,status,current_phase").eq("id", v.data.trialId).eq("participant_id", v.data.participantId).single();
      if (tErr || !trial) return NextResponse.json({ error: "실험 단계를 찾지 못했습니다." }, { status: 404 });
      if (trial.decision_authority !== "human") return NextResponse.json({ error: "이 단계의 최종 선택은 시스템이 진행합니다." }, { status: 403 });
      const {data:person}=await db.from("participants").select("role").eq("id",v.data.participantId).single();
      if(person?.role!=="giver")return NextResponse.json({error:"관찰 모드에서는 실제 선택을 입력할 수 없습니다."},{status:403});
      const retryingSameFinalChoice=trial.status==="awaiting_survey"&&trial.current_phase==="awaiting_survey";
      if(!retryingSameFinalChoice&&(trial.status!=="active"||trial.current_phase!=="decision"))return NextResponse.json({error:"비교 내용을 최소 30초 확인한 뒤 최종 선택해 주세요."},{status:409});
      const { data: link,error:linkError } = await db.from("trial_candidates").select("gift_candidate_id,product_snapshot").eq("trial_id", v.data.trialId).eq("gift_candidate_id", v.data.candidateId).maybeSingle();
      if(linkError)throw linkError;
      if (!link) return NextResponse.json({ error: "후보를 찾을 수 없습니다." }, { status: 400 });
      const { error } = await db.rpc("finalize_trial_selection",{p_trial_id:v.data.trialId,p_participant_id:v.data.participantId,p_candidate_id:v.data.candidateId,p_actor:"human",p_is_simulated:false});
      if (error) throw error;
      const selected = link.product_snapshot ?? {};
      await logEvent({ participantId: v.data.participantId, trialId: v.data.trialId, eventType: "human_final_selection",phase:"decision",actorType:"participant",payload: { candidateId: v.data.candidateId },eventTarget:typeof input.eventTarget==="string"?input.eventTarget:undefined,eventValue:v.data.candidateId,idempotencyKey:"human-final-selection:"+v.data.trialId });
      await storeTranscriptMessage(db,{trialId:v.data.trialId,phase:"decision",actorType:"participant",messageType:"decision",content:`선물 주는 사람이 선택한 최종 선물: ${selected?.product_name??"선물 후보"}`,payload:{candidateId:v.data.candidateId,productSnapshot:selected??{}},idempotencyKey:"final-decision-v2",eventOrigin:"participant"});
      await storeTranscriptMessage(db,{trialId:v.data.trialId,phase:"awaiting_survey",actorType:"system",messageType:"text",content:"연구자에게 받은 종이 설문에 응답해 주세요. 심리척도와 주관적 평가는 웹에서 입력하지 않습니다. 종이 설문을 작성한 뒤 완료를 확인해 주세요.",payload:{paperSurveyTimeExcluded:true},idempotencyKey:"paper-survey-prompt-v2"});
      return NextResponse.json({ ok: true });
    }
    if (input.action === "confirm_survey") {
      const { participantId, trialId } = input;
      const { data: trial, error: trialError } = await db.from("trials").select("decision_authority,participant_id,status,current_phase,final_selections(id)").eq("id", trialId).eq("participant_id", participantId).single();
      if (trialError) throw trialError;
      if (!trial) return NextResponse.json({ error: "실험 단계를 찾지 못했습니다." }, { status: 404 });
      if(trial.status!=="awaiting_survey"&&trial.status!=="completed")return NextResponse.json({error:"설문 확인 단계가 아닙니다."},{status:409});
      const existingSelections=Array.isArray(trial.final_selections)?trial.final_selections:trial.final_selections?[trial.final_selections]:[];
      if (!existingSelections.length) return NextResponse.json({ error: "최종 선택 기록이 없습니다." }, { status: 409 });
      const {data:visibleResult,error:resultError}=await db.from("trial_messages").select("id,rendered_at").eq("trial_id",trialId).eq("idempotency_key","final-decision-v2").maybeSingle();
      if(resultError)throw resultError;
      if(!visibleResult?.rendered_at)return NextResponse.json({error:"최종 선물 결과를 화면에서 확인한 뒤 종이 설문 완료를 표시해 주세요."},{status:409});
      if(trial.status==="awaiting_survey"){
        const {data:completed,error:completeError}=await db.from("trials").update({status:"completed",current_phase:"completed",completed_at:new Date().toISOString()}).eq("id",trialId).eq("status","awaiting_survey").eq("current_phase","awaiting_survey").select("id").maybeSingle();
        if(completeError)throw completeError;
        if(!completed){
          const {data:latest,error:latestError}=await db.from("trials").select("status").eq("id",trialId).single();
          if(latestError)throw latestError;
          if(latest?.status!=="completed")return NextResponse.json({error:"설문 확인 단계가 갱신되었습니다. 화면을 다시 불러와 주세요."},{status:409});
        }
      }
      await logEvent({ participantId, trialId, eventType: "paper_survey_completed_confirmed",clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined,idempotencyKey:"paper-survey-completed:"+trialId });
      await logEvent({ participantId, trialId, eventType: "trial_completed",clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined,idempotencyKey:"trial-completed:"+trialId });
      const { count, error:countError } = await db.from("trials").select("id", { count: "exact", head: true }).eq("participant_id", participantId).neq("status", "completed");
      if(countError)throw countError;
      if (count === 0) {
        const {error:participantError}=await db.from("participants").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", participantId);
        if(participantError)throw participantError;
        await logEvent({ participantId,trialId,eventType: "experiment_completed",idempotencyKey:"experiment-completed:"+participantId });
      }
      return NextResponse.json({ ok: true,idempotent:trial.status==="completed" });
    }
    return NextResponse.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "저장에 실패했습니다." }, { status: 500 }); }
}
