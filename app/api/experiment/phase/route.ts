import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { participantSessionMatches } from "@/lib/auth/participant";
import { logEvent } from "@/lib/events";
import { generateTrialCandidates, restoreRecordedCandidates } from "@/lib/catalog/generateTrialCandidates";
import { comparisonSummary, buildComparison, storeTranscriptMessage } from "@/lib/experiment/transcript";
import { EXPERIMENT } from "@/config/experiment";
import { composeCandidateIntroduction, chooseFinalProductWithClaude } from "@/lib/agent/claude";
import { loadAgentSessionContext } from "@/lib/agent/sessionContext";
import { MAXIMUM_EXPOSURE_MS, MINIMUM_EXPOSURE_MS } from "@/config/experiment";

const PHASES = new Set(["criteria","candidates","comparison"]);
function responseForError(error: any) {
  const message=String(error?.message??error);
  const shortage=message.includes("Not enough active catalog products")||message.includes("적합한 실제 상품")||message.includes("APPROVED_STIMULUS_REQUIRED");
  const claudeNotConfigured=message.includes("Claude API 환경변수 ANTHROPIC_API_KEY");
  const status=shortage?409:claudeNotConfigured?503:message.includes("ANOTHER_TAB_ACTIVE")?409:message.includes("MIN_EXPOSURE_NOT_MET")?409:message.includes("ACTOR_NOT_ALLOWED")?403:message.includes("PHASE_MISMATCH")?409:message.includes("CONTENT_NOT_ACTIVE")?409:500;
  const publicMessage=message.includes("V5_MIN_EXPOSURE_NOT_MET")?"이 단계를 60초 이상 확인한 뒤 진행할 수 있습니다."
    :message.includes("V5_PHASE_TIMEOUT")?"이 단계의 최대 확인시간이 끝났습니다. 완료하지 못한 행동은 미완료로 기록했습니다."
    :message.includes("MIN_EXPOSURE_NOT_MET")?"이 단계 내용을 최소 60초 동안 확인한 뒤 진행할 수 있습니다."
    :message.includes("ANOTHER_TAB_ACTIVE")?"다른 탭에서 연구가 진행 중입니다. 그 탭으로 돌아가 주세요."
    :message.includes("PHASE_MISMATCH")?"현재 연구 단계가 갱신되었습니다. 최신 상태를 불러옵니다."
    :message.includes("ACTOR_NOT_ALLOWED")?"이 단계에서는 해당 작업을 진행할 수 없습니다."
    :message.includes("CANDIDATES_NOT_READY")?"상품 후보를 준비하지 못했습니다. 다시 시도해 주세요."
    :message.includes("CONTENT_NOT_READY")?"화면 내용을 표시한 뒤 다시 시도해 주세요."
    :message.includes("CONTENT_NOT_ACTIVE")?"화면 연결을 확인해 주세요. 화면이 활성 상태일 때 다시 진행할 수 있습니다."
    :shortage?"상품 정보를 불러오지 못했습니다. 다시 시도해 주세요."
    :claudeNotConfigured?"Claude 연결 설정이 완료되지 않았습니다. 연구자가 Vercel의 ANTHROPIC_API_KEY를 확인해 주세요."
    :"연구 단계를 저장하지 못했습니다.";
  return NextResponse.json({error:publicMessage,code:message.split(" ")[0]},{status});
}

async function contextFor(participantId:string,trialId:string) {
  if(!await participantSessionMatches(participantId))throw Object.assign(new Error("SESSION_EXPIRED"),{status:401});
  const db=supabaseAdmin();
  const [{data:participant,error:pError},{data:trial,error:tError},{count:passed,error:trainingError}] = await Promise.all([
    db.from("participants").select("id,participant_code,role,intimacy_condition,sequence_id,is_mock").eq("id",participantId).single(),
    db.from("trials").select("id,participant_id,trial_number,profile_id,condition_id,candidate_builder,candidate_mode,execution_autonomy,decision_authority,status,current_phase,experiment_version,completion_outcome").eq("id",trialId).eq("participant_id",participantId).single(),
    db.from("training_attempts").select("id",{count:"exact",head:true}).eq("participant_id",participantId).eq("passed",true),
  ]);
  if(pError||tError||trainingError||!participant||!trial)throw new Error("PARTICIPANT_OR_TRIAL_NOT_FOUND");
  if(trial.experiment_version!==EXPERIMENT.version)throw Object.assign(new Error("OLD_EXPERIMENT_VERSION"),{status:409});
  if(trial.experiment_version!==EXPERIMENT.version&&!passed)throw Object.assign(new Error("TRAINING_REQUIRED"),{status:403});
  const {data:trials,error:trialsError}=await db.from("trials").select("id,status").eq("participant_id",participantId).order("trial_number");
  if(trialsError)throw trialsError;
  const current=(trials??[]).find((row:any)=>row.status!=="completed");
  if(!current||current.id!==trialId)throw Object.assign(new Error("NOT_CURRENT_TRIAL"),{status:409});
  return {db,participant,trial};
}

