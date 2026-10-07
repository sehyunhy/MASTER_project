import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { participantSessionMatches } from "@/lib/auth/participant";
import { logEvent } from "@/lib/events";
import { generateTrialCandidates } from "@/lib/catalog/generateTrialCandidates";
import { comparisonSummary, buildComparison, storeTranscriptMessage } from "@/lib/experiment/transcript";
import { EXPERIMENT } from "@/config/experiment";
import { composeCandidateIntroduction, chooseFinalProductWithClaude } from "@/lib/agent/claude";

const PHASES = new Set(["criteria","candidates","comparison"]);
function responseForError(error: any) {
  const message=String(error?.message??error);
  const shortage=message.includes("Not enough active catalog products")||message.includes("적합한 실제 상품")||message.includes("APPROVED_STIMULUS_REQUIRED");
  const status=shortage?409:message.includes("ANOTHER_TAB_ACTIVE")?409:message.includes("MIN_EXPOSURE_NOT_MET")?409:message.includes("ACTOR_NOT_ALLOWED")?403:message.includes("PHASE_MISMATCH")?409:message.includes("CONTENT_NOT_ACTIVE")?409:500;
  const publicMessage=message.includes("MIN_EXPOSURE_NOT_MET")?"이 단계 내용을 최소 30초 동안 확인한 뒤 진행할 수 있습니다."
    :message.includes("ANOTHER_TAB_ACTIVE")?"다른 탭에서 연구가 진행 중입니다. 그 탭으로 돌아가 주세요."
    :message.includes("PHASE_MISMATCH")?"현재 연구 단계가 갱신되었습니다. 최신 상태를 불러옵니다."
    :message.includes("ACTOR_NOT_ALLOWED")?"이 단계에서는 해당 작업을 진행할 수 없습니다."
    :message.includes("CANDIDATES_NOT_READY")?"상품 후보를 준비하지 못했습니다. 다시 시도해 주세요."
    :message.includes("CONTENT_NOT_READY")?"화면 내용을 표시한 뒤 다시 시도해 주세요."
    :message.includes("CONTENT_NOT_ACTIVE")?"화면 연결을 확인해 주세요. 화면이 활성 상태일 때 다시 진행할 수 있습니다."
    :shortage?"이 프로필의 검토된 실제 상품 또는 동결된 관찰 자극이 부족합니다. 연구자가 상품 자료를 보완해야 합니다."
    :"연구 단계를 저장하지 못했습니다.";
  return NextResponse.json({error:publicMessage,code:message.split(" ")[0]},{status});
}

async function contextFor(participantId:string,trialId:string) {
  if(!await participantSessionMatches(participantId))throw Object.assign(new Error("SESSION_EXPIRED"),{status:401});
  const db=supabaseAdmin();
  const [{data:participant,error:pError},{data:trial,error:tError},{count:passed,error:trainingError}] = await Promise.all([
    db.from("participants").select("id,participant_code,role,intimacy_condition,sequence_id,is_mock").eq("id",participantId).single(),
    db.from("trials").select("id,participant_id,trial_number,profile_id,condition_id,execution_autonomy,decision_authority,status,current_phase,experiment_version").eq("id",trialId).eq("participant_id",participantId).single(),
    db.from("training_attempts").select("id",{count:"exact",head:true}).eq("participant_id",participantId).eq("passed",true),
  ]);
  if(pError||tError||trainingError||!participant||!trial)throw new Error("PARTICIPANT_OR_TRIAL_NOT_FOUND");
  if(trial.experiment_version!==EXPERIMENT.version)throw Object.assign(new Error("OLD_EXPERIMENT_VERSION"),{status:409});
  if(!passed)throw Object.assign(new Error("TRAINING_REQUIRED"),{status:403});
  const {data:trials,error:trialsError}=await db.from("trials").select("id,status").eq("participant_id",participantId).order("trial_number");
  if(trialsError)throw trialsError;
  const current=(trials??[]).find((row:any)=>row.status!=="completed");
  if(!current||current.id!==trialId)throw Object.assign(new Error("NOT_CURRENT_TRIAL"),{status:409});
  return {db,participant,trial};
}