async function saveEvent(context:any,eventType:string,phase:string,actorType:"participant"|"agent"|"system"|"simulated_giver",payload:Record<string,unknown>={},effectiveExposureMs?:number,messageId?:string,idempotencyKey?:string,elapsedMs?:number) {
  const taskId=typeof payload.taskId==="string"?payload.taskId:undefined;
  const stableEvents=new Set(["phase_entered","content_ready","trial_started","profile_shown","phase_exposure_satisfied","phase_exited","candidate_shown","comparison_shown","human_selection_screen_shown","paper_survey_prompt_shown"]);
  const eventKey=idempotencyKey??(taskId?phase+":"+eventType+":"+taskId:typeof payload.questionId==="string"?phase+":"+eventType+":"+payload.questionId:stableEvents.has(eventType)?phase+":"+eventType:undefined);
  await logEvent({participantId:context.participant.id,trialId:context.trial.id,eventType,phase,actorType,
    simulatedActorEvent:actorType==="simulated_giver",payload,effectiveExposureMs,elapsedMs,taskId,messageId,
    idempotencyKey:eventKey});
}

async function storeV6ScriptedTimeline(db:any,trialId:string,stimulus:any,phase:"candidates"|"decision") {
  const timeline=stimulus?.transcript?.timeline;
  if(!Array.isArray(timeline))return;
  for(let index=0;index<timeline.length;index++){
    const item=timeline[index];
    if(item?.phase!==phase)continue;
    if(!["giver","agent"].includes(item.actor)||typeof item.content!=="string"||!item.content.trim())throw new Error("V6_SCRIPTED_TIMELINE_INVALID");
    const actorType=item.actor==="giver"?"simulated_giver":"agent";
    const messageType=["text","product_cards","comparison","task_request","decision"].includes(item.messageType)?item.messageType:"text";
    await storeTranscriptMessage(db,{trialId,phase,actorType,messageType,content:item.content.trim(),payload:item.payload&&typeof item.payload==="object"?item.payload:{},idempotencyKey:`v6-scripted-${phase}:${trialId}:${index}`,simulatedActorEvent:actorType==="simulated_giver",eventOrigin:"scripted",transcriptId:stimulus.id,stimulusVersion:stimulus.version});
  }
}

async function prepareV5Decision(context:any) {
  const {db,trial,participant}=context;
  if(trial.experiment_version!==EXPERIMENT.version||trial.current_phase!=="decision")return;
  if(trial.decision_authority==="agent"){
    await ensureV5AgentDecision(context);
    return;
  }
  if(participant.role==="giver"){
    const {data:message,error}=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("idempotency_key","v5-human-decision-handoff").maybeSingle();
    if(error)throw error;
    if(!message)await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"agent",messageType:"decision",content:"후보 비교가 끝났습니다. 최종 선물은 선물 주는 사람이 직접 선택해 주세요.",payload:{decisionAuthority:"human"},idempotencyKey:"v5-human-decision-handoff",eventOrigin:"system"});
    return;
  }
  const {data:links,error:linksError}=await db.from("trial_candidates").select("gift_candidate_id,display_order,product_snapshot").eq("trial_id",trial.id).order("display_order");
  if(linksError)throw linksError;
  const {data:trialState,error:trialError}=await db.from("trials").select("stimulus_id,scenario_id,condition_id").eq("id",trial.id).single();
  if(trialError||!trialState)throw trialError??new Error("TRIAL_STIMULUS_MISSING");
  const query=db.from("v5_stimuli").select("id,version,final_source_product_id,transcript,review_status,frozen_at").eq("scenario_id",trialState.scenario_id).eq("condition_id",trialState.condition_id).eq("review_status","approved");
  const {data:stimulus,error:stimulusError}=trialState.stimulus_id?await query.eq("id",trialState.stimulus_id).single():await query.maybeSingle();
  if(stimulusError||!stimulus?.frozen_at)throw new Error("APPROVED_STIMULUS_REQUIRED");
  const chosen=(links??[]).find((item:any)=>item.product_snapshot?.source_product_id===stimulus.final_source_product_id);
  if(!chosen){
    if(trial.completion_outcome==="timeout"){
      await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"system",messageType:"decision",content:"이 단계는 시간 초과로 종료되었습니다. 최종 선물은 확정되지 않았습니다.",payload:{incomplete:true,decisionAuthority:"human"},idempotencyKey:"v5-human-decision-incomplete",eventOrigin:"system"});
      await saveEvent(context,"task_incomplete","decision","system",{reason:"frozen_final_product_missing"},undefined,undefined,"v5-human-decision-incomplete:"+trial.id);
      return;
    }
    throw new Error("V5_SCRIPTED_FINAL_PRODUCT_NOT_IN_CANDIDATES");
  }
  const {data:existing,error:selectionError}=await db.from("final_selections").select("selected_candidate_id,selected_by,is_simulated").eq("trial_id",trial.id).maybeSingle();
  if(selectionError)throw selectionError;
  if(existing&&(existing.selected_candidate_id!==chosen.gift_candidate_id||existing.selected_by!=="human"||!existing.is_simulated))throw new Error("V5_DECISION_AUTHORITY_CONFLICT");
  if(!existing){
    const {error}=await db.rpc("v5_finalize_selection",{p_trial_id:trial.id,p_participant_id:participant.id,p_candidate_id:chosen.gift_candidate_id,p_actor:"human",p_is_simulated:true});
    if(error)throw error;
  }
  const {data:message,error:messageError}=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("idempotency_key","final-decision-v2").maybeSingle();
  if(messageError)throw messageError;
  if(!message)await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"simulated_giver",messageType:"decision",content:stimulus.transcript.giver_decision??"선물 주는 사람이 최종 선물을 확정했습니다.",payload:{decisionAuthority:"human",candidateId:chosen.gift_candidate_id,productSnapshot:chosen.product_snapshot},idempotencyKey:"final-decision-v2",simulatedActorEvent:true,eventOrigin:"scripted",transcriptId:stimulus.id,stimulusVersion:stimulus.version??1});
  const {data:event,error:eventError}=await db.from("event_logs").select("id").eq("trial_id",trial.id).eq("event_type","simulated_actor_event").eq("task_id","human_final_selection").limit(1).maybeSingle();
  if(eventError)throw eventError;
  if(!event)await saveEvent(context,"simulated_actor_event","decision","simulated_giver",{taskId:"human_final_selection",candidateId:chosen.gift_candidate_id},undefined,undefined,"v5-scripted-human-final:"+trial.id);
}

async function ensureV5AgentDecision(context:any) {
  const {db,trial,participant}=context;
  if(trial.experiment_version!==EXPERIMENT.version||trial.current_phase!=="decision"||trial.decision_authority!=="agent")return;
  const [{data:links,error:linksError},{data:existing,error:selectionError}]=await Promise.all([
    db.from("trial_candidates").select("gift_candidate_id,display_order,product_snapshot").eq("trial_id",trial.id).order("display_order"),
    db.from("final_selections").select("selected_candidate_id,selected_by,selected_at,is_simulated").eq("trial_id",trial.id).maybeSingle(),
  ]);
  if(linksError||selectionError)throw linksError??selectionError;
  if(existing&&existing.selected_by!=="agent")throw new Error("V5_DECISION_AUTHORITY_CONFLICT");
  if(!links||links.length!==3){
    if(trial.completion_outcome==="timeout")await saveEvent(context,"task_incomplete","decision","system",{reason:"candidate_set_incomplete",candidateCount:links?.length??0},undefined,undefined,"v5-agent-decision-incomplete:"+trial.id);
    return;
  }
  let stimulus:any=null;let chosen:any=null;let explanation:string|undefined;let model="researcher-script-v5";
  if(participant.role==="recipient"){
    const {data:row,error:rowError}=await db.from("trials").select("stimulus_id,scenario_id,condition_id").eq("id",trial.id).single();
    if(rowError||!row)throw rowError??new Error("TRIAL_STIMULUS_MISSING");
    let query=db.from("v5_stimuli").select("id,version,final_source_product_id,transcript,review_status,frozen_at").eq("scenario_id",row.scenario_id).eq("condition_id",row.condition_id).eq("review_status","approved");
    if(row.stimulus_id)query=query.eq("id",row.stimulus_id);
    const {data,error}=row.stimulus_id?await query.single():await query.maybeSingle();
    if(error||!data?.frozen_at)throw new Error("APPROVED_STIMULUS_REQUIRED");
    stimulus=data;chosen=links.find((item:any)=>item.product_snapshot?.source_product_id===stimulus.final_source_product_id);explanation=stimulus.transcript?.decision_agent;
  } else if(existing?.selected_by==="agent") {
    chosen=links.find((item:any)=>item.gift_candidate_id===existing.selected_candidate_id);
  } else {
    const started=Date.now();await saveEvent(context,"agent_task_started","decision","agent",{taskId:"final_selection",modelVersion:EXPERIMENT.promptVersion},undefined,undefined,"v5-agent-decision-start:"+trial.id);const sessionContext=await loadAgentSessionContext(db,trial.id,links);
    const output=await chooseFinalProductWithClaude(links,sessionContext);
    chosen=links.find((item:any)=>item.product_snapshot?.source_product_id===output.sourceProductId);explanation=output.reasonText;model=output.model;
    await saveEvent(context,"agent_task_completed","decision","agent",{taskId:"final_selection",modelVersion:model,recovered:true},undefined,undefined,"v5-agent-decision-task:"+trial.id,Date.now()-started);
  }
  if(!chosen){if(trial.completion_outcome==="timeout")return;throw new Error("V5_AGENT_DECISION_PRODUCT_INVALID");}
  if(!existing){
    const {error}=await db.rpc("v5_finalize_selection",{p_trial_id:trial.id,p_participant_id:participant.id,p_candidate_id:chosen.gift_candidate_id,p_actor:"agent",p_is_simulated:participant.role==="recipient"});
    if(error)throw error;
  }
  const {data:message,error:messageError}=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("idempotency_key","v5-agent-decision-explanation").maybeSingle();
  if(messageError)throw messageError;
  if(!message)await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"agent",messageType:"decision",content:explanation??"Agent가 세 후보를 비교해 최종 선물을 확정했습니다.",payload:{candidateId:chosen.gift_candidate_id,productSnapshot:chosen.product_snapshot,modelVersion:model,recovered:Boolean(existing)},idempotencyKey:"v5-agent-decision-explanation",eventOrigin:stimulus?"scripted":"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
  const {data:event}=await db.from("event_logs").select("id").eq("trial_id",trial.id).eq("event_type","agent_final_selection").limit(1).maybeSingle();
  if(!event)await saveEvent(context,"agent_final_selection","decision","agent",{candidateId:chosen.gift_candidate_id,modelVersion:model,recovered:Boolean(existing)},undefined,undefined,"v5-agent-final-selection:"+trial.id);
}