async function saveEvent(context:any,eventType:string,phase:string,actorType:"participant"|"agent"|"system"|"simulated_giver",payload:Record<string,unknown>={},effectiveExposureMs?:number,messageId?:string,idempotencyKey?:string) {
  const taskId=typeof payload.taskId==="string"?payload.taskId:undefined;
  const stableEvents=new Set(["phase_entered","content_ready","trial_started","profile_shown","phase_exposure_satisfied","phase_exited","candidate_shown","comparison_shown","human_selection_screen_shown","paper_survey_prompt_shown"]);
  const eventKey=idempotencyKey??(taskId?phase+":"+eventType+":"+taskId:typeof payload.questionId==="string"?phase+":"+eventType+":"+payload.questionId:stableEvents.has(eventType)?phase+":"+eventType:undefined);
  await logEvent({participantId:context.participant.id,trialId:context.trial.id,eventType,phase,actorType,
    simulatedActorEvent:actorType==="simulated_giver",payload,effectiveExposureMs,taskId,messageId,
    idempotencyKey:eventKey});
}

export async function POST(request:Request) {
  let body:any;
  try { body=await request.json(); } catch { return NextResponse.json({error:"요청 형식을 확인해 주세요."},{status:400}); }
  if(typeof body.participantId!=="string"||typeof body.trialId!=="string"||typeof body.action!=="string")return NextResponse.json({error:"참가자·trial 정보를 확인해 주세요."},{status:400});
  try {
    const context=await contextFor(body.participantId,body.trialId); const {db,trial,participant}=context;
    if(body.action==="retry_generation") {
      if(trial.current_phase!=="candidates")return NextResponse.json({error:"후보 생성 단계가 아닙니다."},{status:409});
      const {count,error:countError}=await db.from("trial_candidates").select("id",{count:"exact",head:true}).eq("trial_id",trial.id);
      if(countError)throw countError;
      const {data:existingMessage}=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("idempotency_key","catalog-candidates-v2").maybeSingle();
      if((count??0)<3||!existingMessage) {
        await saveEvent(context,"retry","candidates","system",{operation:"generate_missing_catalog_candidates",existingCandidateCount:count??0},undefined,undefined,"candidate-generation-retry:"+trial.id+":"+randomUUID());
        const generated=await generateTrialCandidates(db,trial.id);
        if(!existingMessage){
          const intro=participant.role==="recipient"?generated.stimulus?.transcript?.candidate_agent:await composeCandidateIntroduction(generated.candidates);
          await storeTranscriptMessage(db,{trialId:trial.id,phase:"candidates",actorType:"agent",messageType:"product_cards",content:intro??"세 후보를 표시합니다.",payload:{candidates:generated.candidates},idempotencyKey:"catalog-candidates-v2",eventOrigin:participant.role==="recipient"?generated.stimulus?.source_kind:"system",transcriptId:generated.stimulus?.id,stimulusVersion:generated.stimulus?.version});
        }
        const {data:prior}=await db.from("event_logs").select("id").eq("trial_id",trial.id).eq("event_type","agent_task_completed").eq("task_id","compose_candidates").limit(1).maybeSingle();
        if(!prior)await saveEvent(context,"agent_task_completed","candidates","agent",{taskId:"compose_candidates",candidateCount:generated.candidates.length,candidateSetId:generated.candidateSetId,recovered:true});
      }
      return NextResponse.json({ok:true});
    }
    if(body.action==="ready") {
      if(!PHASES.has(body.phase)||typeof body.tabId!=="string")return NextResponse.json({error:"노출 단계 정보를 확인해 주세요."},{status:400});
      const prior=await db.from("trial_phase_exposures").select("content_ready_at,accumulated_ms").eq("trial_id",trial.id).eq("phase",body.phase).maybeSingle();
      const {data,error}=await db.rpc("phase_content_ready",{p_trial_id:trial.id,p_phase:body.phase,p_tab_id:body.tabId});
      if(error)throw error;
      if(!prior.data?.content_ready_at){
        await saveEvent(context,"phase_entered",body.phase,"system",{contentReady:true});
        await saveEvent(context,"content_ready",body.phase,"system",{source:"client_post_render_ack"});
        if(body.phase==="criteria")await saveEvent(context,"trial_started","criteria","system",{source:"first_content_ready"});
        if(body.phase==="criteria")await saveEvent(context,"profile_shown","criteria","system",{profileId:trial.profile_id});
      }
      return NextResponse.json(data);
    }
    if(body.action==="heartbeat") {
      if(!PHASES.has(body.phase)||typeof body.tabId!=="string"||!Number.isSafeInteger(body.sequence)||body.sequence<0)return NextResponse.json({error:"노출시간 신호를 확인해 주세요."},{status:400});
      const isActive=body.active===true;
      const {data,error}=await db.rpc("phase_heartbeat",{p_trial_id:trial.id,p_phase:body.phase,p_tab_id:body.tabId,p_sequence:body.sequence,p_active:isActive});
      if(error)throw error;
      if(body.wasActive===true&&!isActive)await saveEvent(context,"exposure_paused",body.phase,"system",{reason:body.reason??"inactive"});
      if(body.wasActive===false&&isActive)await saveEvent(context,"exposure_resumed",body.phase,"system");
      return NextResponse.json({...data,phase:body.phase});
    }
    if(body.action==="message_rendered") {
      if(typeof body.messageId!=="string")return NextResponse.json({error:"표시된 메시지 정보를 확인해 주세요."},{status:400});
      const {data:message,error}=await db.from("trial_messages").select("id,phase,actor_type,message_type,rendered_at,simulated_actor_event").eq("id",body.messageId).eq("trial_id",trial.id).single();
      if(error||!message)return NextResponse.json({error:"표시할 메시지를 찾지 못했습니다."},{status:404});
      const phaseIsCurrent=PHASES.has(message.phase)&&trial.current_phase===message.phase;
      const decisionIsVisible=message.phase==="decision"&&(trial.current_phase==="decision"||trial.current_phase==="awaiting_survey");
      const surveyIsCurrent=message.phase==="awaiting_survey"&&trial.current_phase==="awaiting_survey";
      if(!phaseIsCurrent&&!decisionIsVisible&&!surveyIsCurrent)return NextResponse.json({error:"현재 단계에 표시할 메시지가 아닙니다."},{status:409});
      if(!message.rendered_at){
        await db.from("trial_messages").update({rendered_at:new Date().toISOString()}).eq("id",message.id).is("rendered_at",null);
        await saveEvent(context,"message_rendered",message.phase,message.actor_type,{messageId:message.id,messageType:message.message_type,simulatedActorEvent:message.simulated_actor_event},undefined,message.id,"message-rendered:"+message.id);
        if(message.message_type==="product_cards"){
          await saveEvent(context,"candidate_shown",message.phase,"agent",{messageId:message.id},undefined,message.id,"candidate-shown:"+message.id);
          await saveEvent(context,"recommendation_rendered",message.phase,"agent",{messageId:message.id},undefined,message.id,"recommendation-rendered:"+message.id);
        }
        if(message.message_type==="comparison"){
          await saveEvent(context,"comparison_shown",message.phase,"agent",{messageId:message.id},undefined,message.id,"comparison-shown:"+message.id);
          await saveEvent(context,"comparison_rendered",message.phase,"agent",{messageId:message.id},undefined,message.id,"comparison-rendered:"+message.id);
        }
        if(message.message_type==="decision"&&message.phase==="decision"&&participant.role==="giver"&&trial.current_phase==="decision"&&trial.decision_authority==="human")await saveEvent(context,"human_selection_screen_shown","decision","system",{messageId:message.id},undefined,message.id,"human-decision-screen:"+message.id);
        if(message.phase==="awaiting_survey"&&message.message_type==="text")await saveEvent(context,"paper_survey_prompt_shown","awaiting_survey","system",{paperSurveyTimeExcluded:true},undefined,message.id,"paper-survey-prompt:"+message.id);
      }
      return NextResponse.json({ok:true,renderedAt:message.rendered_at});
    }
    if(body.action==="question_rendered") {
      const question=EXPERIMENT.questions.find(q=>q.id===body.questionId);
      if(!question||participant.role!=="giver"||trial.current_phase!=="criteria"||trial.execution_autonomy!=="human_guided")return NextResponse.json({error:"현재 단계에서 표시할 질문이 아닙니다."},{status:409});
      const {data:prior}=await db.from("event_logs").select("id").eq("trial_id",trial.id).eq("event_type","guided_question_shown").eq("event_target",question.id).limit(1).maybeSingle();
      if(!prior)await saveEvent(context,"guided_question_shown","criteria","system",{questionId:question.id});
      return NextResponse.json({ok:true});
    }
    if(body.action==="advance") {
      if(trial.current_phase==="awaiting_survey"||trial.current_phase==="completed")return NextResponse.json({phase:trial.current_phase,idempotent:true});
      const phase=String(trial.current_phase);
      if(!["criteria","candidates","comparison"].includes(phase))return NextResponse.json({error:"현재 단계에서는 진행할 수 없습니다."},{status:409});
      const guided=trial.execution_autonomy==="human_guided"; const humanDecision=trial.decision_authority==="human"; const observing=participant.role==="recipient";
      let stimulus:any=null;
      if(observing){
        const {data:trialStimulus}=await db.from("trials").select("stimulus_id,scenario_id").eq("id",trial.id).single();
        const query=db.from("recipient_stimuli").select("*").eq("review_status","approved");
        const result=trialStimulus?.stimulus_id?await query.eq("id",trialStimulus.stimulus_id).single():await query.eq("scenario_id",trialStimulus?.scenario_id).order("version",{ascending:false}).limit(1).maybeSingle();
        if(result.error||!result.data?.frozen_at)throw new Error("APPROVED_STIMULUS_REQUIRED");
        stimulus=result.data;
      }
      if(phase==="criteria"&&participant.role==="giver") {
        const {data:searchState,error:stateError}=await db.from("trial_search_states").select("query_text,selected_category,preference_tags,selection_priorities").eq("trial_id",trial.id).maybeSingle();
        if(stateError)throw stateError;
        if(!searchState||(!searchState.query_text&&!searchState.selected_category&&!searchState.preference_tags?.length&&!searchState.selection_priorities?.length))return NextResponse.json({error:"대화나 선택 메뉴로 선물 기준을 먼저 입력해 주세요."},{status:409});
      }
      let actor:"human_request"|"agent"|"simulated_giver"|"human";
      if(phase==="criteria"||phase==="candidates") {
        if(observing) actor=guided?"simulated_giver":"agent";
        else if(guided){if(body.requested!==true)return NextResponse.json({error:"요청 버튼으로 다음 과업을 시작해 주세요."},{status:403});actor="human_request";}
        else {if(body.requested===true)return NextResponse.json({error:"이 조건에서는 AI가 다음 단계를 진행합니다."},{status:403});actor="agent";}
      } else {
        actor=observing?(humanDecision?"simulated_giver":"agent"):(humanDecision?"human":"agent");
      }
      if(typeof body.tabId!=="string")return NextResponse.json({error:"화면 세션을 확인할 수 없습니다."},{status:400});
      const {data:transition,error:transitionError}=await db.rpc("advance_trial_phase",{p_trial_id:trial.id,p_expected_phase:phase,p_actor:actor,p_tab_id:body.tabId});
      if(transitionError)throw transitionError;
      if(transition?.idempotent)return NextResponse.json({...transition});
        const {data:exposure}=await db.from("trial_phase_exposures").select("accumulated_ms").eq("trial_id",trial.id).eq("phase",phase).maybeSingle();
        await saveEvent(context,"phase_exposure_satisfied",phase,"system",{accumulatedMs:exposure?.accumulated_ms??EXPERIMENT.minimumPhaseExposureMs},exposure?.accumulated_ms??EXPERIMENT.minimumPhaseExposureMs);
      await saveEvent(context,"phase_exited",phase,"system");

      if(phase==="criteria") {
        const eventType=actor==="human_request"?"user_task_requested":actor==="simulated_giver"?"simulated_actor_event":"agent_task_started";
        await saveEvent(context,eventType,phase,actor==="human_request"?"participant":actor==="simulated_giver"?"simulated_giver":"agent",{taskId:"compose_candidates",requestedBy:actor});
        await saveEvent(context,"agent_task_started","criteria","agent",{taskId:"compose_candidates"});
        const {data:priorSearchRequest}=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("phase",phase).eq("actor_type","participant").contains("payload",{intent:"search_request"}).limit(1).maybeSingle();
        if((actor==="human_request"&&!priorSearchRequest)||actor==="simulated_giver")await storeTranscriptMessage(db,{trialId:trial.id,phase,actorType:actor==="simulated_giver"?"simulated_giver":"participant",messageType:"task_request",content:stimulus?.transcript?.request_candidates??"이 기준으로 후보를 찾아주세요.",idempotencyKey:"request-candidates",simulatedActorEvent:actor==="simulated_giver",eventOrigin:observing?stimulus.source_kind:"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
        if(actor==="agent")await storeTranscriptMessage(db,{trialId:trial.id,phase,actorType:"agent",messageType:"text",content:stimulus?.transcript?.criteria_agent??"제공된 기준을 확인했습니다. 후보 구성을 이어가겠습니다.",idempotencyKey:"agent-criteria-summary",eventOrigin:observing?stimulus.source_kind:"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
        await saveEvent(context,"search_started","criteria","agent",{datasetVersion:EXPERIMENT.candidateVersion});
        let generated;
        try{generated=await generateTrialCandidates(db,trial.id);}catch(e){
          await saveEvent(context,"search_no_results","candidates","agent",{reason:(e as Error).message,datasetVersion:EXPERIMENT.candidateVersion});
          throw e;
        }
        await saveEvent(context,"search_completed","candidates","agent",{candidateCount:generated.candidates.length,candidateSetId:generated.candidateSetId});
        await saveEvent(context,"candidate_set_changed","candidates","agent",{candidateSetId:generated.candidateSetId,candidateSetHash:generated.candidateSetHash,stimulusVersion:stimulus?.version??1},undefined,undefined,"candidate-set:"+trial.id);
        await saveEvent(context,"agent_task_completed","candidates","agent",{taskId:"compose_candidates",candidateCount:generated.candidates.length,candidateSetId:generated.candidateSetId});
        let intro:string;
        try{intro=observing?stimulus.transcript.candidate_agent:await composeCandidateIntroduction(generated.candidates);}
        catch(e){await saveEvent(context,(e as Error).message.includes("DB 후보 이외")?"invalid_product_rejected":"error_occurred","candidates","agent",{reason:(e as Error).message});throw e;}
        if(!observing){await saveEvent(context,"tool_called","candidates","agent",{tool:"present_recommendation"});await saveEvent(context,"tool_result_returned","candidates","agent",{tool:"present_recommendation"});}
        await storeTranscriptMessage(db,{trialId:trial.id,phase:"candidates",actorType:"agent",messageType:"product_cards",content:intro,payload:{candidates:generated.candidates,candidateSetHash:generated.candidateSetHash},idempotencyKey:"catalog-candidates-v2",eventOrigin:observing?stimulus.source_kind:"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
      } else if(phase==="candidates") {
        const eventType=actor==="human_request"?"user_task_requested":actor==="simulated_giver"?"simulated_actor_event":"agent_task_started";
        await saveEvent(context,eventType,phase,actor==="human_request"?"participant":actor==="simulated_giver"?"simulated_giver":"agent",{taskId:"compare_candidates",requestedBy:actor});
        await saveEvent(context,"agent_task_started","candidates","agent",{taskId:"compare_candidates"});
        const {data:priorCompareRequest}=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("phase",phase).eq("actor_type","participant").contains("payload",{intent:"compare_request"}).limit(1).maybeSingle();
        if((actor==="human_request"&&!priorCompareRequest)||actor==="simulated_giver")await storeTranscriptMessage(db,{trialId:trial.id,phase,actorType:actor==="simulated_giver"?"simulated_giver":"participant",messageType:"task_request",content:stimulus?.transcript?.request_comparison??"세 후보의 차이를 비교해주세요.",idempotencyKey:"request-comparison",simulatedActorEvent:actor==="simulated_giver",eventOrigin:observing?stimulus.source_kind:"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
        const {data:candidates,error:candidateError}=await db.from("trial_candidates").select("display_order,product_snapshot,gift_candidates(product_name,price)").eq("trial_id",trial.id).order("display_order");
        if(candidateError)throw candidateError;
        const comparison=buildComparison(candidates??[]);
        const summary=observing?stimulus.transcript.comparison_agent:comparisonSummary(comparison);
        await saveEvent(context,"agent_task_completed","comparison","agent",{taskId:"compare_candidates"});
        await storeTranscriptMessage(db,{trialId:trial.id,phase:"comparison",actorType:"agent",messageType:"comparison",content:summary,payload:{rows:comparison,criteria:["가격","규격","사용 상황","장점","한계","관리 방식"]},idempotencyKey:"comparison-v2",eventOrigin:observing?stimulus.source_kind:"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
      } else {
        const eventActor=actor==="human"?"participant":actor;
        await saveEvent(context,"phase_entered","decision","system",{decisionAuthority:trial.decision_authority});
        if(humanDecision&&!observing) {
          await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"agent",messageType:"decision",content:"비교를 마쳤습니다. 최종 선물은 직접 선택해 주세요.",idempotencyKey:"human-decision-handoff"});
          return NextResponse.json({...transition,phase:"decision",decisionAuthority:"human"});
        }
        await saveEvent(context,"agent_selection_started","decision","agent",{taskId:"final_decision"});
        await saveEvent(context,"agent_task_started","decision","agent",{taskId:"final_decision"});
        const {data:picks,error:picksError}=await db.from("trial_candidates").select("gift_candidate_id,display_order,product_snapshot").eq("trial_id",trial.id).order("display_order");
        if(picksError)throw picksError;
        if(!picks?.length)throw new Error("CANDIDATES_NOT_READY");
        let chosen:any;
        let finalReasonFocus:string|undefined;
        if(observing){
          chosen=picks.find((pick:any)=>pick.product_snapshot?.source_product_id===stimulus.final_source_product_id);
        }else{
          await saveEvent(context,"tool_called","decision","agent",{tool:"choose_final_product",candidateCount:picks.length});
          try{
            const choice=await chooseFinalProductWithClaude(picks);
            chosen=picks.find((pick:any)=>pick.product_snapshot?.source_product_id===choice.sourceProductId);
            finalReasonFocus=choice.reasonFocus;
            await saveEvent(context,"tool_result_returned","decision","agent",{tool:"choose_final_product",sourceProductId:choice.sourceProductId,model:choice.model,reasonFocus:choice.reasonFocus});
          }catch(error){
            await saveEvent(context,(error as Error).message==="AI_FINAL_PRODUCT_NOT_IN_TRIAL"?"invalid_product_rejected":"error_occurred","decision","agent",{tool:"choose_final_product",reason:(error as Error).message});
            throw error;
          }
        }
        if(!chosen)throw new Error("FROZEN_FINAL_PRODUCT_MISSING");
        if(observing&&humanDecision)await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"simulated_giver",messageType:"decision",content:stimulus.transcript.giver_decision,idempotencyKey:"scripted-giver-decision",simulatedActorEvent:true,eventOrigin:stimulus.source_kind,transcriptId:stimulus.id,stimulusVersion:stimulus.version});
        if(observing&&!humanDecision)await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"agent",messageType:"decision",content:stimulus.transcript.agent_decision,idempotencyKey:"scripted-agent-decision",eventOrigin:stimulus.source_kind,transcriptId:stimulus.id,stimulusVersion:stimulus.version});
        const selectionActor=humanDecision?"human":"agent";
        const {error:finalizeError}=await db.rpc("finalize_trial_selection",{p_trial_id:trial.id,p_participant_id:participant.id,p_candidate_id:chosen.gift_candidate_id,p_actor:selectionActor,p_is_simulated:observing});
        if(finalizeError)throw finalizeError;
        await saveEvent(context,humanDecision?"human_final_selection":"agent_final_selection","decision",observing&&humanDecision?"simulated_giver":"agent",{candidateId:chosen.gift_candidate_id,simulatedPlayback:observing,taskId:"final_decision",reasonFocus:finalReasonFocus});
        await saveEvent(context,"agent_task_completed","decision","agent",{taskId:"final_decision",candidateId:chosen.gift_candidate_id});
        await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:observing&&humanDecision?"simulated_giver":selectionActor==="human"?"participant":"agent",messageType:"decision",content:`${humanDecision?"선물 주는 사람이 선택한 최종 선물":"AI가 선택한 최종 선물"}: ${chosen.product_snapshot?.product_name??"선물 후보"}`,payload:{candidateId:chosen.gift_candidate_id,productSnapshot:chosen.product_snapshot},idempotencyKey:"final-decision-v2",simulatedActorEvent:observing&&humanDecision,eventOrigin:observing?stimulus.source_kind:"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
        await storeTranscriptMessage(db,{trialId:trial.id,phase:"awaiting_survey",actorType:"system",messageType:"text",content:"연구자에게 받은 종이 설문에 응답해 주세요. 심리척도와 주관적 평가는 웹에서 입력하지 않습니다. 종이 설문을 작성한 뒤 완료를 확인해 주세요.",payload:{paperSurveyTimeExcluded:true},idempotencyKey:"paper-survey-prompt-v2"});
        return NextResponse.json({phase:"awaiting_survey",selectedCandidateId:chosen.gift_candidate_id,selectedBy:selectionActor});
      }
      const {data:latest}=await db.from("trials").select("current_phase,status").eq("id",trial.id).single();
      return NextResponse.json({phase:latest?.current_phase??transition?.phase,status:latest?.status??trial.status});
    }
    return NextResponse.json({error:"지원하지 않는 단계 동작입니다."},{status:400});
  } catch(error:any) {
    const result=responseForError(error);
    if(error?.status===401||error?.status===403||error?.status===409)return NextResponse.json({error:error.message},{status:error.status});
    return result;
  }
}