async function prepareV6Decision(context:any) {
  const {db,trial,participant}=context;
  if(trial.current_phase!=="decision")return;
  const [{data:links,error:linksError},{data:existing,error:selectionError},{data:profile,error:profileError}]=await Promise.all([
    db.from("trial_candidates").select("gift_candidate_id,display_order,product_snapshot").eq("trial_id",trial.id).order("display_order"),
    db.from("final_selections").select("selected_candidate_id,selected_by,is_simulated").eq("trial_id",trial.id).maybeSingle(),
    db.from("recipient_profiles").select("id,name,profile_code,hobbies,recent_interest,preference,dislike,gift_budget").eq("id",trial.profile_id).single(),
  ]);
  if(linksError||selectionError||profileError)throw linksError??selectionError??profileError;
  if((links??[]).length!==3)throw new Error("V6_CANDIDATES_NOT_READY");
  let stimulus:any=null;
  if(participant.role==="recipient"){
    const {data:row,error}=await db.from("trials").select("stimulus_id,scenario_id,condition_id").eq("id",trial.id).single();if(error)throw error;
    let query=db.from("v6_stimuli").select("id,version,source_kind,transcript,final_source_product_id,frozen_at").eq("scenario_id",row.scenario_id).eq("condition_id",row.condition_id).eq("review_status","approved");
    if(row.stimulus_id)query=query.eq("id",row.stimulus_id);
    const result=row.stimulus_id?await query.single():await query.maybeSingle();
    if(result.error||!result.data?.frozen_at)throw new Error("APPROVED_STIMULUS_REQUIRED");stimulus=result.data;
    await storeV6ScriptedTimeline(db,trial.id,stimulus,"decision");
  }
  const comparison=participant.role==="recipient"?stimulus.transcript?.comparison_agent:comparisonSummary(buildComparison(links,{profile,priorities:[],budget:profile.gift_budget}));
  const existingComparison=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("idempotency_key","v6-comparison").maybeSingle();
  if(existingComparison.error)throw existingComparison.error;
  if(!existingComparison.data)await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"agent",messageType:"comparison",content:comparison??"세 후보의 DB 상품 정보를 비교해 확인해 주세요.",payload:{rows:buildComparison(links,{profile,priorities:[],budget:profile.gift_budget}),criteria:["가격","예산 적합성","상품 정보","관심사 연결","고려할 점"]},idempotencyKey:"v6-comparison",eventOrigin:stimulus?"scripted":"system",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
  if(trial.decision_authority==="human"&&participant.role==="recipient"){
    const simulatedChoice=links.find((item:any)=>item.product_snapshot?.source_product_id===stimulus.final_source_product_id);
    if(!simulatedChoice)throw new Error("V6_SCRIPTED_HUMAN_FINAL_NOT_IN_CANDIDATES");
    if(existing&&(existing.selected_candidate_id!==simulatedChoice.gift_candidate_id||existing.selected_by!=="human"||!existing.is_simulated))throw new Error("V6_DECISION_AUTHORITY_CONFLICT");
    if(!existing){
      const {error}=await db.rpc("v6_finalize_selection",{p_trial_id:trial.id,p_participant_id:participant.id,p_candidate_id:simulatedChoice.gift_candidate_id,p_actor:"human",p_reason_text:null,p_tab_id:null,p_is_simulated:true});
      if(error)throw error;
    }
    const decisionText=stimulus.transcript?.giver_decision??"선물 주는 사람이 세 후보 중 하나를 최종 선물로 선택했습니다.";
    const priorDecision=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("idempotency_key","v6-scripted-giver-decision").maybeSingle();
    if(priorDecision.error)throw priorDecision.error;
    if(!priorDecision.data)await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"simulated_giver",messageType:"decision",content:decisionText,payload:{decisionAuthority:"human",candidateId:simulatedChoice.gift_candidate_id,productSnapshot:simulatedChoice.product_snapshot},idempotencyKey:"v6-scripted-giver-decision",simulatedActorEvent:true,eventOrigin:"scripted",transcriptId:stimulus.id,stimulusVersion:stimulus.version});
    const finalMessage=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("idempotency_key","final-decision-v2").maybeSingle();
    if(finalMessage.error)throw finalMessage.error;
    if(!finalMessage.data)await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"simulated_giver",messageType:"decision",content:`선물 주는 사람이 선택한 최종 선물: ${simulatedChoice.product_snapshot?.product_name??"선물 후보"}`,payload:{decisionAuthority:"human",candidateId:simulatedChoice.gift_candidate_id,productSnapshot:simulatedChoice.product_snapshot},idempotencyKey:"final-decision-v2",simulatedActorEvent:true,eventOrigin:"scripted",transcriptId:stimulus.id,stimulusVersion:stimulus.version});
    await saveEvent(context,"simulated_actor_event","decision","simulated_giver",{taskId:"human_final_selection",candidateId:simulatedChoice.gift_candidate_id,source:"frozen_recipient_stimulus"},undefined,undefined,"v6-scripted-human-final:"+trial.id);
    return;
  }
  if(trial.decision_authority==="human"){
    const handoff=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("idempotency_key","v6-human-decision-handoff").maybeSingle();
    if(handoff.error)throw handoff.error;
    if(!handoff.data)await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:participant.role==="recipient"?"simulated_giver":"agent",messageType:"text",content:participant.role==="recipient"?(stimulus.transcript?.giver_decision_prompt??"선물 주는 사람이 세 후보 중 하나를 선택합니다."):"세 후보를 비교했습니다. 선물 하나를 선택하고 선택 이유를 직접 작성해 주세요.",payload:{decisionAuthority:"human"},idempotencyKey:"v6-human-decision-handoff",simulatedActorEvent:participant.role==="recipient",eventOrigin:stimulus?"scripted":"system",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
    return;
  }
  if(existing&&existing.selected_by!=="agent")throw new Error("V6_DECISION_AUTHORITY_CONFLICT");
  let chosen:any=existing?links.find((item:any)=>item.gift_candidate_id===existing.selected_candidate_id):null;
  let reason=existing?null:"";let model="researcher-script-v6";let responseId:string|undefined;let latency=0;
  if(!chosen&&participant.role==="recipient"){
    chosen=links.find((item:any)=>item.product_snapshot?.source_product_id===stimulus.final_source_product_id);
    reason=stimulus.transcript?.agent_decision_reason??stimulus.transcript?.agent_decision;
    if(typeof reason!=="string"||reason.length<15)throw new Error("V6_SCRIPTED_AGENT_REASON_MISSING");
  }else if(!chosen){
    const started=Date.now();const output=await chooseFinalProductWithClaude(links,await loadAgentSessionContext(db,trial.id,links));
    chosen=links.find((item:any)=>item.product_snapshot?.source_product_id===output.sourceProductId);reason=output.reasonText;model=output.model;responseId=output.responseId;latency=output.latencyMs;
  }
  if(!chosen||typeof reason!=="string")throw new Error("V6_AGENT_DECISION_INVALID");
  if(!existing){
    const {error}=await db.rpc("v6_finalize_selection",{p_trial_id:trial.id,p_participant_id:participant.id,p_candidate_id:chosen.gift_candidate_id,p_actor:"agent",p_reason_text:reason,p_is_simulated:participant.role==="recipient"});if(error)throw error;
  }
  const {error:trialUpdateError}=await db.from("trials").update({model_version:model,agent_reason_text:reason,final_decision_source:"agent"}).eq("id",trial.id);if(trialUpdateError)throw trialUpdateError;
  await saveEvent(context,"agent_final_selection","decision","agent",{candidateId:chosen.gift_candidate_id,model,responseId,simulatedPlayback:participant.role==="recipient"},undefined,undefined,"v6-agent-final:"+trial.id,latency);
  const already=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("idempotency_key","final-decision-v2").maybeSingle();if(already.error)throw already.error;
  if(!already.data)await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:"agent",messageType:"decision",content:`Agent가 선택한 최종 선물: ${chosen.product_snapshot?.product_name??"선물 후보"}\n\n선택 이유: ${reason}`,payload:{candidateId:chosen.gift_candidate_id,productSnapshot:chosen.product_snapshot,reasonText:reason,model,responseId},idempotencyKey:"final-decision-v2",eventOrigin:stimulus?"scripted":"system",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
}

export async function POST(request:Request) {
  let body:any;
  try { body=await request.json(); } catch { return NextResponse.json({error:"요청 형식을 확인해 주세요."},{status:400}); }
  if(typeof body.participantId!=="string"||typeof body.trialId!=="string"||typeof body.action!=="string")return NextResponse.json({error:"참가자·trial 정보를 확인해 주세요."},{status:400});
  try {
    const context=await contextFor(body.participantId,body.trialId); const {db,trial,participant}=context;
    if(trial.experiment_version===EXPERIMENT.version){
      const timedPhases=new Set(["candidates","decision"]);
      if(body.action==="ready"){
        if(!timedPhases.has(body.phase)||typeof body.tabId!=="string")return NextResponse.json({error:"단계 정보를 확인해 주세요."},{status:400});
        // Prepare an Agent result before the decision exposure clock starts.
        if(body.phase==="decision")await prepareV6Decision(context);
        const {data,error}=await db.rpc("v6_phase_ready",{p_trial_id:trial.id,p_phase:body.phase,p_tab_id:body.tabId});
        if(error)throw error;
        await saveEvent(context,"phase_entered",body.phase,"system",{contentReady:true},Number(data?.effective_exposure_ms??0),undefined,`v5-phase-enter:${trial.id}:${body.phase}`);
        return NextResponse.json({...data,minimum_exposure_ms:MINIMUM_EXPOSURE_MS.experiment[participant.role as "giver"|"recipient"],maximum_exposure_ms:MAXIMUM_EXPOSURE_MS});
      }
      if(body.action==="heartbeat"){
        if(!timedPhases.has(body.phase)||typeof body.tabId!=="string"||!Number.isSafeInteger(body.sequence)||body.sequence<0)return NextResponse.json({error:"노출시간 신호를 확인해 주세요."},{status:400});
        const active=body.active===true;
        const {data,error}=await db.rpc("v6_phase_heartbeat",{p_trial_id:trial.id,p_phase:body.phase,p_tab_id:body.tabId,p_sequence:body.sequence,p_active:active});
        if(error)throw error;
        if(data?.timed_out)await saveEvent(context,"phase_timeout",body.phase,"system",{incompleteAction:true,maximumExposureMs:MAXIMUM_EXPOSURE_MS},Number(data.effective_exposure_ms??MAXIMUM_EXPOSURE_MS),undefined,"v5-phase-timeout:"+trial.id+":"+body.phase);
        if(body.wasActive===true&&!active)await saveEvent(context,body.reason==="offline"?"connection_lost":"page_hidden",body.phase,"system",{reason:body.reason??"inactive"});
        if(body.wasActive===false&&active)await saveEvent(context,body.reason==="online"?"connection_restored":"page_visible",body.phase,"system");
        return NextResponse.json({...data,minimum_exposure_ms:MINIMUM_EXPOSURE_MS.experiment[participant.role as "giver"|"recipient"],maximum_exposure_ms:MAXIMUM_EXPOSURE_MS});
      }
      if(body.action==="advance"){
        if(!timedPhases.has(trial.current_phase)||typeof body.tabId!=="string")return NextResponse.json({error:"현재 단계에서는 진행할 수 없습니다."},{status:409});
        const phase=trial.current_phase;
        const timedOut=trial.completion_outcome==="timeout";
        if(phase==="candidates"&&!timedOut){
          const {data:links,error:linksError}=await db.from("trial_candidates").select("gift_candidate_id,display_order").eq("trial_id",trial.id);
          if(linksError)throw linksError;
          if((links??[]).length!==3)return NextResponse.json({error:"서로 다른 선물 후보 세 개를 모두 준비한 뒤 진행해 주세요."},{status:409});
        }
        if(body.requested!==true)return NextResponse.json({error:"참가자가 직접 다음 단계를 선택해야 합니다."},{status:403});
        const {data,error}=await db.rpc("v6_advance_phase",{p_trial_id:trial.id,p_phase:phase,p_tab_id:body.tabId});
        if(error)throw error;
        await saveEvent(context,"phase_exposure_satisfied",phase,"system",{minimumMs:60000,actualExposureMs:Number(data?.effective_exposure_ms??0)},Number(data?.effective_exposure_ms??0));
        await saveEvent(context,"phase_exited",phase,"system",{nextPhase:data?.phase,reason:"participant_requested"});
        if(data?.phase==="decision"){
          trial.current_phase="decision";
          await prepareV6Decision(context);
        }
        if(data?.phase==="awaiting_survey"){
          await storeTranscriptMessage(db,{trialId:trial.id,phase:"awaiting_survey",actorType:"system",messageType:"text",content:"선택 결과를 확인한 뒤 연구자에게 받은 종이 설문을 작성해 주세요. 설문과 종이 인물 자극물 확인 시간은 실험 단계 노출시간에서 제외됩니다.",payload:{paperSurveyTimeExcluded:true,completionOutcome:trial.completion_outcome},idempotencyKey:"paper-survey-prompt-v2"});
        }
        return NextResponse.json(data);
      }
    }
    if(body.action==="retry_generation") {
      if(trial.experiment_version==="5.0.0"&&participant.role==="giver"&&trial.candidate_builder!=="agent")return NextResponse.json({error:"이 조건에서는 선물 주는 사람이 후보를 직접 구성합니다."},{status:403});
      if(trial.experiment_version==="6.0.0"&&participant.role==="giver"&&trial.candidate_mode!=="agent_batch")return NextResponse.json({error:"이 조건에서는 선물 주는 사람이 후보별 요청을 작성합니다."},{status:403});
      if(trial.current_phase!=="candidates")return NextResponse.json({error:"후보 생성 단계가 아닙니다."},{status:409});
      const {count,error:countError}=await db.from("trial_candidates").select("id",{count:"exact",head:true}).eq("trial_id",trial.id);
      if(countError)throw countError;
      const {data:existingMessage}=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("idempotency_key","catalog-candidates-v2").maybeSingle();
      if(existingMessage){
        if((count??0)<3)await restoreRecordedCandidates(db,trial.id);
        return NextResponse.json({ok:true,recovered:(count??0)<3});
      }
      if((count??0)<3||!existingMessage) {
        await saveEvent(context,"retry","candidates","system",{operation:"generate_missing_catalog_candidates",existingCandidateCount:count??0},undefined,undefined,"candidate-generation-retry:"+trial.id+":"+randomUUID());
        const agentStartedAt=Date.now();
        await saveEvent(context,"agent_task_started","candidates","agent",{taskId:"compose_candidates",modelVersion:trial.experiment_version==="5.0.0"?EXPERIMENT.promptVersion:undefined});
        const generated=await generateTrialCandidates(db,trial.id);
        if(participant.role==="recipient"&&trial.experiment_version==="6.0.0")await storeV6ScriptedTimeline(db,trial.id,generated.stimulus,"candidates");
        if(!existingMessage){
        const intro=participant.role==="recipient"?generated.stimulus?.transcript?.candidate_agent:await composeCandidateIntroduction(generated.candidates,await loadAgentSessionContext(db,trial.id,generated.candidates));
          await storeTranscriptMessage(db,{trialId:trial.id,phase:"candidates",actorType:"agent",messageType:"product_cards",content:intro??"세 후보를 표시합니다.",payload:{candidates:generated.candidates},idempotencyKey:"catalog-candidates-v2",eventOrigin:participant.role==="recipient"?generated.stimulus?.source_kind:"system",transcriptId:generated.stimulus?.id,stimulusVersion:generated.stimulus?.version});
        }
        const {data:prior}=await db.from("event_logs").select("id").eq("trial_id",trial.id).eq("event_type","agent_task_completed").eq("task_id","compose_candidates").limit(1).maybeSingle();
        if(!prior)await saveEvent(context,"agent_task_completed","candidates","agent",{taskId:"compose_candidates",candidateCount:generated.candidates.length,candidateSetId:generated.candidateSetId,modelVersion:generated.candidateModel,recovered:true},undefined,undefined,undefined,Date.now()-agentStartedAt);
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
      if(phase==="criteria"&&participant.role==="giver"&&guided) {
        const {data:searchState,error:stateError}=await db.from("trial_search_states").select("query_text,selected_category,preference_tags,selection_priorities").eq("trial_id",trial.id).maybeSingle();
        if(stateError)throw stateError;
        if(!searchState||(!searchState.query_text&&!searchState.selected_category&&!searchState.preference_tags?.length&&!searchState.selection_priorities?.length))return NextResponse.json({error:"대화나 선택 메뉴로 선물 기준을 먼저 입력해 주세요."},{status:409});
      }
      let actor:"human_request"|"agent"|"simulated_giver"|"human";
      if(phase==="criteria"||phase==="candidates") {
        if(observing) actor=guided?"simulated_giver":"agent";
        else if(guided){if(body.requested!==true)return NextResponse.json({error:"요청 버튼으로 다음 과업을 시작해 주세요."},{status:403});actor="human_request";}
        else {if(body.requested===true)return NextResponse.json({error:"이 조건에서는 Agent가 다음 단계를 진행합니다."},{status:403});actor="agent";}
      } else {
        actor=observing?(humanDecision?"simulated_giver":"agent"):(humanDecision?"human":"agent");
      }
      if(typeof body.tabId!=="string")return NextResponse.json({error:"화면 세션을 확인할 수 없습니다."},{status:400});
      let preparedIntroduction:string|undefined;
      if(phase==="criteria"){
        const {data:phaseExposure,error:phaseExposureError}=await db.from("trial_phase_exposures")
          .select("accumulated_ms,active_tab_id,lease_until,last_heartbeat_at")
          .eq("trial_id",trial.id).eq("phase",phase).maybeSingle();
        if(phaseExposureError)throw phaseExposureError;
        if(!phaseExposure||Number(phaseExposure.accumulated_ms)<EXPERIMENT.minimumPhaseExposureMs)throw new Error("MIN_EXPOSURE_NOT_MET");
        const now=Date.now();
        if(phaseExposure.active_tab_id!==body.tabId||!phaseExposure.lease_until||Date.parse(phaseExposure.lease_until)<now
          ||!phaseExposure.last_heartbeat_at||Date.parse(phaseExposure.last_heartbeat_at)<now-5000)throw new Error("CONTENT_NOT_ACTIVE");
        // Keep a failed catalog lookup or Claude call in criteria, where it can be retried safely.
        // The preview uses the same filters and ranking as the persisted candidate generation.
        const prepared=await generateTrialCandidates(db,trial.id,{previewOnly:true});
        if(observing&&prepared.stimulus?.id!==stimulus?.id)throw new Error("APPROVED_STIMULUS_REQUIRED");
        preparedIntroduction=observing?stimulus.transcript.candidate_agent:await composeCandidateIntroduction(prepared.candidates,await loadAgentSessionContext(db,trial.id,prepared.candidates));
      }
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
        const intro=preparedIntroduction;
        if(!intro)throw new Error("CANDIDATES_NOT_READY");
        if(!observing){await saveEvent(context,"tool_called","candidates","agent",{tool:"present_recommendation"});await saveEvent(context,"tool_result_returned","candidates","agent",{tool:"present_recommendation"});}
        await storeTranscriptMessage(db,{trialId:trial.id,phase:"candidates",actorType:"agent",messageType:"product_cards",content:intro,payload:{candidates:generated.candidates,candidateSetHash:generated.candidateSetHash},idempotencyKey:"catalog-candidates-v2",eventOrigin:observing?stimulus.source_kind:"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
      } else if(phase==="candidates") {
        await restoreRecordedCandidates(db,trial.id);
        const eventType=actor==="human_request"?"user_task_requested":actor==="simulated_giver"?"simulated_actor_event":"agent_task_started";
        await saveEvent(context,eventType,phase,actor==="human_request"?"participant":actor==="simulated_giver"?"simulated_giver":"agent",{taskId:"compare_candidates",requestedBy:actor});
        await saveEvent(context,"agent_task_started","candidates","agent",{taskId:"compare_candidates"});
        const {data:priorCompareRequest}=await db.from("trial_messages").select("id").eq("trial_id",trial.id).eq("phase",phase).eq("actor_type","participant").contains("payload",{intent:"compare_request"}).limit(1).maybeSingle();
        if((actor==="human_request"&&!priorCompareRequest)||actor==="simulated_giver")await storeTranscriptMessage(db,{trialId:trial.id,phase,actorType:actor==="simulated_giver"?"simulated_giver":"participant",messageType:"task_request",content:stimulus?.transcript?.request_comparison??"세 후보의 차이를 비교해주세요.",idempotencyKey:"request-comparison",simulatedActorEvent:actor==="simulated_giver",eventOrigin:observing?stimulus.source_kind:"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
        const {data:candidates,error:candidateError}=await db.from("trial_candidates").select("display_order,product_snapshot,gift_candidates(product_name,price)").eq("trial_id",trial.id).order("display_order");
        if(candidateError)throw candidateError;
        const [{data:comparisonProfile,error:profileError},{data:comparisonState,error:stateError}]=await Promise.all([
          db.from("recipient_profiles").select("name,profile_code,hobbies,recent_interest,preference,dislike,gift_budget").eq("id",trial.profile_id).single(),
          db.from("trial_search_states").select("selection_priorities").eq("trial_id",trial.id).maybeSingle(),
        ]);
        if(profileError||stateError||!comparisonProfile)throw profileError??stateError??new Error("PROFILE_MISSING");
        const observedPriority=observing?stimulus?.transcript?.criteria_priority:null;
        const priorities=Array.isArray(comparisonState?.selection_priorities)&&comparisonState.selection_priorities.length
          ?comparisonState.selection_priorities:typeof observedPriority==="string"&&observedPriority?[observedPriority]:[];
        const comparison=buildComparison(candidates??[],{
          profile:comparisonProfile,priorities,budget:comparisonProfile.gift_budget,
          intimacyCondition:participant.intimacy_condition,
        });
        const summary=observing?stimulus.transcript.comparison_agent:comparisonSummary(comparison);
        await saveEvent(context,"agent_task_completed","comparison","agent",{taskId:"compare_candidates"});
        await storeTranscriptMessage(db,{trialId:trial.id,phase:"comparison",actorType:"agent",messageType:"comparison",content:summary,payload:{rows:comparison,criteria:["가격","예산 적합성","핵심 특징·목적","관심사·취향 연결","실용성","감성적 측면","다른 후보 대비 강점","선택 전 고려할 점","우선할 기준"]},idempotencyKey:"comparison-v2",eventOrigin:observing?stimulus.source_kind:"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
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
            const choice=await chooseFinalProductWithClaude(picks,await loadAgentSessionContext(db,trial.id));
            chosen=picks.find((pick:any)=>pick.product_snapshot?.source_product_id===choice.sourceProductId);
            finalReasonFocus=choice.reasonText;
            await saveEvent(context,"tool_result_returned","decision","agent",{tool:"choose_final_product",sourceProductId:choice.sourceProductId,model:choice.model,reasonText:choice.reasonText,responseId:choice.responseId},undefined,undefined,undefined,choice.latencyMs);
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
        await storeTranscriptMessage(db,{trialId:trial.id,phase:"decision",actorType:observing&&humanDecision?"simulated_giver":selectionActor==="human"?"participant":"agent",messageType:"decision",content:`${humanDecision?"선물 주는 사람이 선택한 최종 선물":"Agent가 선택한 최종 선물"}: ${chosen.product_snapshot?.product_name??"선물 후보"}`,payload:{candidateId:chosen.gift_candidate_id,productSnapshot:chosen.product_snapshot},idempotencyKey:"final-decision-v2",simulatedActorEvent:observing&&humanDecision,eventOrigin:observing?stimulus.source_kind:"participant",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
        await storeTranscriptMessage(db,{trialId:trial.id,phase:"awaiting_survey",actorType:"system",messageType:"text",content:"연구자에게 받은 종이 설문에 응답해 주세요. 심리척도와 주관적 평가는 웹에서 입력하지 않습니다. 종이 설문을 작성한 뒤 완료를 확인해 주세요.",payload:{paperSurveyTimeExcluded:true},idempotencyKey:"paper-survey-prompt-v2"});
        return NextResponse.json({phase:"awaiting_survey",selectedCandidateId:chosen.gift_candidate_id,selectedBy:selectionActor});
      }
      const {data:latest}=await db.from("trials").select("current_phase,status").eq("id",trial.id).single();
      return NextResponse.json({phase:latest?.current_phase??transition?.phase,status:latest?.status??trial.status});
    }
    return NextResponse.json({error:"지원하지 않는 단계 동작입니다."},{status:400});
  } catch(error:any) {
    console.error("[experiment/phase]",error);
    const result=responseForError(error);
    if(error?.status===401||error?.status===403||error?.status===409)return NextResponse.json({error:error.message},{status:error.status});
    return result;
  }
}
