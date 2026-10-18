import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { answerSchema, finalSelectionSchema, eventSchema } from "@/lib/validation/schemas";
import { logEvent } from "@/lib/events";
import { storeTranscriptMessage } from "@/lib/experiment/transcript";
import { EXPERIMENT } from "@/config/experiment";
import { participantSessionMatches } from "@/lib/auth/participant";

async function checkTrialAccess(db:ReturnType<typeof supabaseAdmin>,participantId:string,trialId:string){
  const {data:trials}=await db.from("trials").select("id,status,trial_number,experiment_version").eq("participant_id",participantId).order("trial_number");
  const current=(trials??[]).find(t=>t.status!=="completed");
  if(!current||current.id!==trialId)throw new Error("Trial is not the current participant step.");
  if(current.experiment_version!==EXPERIMENT.version)throw new Error("This trial belongs to an older experiment version.");
  if(!["5.0.0","6.0.0"].includes(current.experiment_version)){
    const {count:passed}=await db.from("training_attempts").select("id",{count:"exact",head:true}).eq("participant_id",participantId).eq("passed",true);
    if(!passed)throw new Error("Training not completed.");
  }
}

export async function POST(request: Request) {
  const input = await request.json();
  const db = supabaseAdmin();
  if(["show_candidates","playback_select","agent_select"].includes(input.action))return NextResponse.json({error:"이전 직접 실행 경로는 종료되었습니다. 서버가 현재 단계와 권한에 따라 진행합니다."},{status:410});
  if(!await participantSessionMatches(String(input.participantId??"")))return NextResponse.json({error:"참가자 세션이 만료되었습니다."},{status:401});
  if(input.trialId&&input.action!=="confirm_survey")try{await checkTrialAccess(db,String(input.participantId??""),String(input.trialId));}catch{return NextResponse.json({error:"연습을 완료한 뒤 현재 단계에서 진행해 주세요."},{status:403});}
  try {
    if(input.action==="confirm_trial_intro"){
      const participantId=String(input.participantId??"");const trialId=String(input.trialId??"");
      if(!trialId)return NextResponse.json({error:"현재 trial 정보를 확인해 주세요."},{status:400});
      const {data:person}=await db.from("participants").select("experiment_version").eq("id",participantId).single();
      const {data,error}=await db.rpc(person?.experiment_version==="6.0.0"?"v6_confirm_trial_intro":"v5_confirm_trial_intro",{p_trial_id:trialId,p_participant_id:participantId});
      if(error)throw error;
      await logEvent({participantId,trialId,eventType:"trial_intro_confirmed",phase:"intro",actorType:"participant",eventOrigin:"participant",idempotencyKey:"v5-intro-confirmed:"+trialId});
      return NextResponse.json({ok:true,...data});
    }
    if(input.action==="compose_candidates_v5"){
      const {participantId,trialId,tabId,sourceProductIds,idempotencyKey}=input;
      if(typeof tabId!=="string"||!Array.isArray(sourceProductIds)||sourceProductIds.length!==3||new Set(sourceProductIds).size!==3||sourceProductIds.some((x:any)=>typeof x!=="string")||typeof idempotencyKey!=="string")return NextResponse.json({error:"서로 다른 상품 3개를 선택해 주세요."},{status:400});
      const [{data:trial,error:trialError},{data:person,error:personError}]=await Promise.all([
        db.from("trials").select("id,participant_id,profile_id,current_phase,status,experiment_version,candidate_builder,candidate_set_hash,dataset_version").eq("id",trialId).eq("participant_id",participantId).single(),
        db.from("participants").select("role").eq("id",participantId).single(),
      ]);
      if(trialError||personError||!trial||!person)throw trialError??personError??new Error("TRIAL_NOT_FOUND");
      if(trial.experiment_version!=="5.0.0"||trial.candidate_builder!=="human"||person.role!=="giver")return NextResponse.json({error:"이 조건에서는 직접 후보를 구성할 수 없습니다."},{status:403});
      if(trial.status!=="active"||trial.current_phase!=="candidates")return NextResponse.json({error:"현재 후보 구성 단계가 아닙니다."},{status:409});
      const {data:prior}=await db.from("trial_candidates").select("display_order,product_snapshot").eq("trial_id",trialId).order("display_order");
      if((prior??[]).length){
        const priorIds=(prior??[]).map((x:any)=>x.product_snapshot?.source_product_id);
        if(priorIds.length===3&&priorIds.every((id:any,index:number)=>id===sourceProductIds[index]))return NextResponse.json({ok:true,idempotent:true});
        return NextResponse.json({error:"이 trial의 후보 3개는 이미 확정되어 변경할 수 없습니다."},{status:409});
      }
      const [{data:profile,error:profileError},{data:phaseRecord,error:phaseError}]=await Promise.all([
        db.from("recipient_profiles").select("id,profile_code,gift_budget").eq("id",trial.profile_id).single(),
        db.from("v5_phase_records").select("phase_status,active_tab_id,lease_until,last_heartbeat_at,effective_exposure_ms").eq("trial_id",trialId).eq("phase","candidates").single(),
      ]);
      if(profileError||phaseError||!profile||!phaseRecord)throw profileError??phaseError??new Error("V5_PHASE_NOT_READY");
      if(phaseRecord.phase_status!=="active"||Number(phaseRecord.effective_exposure_ms)>=180000)return NextResponse.json({error:"후보 구성 시간이 끝났습니다. 연구자에게 알려 주세요."},{status:409});
      if(Number(phaseRecord.effective_exposure_ms)<60000)return NextResponse.json({error:"후보 상품 풀을 최소 60초 확인한 뒤 확정할 수 있습니다."},{status:409});
      if(phaseRecord.active_tab_id!==tabId||!phaseRecord.lease_until||new Date(phaseRecord.lease_until).getTime()<Date.now()||!phaseRecord.last_heartbeat_at||Date.now()-new Date(phaseRecord.last_heartbeat_at).getTime()>5000)return NextResponse.json({error:"현재 활성 화면에서 진행해 주세요."},{status:409});
      const {data:products,error:productsError}=await db.from("product_catalog").select("*").in("source_product_id",sourceProductIds)
        .eq("dataset_version",trial.dataset_version).eq("source_type","walmart_csv_snapshot").eq("experiment_eligible",true).eq("is_active",true)
        .contains("profile_codes",[profile.profile_code]).lte("price_experiment",profile.gift_budget);
      if(productsError)throw productsError;
      if(!products||products.length!==3)return NextResponse.json({error:"선택한 상품 중 현재 자극물과 예산에 맞지 않는 항목이 있습니다. 다시 선택해 주세요."},{status:409});
      const ordered=sourceProductIds.map((id:string)=>products.find((p:any)=>p.source_product_id===id));
      if(ordered.some((p:any)=>!p))return NextResponse.json({error:"선택한 상품 정보를 확인할 수 없습니다."},{status:409});
      const snapshots=ordered.map((item:any)=>({id:item.id,source_product_id:item.source_product_id,sku:item.sku,product_name:item.product_name_ko??item.product_name_original,product_name_original:item.product_name_original,brand:item.brand,category:item.category,price:item.price_experiment,currency:item.currency_experiment,price_original:item.price_original,currency_original:item.currency_original,fx_rate_version:item.fx_rate_version,description:item.description_ko??item.description,description_original:item.description_original,image_url:item.image_url,specifications:item.specifications??{},source_url:item.source_url,source_timestamp:item.source_timestamp_raw,dataset_version:item.dataset_version,use_cases:item.use_cases??[],strengths:[],limitations:[],care_requirements:null,source_type:item.source_type,is_mock:false}));
      const {createHash}=await import("node:crypto");
      const candidateSetHash=createHash("sha256").update(JSON.stringify(snapshots)).digest("hex");
      const candidateSetId=`v5-${trialId}-${candidateSetHash.slice(0,16)}`;
      const {data:saved,error:saveError}=await db.rpc("v5_save_human_candidate_set",{
        p_trial_id:trialId,p_participant_id:participantId,p_tab_id:tabId,p_source_product_ids:sourceProductIds,
        p_candidate_set_id:candidateSetId,p_candidate_set_hash:candidateSetHash,p_snapshots:snapshots,
      });
      if(saveError){
        const message=String(saveError.message??"");
        const status=message.includes("V5_CANDIDATE_PHASE_TIME_INVALID")||message.includes("V5_CONTENT_NOT_ACTIVE")||message.includes("V5_CANDIDATE_SET_ALREADY_FIXED")||message.includes("V5_PRODUCT_SCOPE_INVALID")?409:500;
        return NextResponse.json({error:status===409?"후보 구성 화면을 확인하고 다시 시도해 주세요.":"후보 정보를 저장하지 못했습니다."},{status});
      }
      if(saved?.idempotent)return NextResponse.json({ok:true,idempotent:true,candidateSetHash:saved.candidate_set_hash});
      const result=saved?.candidates??[];
      if(result.length!==3)throw new Error("V5_CANDIDATE_SET_SAVE_INCOMPLETE");
      await logEvent({participantId,trialId,eventType:"human_candidate_set_confirmed",phase:"candidates",actorType:"participant",eventOrigin:"participant",payload:{candidateCount:3,candidateSetHash,sourceProductIds},idempotencyKey:`v5-human-candidate-set:${trialId}:${idempotencyKey}`});
      await storeTranscriptMessage(db,{trialId,phase:"candidates",actorType:"participant",messageType:"task_request",content:"선물 주는 사람이 상품 풀에서 후보 세 개를 구성했습니다.",payload:{candidateSetHash,candidateCount:3},idempotencyKey:`v5-human-candidate-set:${candidateSetHash}`});
      await storeTranscriptMessage(db,{trialId,phase:"candidates",actorType:"agent",messageType:"product_cards",content:"선물 주는 사람이 구성한 후보 세 개를 표시합니다.",payload:{candidates:result,candidateSetHash},idempotencyKey:"catalog-candidates-v2",eventOrigin:"participant"});
      return NextResponse.json({ok:true,candidateSetHash});
    }
    if (input.action === "event") {
      const v = eventSchema.safeParse(input);
      if (!v.success) return NextResponse.json({ error: "이벤트 정보를 확인해 주세요." }, { status: 400 });
      const serverOwnedEvents=new Set(["phase_entered","content_ready","phase_exposure_satisfied","phase_exited","candidate_shown","candidates_shown","comparison_shown","user_task_requested","agent_task_started","agent_task_completed","human_final_selection","agent_final_selection","message_rendered","human_selection_screen_shown","paper_survey_prompt_shown","paper_survey_completed_confirmed","trial_completed"]);
      if(serverOwnedEvents.has(v.data.eventType))return NextResponse.json({error:"이 이벤트는 서버가 실제 단계 전이에 따라 기록합니다."},{status:403});
      const allowed=new Set(["page_hidden","page_visible","page_refreshed","connection_lost","connection_restored","error_occurred","retry","duplicate_rejected","candidate_opened","candidate_closed","candidate_reopened","candidate_revisited","candidate_detail_viewed","comparison_interacted","human_candidate_selected","human_candidate_changed","candidate_pool_selected","candidate_pool_unselected","observation_started"]);
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
      if(["candidate_pool_selected","candidate_pool_unselected"].includes(v.data.eventType)){
        if(!v.data.trialId||!v.data.eventValue)return NextResponse.json({error:"상품 후보 정보가 필요합니다."},{status:400});
        const {data:trial}=await db.from("trials").select("profile_id,condition_id,candidate_builder,current_phase,status,experiment_version,dataset_version").eq("id",v.data.trialId).eq("participant_id",v.data.participantId).single();
        const {data:person}=await db.from("participants").select("role").eq("id",v.data.participantId).single();
        if(!trial||!person||person.role!=="giver"||trial.experiment_version!=="5.0.0"||trial.candidate_builder!=="human"||trial.current_phase!=="candidates"||trial.status!=="active")return NextResponse.json({error:"현재 조건에서는 상품 풀을 선택할 수 없습니다."},{status:403});
        const {data:profile}=await db.from("recipient_profiles").select("profile_code,gift_budget").eq("id",trial.profile_id).single();
        const {data:product}=await db.from("product_catalog").select("source_product_id").eq("source_product_id",v.data.eventValue).eq("dataset_version",trial.dataset_version).eq("source_type","walmart_csv_snapshot").eq("experiment_eligible",true).eq("is_active",true).contains("profile_codes",[profile?.profile_code]).lte("price_experiment",profile?.gift_budget).maybeSingle();
        if(!product)return NextResponse.json({error:"현재 상품 풀에 없는 항목입니다."},{status:403});
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
    if(input.action==="save_selection_reason"){
      const participantId=String(input.participantId??"");const trialId=String(input.trialId??"");const candidateId=String(input.candidateId??"");const reasonText=typeof input.reasonText==="string"?input.reasonText.trim():"";const idempotencyKey=typeof input.idempotencyKey==="string"?input.idempotencyKey:"";
      if(!trialId||!candidateId||!idempotencyKey||reasonText.length<1||reasonText.length>1000)return NextResponse.json({error:"선택 이유를 확인해 주세요."},{status:400});
      const [{data:trial,error:trialError},{data:person,error:personError},{data:candidate,error:candidateError}]=await Promise.all([
        db.from("trials").select("status,current_phase,experiment_version,decision_authority").eq("id",trialId).eq("participant_id",participantId).single(),
        db.from("participants").select("role").eq("id",participantId).single(),
        db.from("trial_candidates").select("gift_candidate_id").eq("trial_id",trialId).eq("gift_candidate_id",candidateId).maybeSingle(),
      ]);
      if(trialError||personError||candidateError)throw trialError??personError??candidateError;
      if(trial?.experiment_version!=="6.0.0"||trial.status!=="active"||trial.current_phase!=="decision"||trial.decision_authority!=="human"||person?.role!=="giver"||!candidate)return NextResponse.json({error:"현재 조건에서는 선택 이유를 저장할 수 없습니다."},{status:403});
      const {count,error:historyError}=await db.from("v6_selection_reason_history").select("id",{count:"exact",head:true}).eq("trial_id",trialId).in("action",["written","revised"]);
      if(historyError)throw historyError;
      const action=(count??0)>0?"revised":"written";
      const {error:insertError}=await db.from("v6_selection_reason_history").insert({trial_id:trialId,participant_id:participantId,candidate_id:candidateId,reason_text:reasonText,action,idempotency_key:idempotencyKey});
      if(insertError&&insertError.code!=="23505")throw insertError;
      if(!insertError)await logEvent({participantId,trialId,eventType:action==="written"?"human_selection_reason_written":"human_selection_reason_revised",phase:"decision",actorType:"participant",eventOrigin:"participant",payload:{candidateId,characterCount:reasonText.length},idempotencyKey:`v6-selection-reason:${idempotencyKey}`});
      return NextResponse.json({ok:true,action});
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
      const { data: trial, error: tErr } = await db.from("trials").select("decision_authority,participant_id,condition_id,status,current_phase,experiment_version").eq("id", v.data.trialId).eq("participant_id", v.data.participantId).single();
      if (tErr || !trial) return NextResponse.json({ error: "실험 단계를 찾지 못했습니다." }, { status: 404 });
      if (trial.decision_authority !== "human") return NextResponse.json({ error: "이 단계의 최종 선택은 시스템이 진행합니다." }, { status: 403 });
      const {data:person}=await db.from("participants").select("role").eq("id",v.data.participantId).single();
      if(person?.role!=="giver")return NextResponse.json({error:"관찰 모드에서는 실제 선택을 입력할 수 없습니다."},{status:403});
      const { data: link,error:linkError } = await db.from("trial_candidates").select("gift_candidate_id,product_snapshot").eq("trial_id",v.data.trialId).eq("gift_candidate_id",v.data.candidateId).maybeSingle();
      if(linkError)throw linkError;
      if(!link)return NextResponse.json({error:"후보를 찾을 수 없습니다."},{status:400});
      if(trial.experiment_version==="6.0.0"){
        if(trial.status!=="active"||trial.current_phase!=="decision")return NextResponse.json({error:"현재 최종 결정 단계가 아닙니다."},{status:409});
        const reasonText=typeof input.reasonText==="string"?input.reasonText.trim():"";
        if(reasonText.length<15||/^(그냥|알아서|모르겠음|이유 없음)[.! ]*$/.test(reasonText))return NextResponse.json({error:"다른 두 후보 대신 이 선물을 선택한 이유를 구체적으로 적어 주세요."},{status:400});
        const {data:record,error:recordError}=await db.from("v6_phase_records").select("phase_status,active_tab_id,lease_until,last_heartbeat_at,effective_exposure_ms").eq("trial_id",v.data.trialId).eq("phase","decision").single();
        if(recordError||!record||record.phase_status!=="active"||Number(record.effective_exposure_ms)<60000||Number(record.effective_exposure_ms)>=180000||record.active_tab_id!==input.tabId||!record.lease_until||new Date(record.lease_until).getTime()<Date.now()||!record.last_heartbeat_at||Date.now()-new Date(record.last_heartbeat_at).getTime()>5000)return NextResponse.json({error:"최소 확인시간이 지나고 현재 화면이 활성화된 뒤 선택을 확정해 주세요."},{status:409});
        const {data:selection,error:selectionError}=await db.rpc("v6_finalize_selection",{p_trial_id:v.data.trialId,p_participant_id:v.data.participantId,p_candidate_id:v.data.candidateId,p_actor:"human",p_reason_text:reasonText,p_tab_id:input.tabId,p_is_simulated:false});
        if(selectionError)throw selectionError;
        const selected=link.product_snapshot??{};
        await db.from("v6_selection_reason_history").insert({trial_id:v.data.trialId,participant_id:v.data.participantId,candidate_id:v.data.candidateId,reason_text:reasonText,action:"confirmed",idempotency_key:`v6-reason:${v.data.trialId}`});
        await logEvent({participantId:v.data.participantId,trialId:v.data.trialId,eventType:"human_final_selection",phase:"decision",actorType:"participant",eventOrigin:"participant",payload:{candidateId:v.data.candidateId},eventValue:v.data.candidateId,idempotencyKey:"v6-human-final-selection:"+v.data.trialId});
        await storeTranscriptMessage(db,{trialId:v.data.trialId,phase:"decision",actorType:"participant",messageType:"decision",content:`선물 주는 사람이 선택한 최종 선물: ${selected.product_name??"선물 후보"}`,payload:{candidateId:v.data.candidateId,productSnapshot:selected,reasonText},idempotencyKey:"final-decision-v2",eventOrigin:"participant"});
        return NextResponse.json({ok:true,selection});
      }
      if(trial.experiment_version==="5.0.0"){
        if(trial.status!=="active"||trial.current_phase!=="decision")return NextResponse.json({error:"현재 최종 선택 단계가 아닙니다."},{status:409});
        const {data:record,error:recordError}=await db.from("v5_phase_records").select("phase_status,active_tab_id,lease_until,last_heartbeat_at,effective_exposure_ms").eq("trial_id",v.data.trialId).eq("phase","decision").single();
        if(recordError||!record||record.phase_status!=="active"||Number(record.effective_exposure_ms)>=180000)return NextResponse.json({error:"최종 선택 시간이 끝났습니다. 연구자에게 알려 주세요."},{status:409});
        if(Number(record.effective_exposure_ms)<60000)return NextResponse.json({error:"최종 선택 단계를 최소 60초 확인한 뒤 확정해 주세요."},{status:409});
        if(record.active_tab_id!==input.tabId||!record.lease_until||new Date(record.lease_until).getTime()<Date.now()||!record.last_heartbeat_at||Date.now()-new Date(record.last_heartbeat_at).getTime()>5000)return NextResponse.json({error:"현재 활성 화면에서 진행해 주세요."},{status:409});
        const {data:selection,error:selectionError}=await db.rpc("v5_finalize_selection",{p_trial_id:v.data.trialId,p_participant_id:v.data.participantId,p_candidate_id:v.data.candidateId,p_actor:"human",p_is_simulated:false});
        if(selectionError)throw selectionError;
        const selected=link.product_snapshot??{};
        await logEvent({participantId:v.data.participantId,trialId:v.data.trialId,eventType:"human_final_selection",phase:"decision",actorType:"participant",eventOrigin:"participant",payload:{candidateId:v.data.candidateId},eventValue:v.data.candidateId,idempotencyKey:"v5-human-final-selection:"+v.data.trialId});
        await storeTranscriptMessage(db,{trialId:v.data.trialId,phase:"decision",actorType:"participant",messageType:"decision",content:`선물 주는 사람이 선택한 최종 선물: ${selected?.product_name??"선물 후보"}`,payload:{candidateId:v.data.candidateId,productSnapshot:selected},idempotencyKey:"final-decision-v2",eventOrigin:"participant"});
        return NextResponse.json({ok:true,selection});
      }
      const retryingSameFinalChoice=trial.status==="awaiting_survey"&&trial.current_phase==="awaiting_survey";
      if(!retryingSameFinalChoice&&(trial.status!=="active"||trial.current_phase!=="decision"))return NextResponse.json({error:"비교 내용을 최소 20초 확인한 뒤 최종 선택해 주세요."},{status:409});
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
      const { data: trial, error: trialError } = await db.from("trials").select("decision_authority,participant_id,status,current_phase,experiment_version,completion_outcome,final_selections(id)").eq("id", trialId).eq("participant_id", participantId).single();
      if (trialError) throw trialError;
      if (!trial) return NextResponse.json({ error: "실험 단계를 찾지 못했습니다." }, { status: 404 });
      if(trial.status!=="awaiting_survey"&&trial.status!=="completed")return NextResponse.json({error:"설문 확인 단계가 아닙니다."},{status:409});
      const existingSelections=Array.isArray(trial.final_selections)?trial.final_selections:trial.final_selections?[trial.final_selections]:[];
      const v5TimedOut=["5.0.0","6.0.0"].includes(trial.experiment_version)&&trial.completion_outcome==="timeout";
      if (!existingSelections.length&&!v5TimedOut) return NextResponse.json({ error: "최종 선택 기록이 없습니다." }, { status: 409 });
      const {data:visibleResult,error:resultError}=await db.from("trial_messages").select("id,rendered_at").eq("trial_id",trialId).eq("idempotency_key","final-decision-v2").maybeSingle();
      if(resultError)throw resultError;
      if(existingSelections.length&&!visibleResult?.rendered_at)return NextResponse.json({error:"최종 선물 결과를 화면에서 확인한 뒤 종이 설문 완료를 표시해 주세요."},{status:409});
      if(trial.status==="awaiting_survey"){
        const {data:completed,error:completeError}=await db.from("trials").update({status:"completed",current_phase:"completed",completed_at:new Date().toISOString()}).eq("id",trialId).eq("status","awaiting_survey").eq("current_phase","awaiting_survey").select("id").maybeSingle();
        if(completeError)throw completeError;
        if(!completed){
          const {data:latest,error:latestError}=await db.from("trials").select("status").eq("id",trialId).single();
          if(latestError)throw latestError;
          if(latest?.status!=="completed")return NextResponse.json({error:"설문 확인 단계가 갱신되었습니다. 화면을 다시 불러와 주세요."},{status:409});
        }
      }
      if(["5.0.0","6.0.0"].includes(trial.experiment_version)){
        const {error:surveyError}=await db.from("v5_surveys").upsert({trial_id:trialId,status:"paper_completed",paper_completed_at:new Date().toISOString()},{onConflict:"trial_id"});
        if(surveyError)throw surveyError;
      }
      await logEvent({ participantId, trialId, eventType: "paper_survey_completed_confirmed",clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined,idempotencyKey:"paper-survey-completed:"+trialId });
      await logEvent({ participantId, trialId, eventType: "trial_completed",clientTimestamp:typeof input.clientTimestamp==="string"?input.clientTimestamp:undefined,idempotencyKey:"trial-completed:"+trialId });
      const { count, error:countError } = await db.from("trials").select("id", { count: "exact", head: true }).eq("participant_id", participantId).neq("status", "completed");
      if(countError)throw countError;
      if (count === 0) {
        if(["5.0.0","6.0.0"].includes(trial.experiment_version)){
          const {data:roleComplete,error:roleCompleteError}=await db.rpc(trial.experiment_version==="6.0.0"?"v6_complete_role_session":"v5_complete_role_session",{p_participant_id:participantId});
          if(roleCompleteError)throw roleCompleteError;
          await logEvent({participantId,trialId,eventType:"role_session_completed",payload:{subjectComplete:Boolean(roleComplete?.subject_complete)},idempotencyKey:"v5-role-completed:"+participantId});
        } else {
          const {error:participantError}=await db.from("participants").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", participantId);
          if(participantError)throw participantError;
          await logEvent({ participantId,trialId,eventType: "experiment_completed",idempotencyKey:"experiment-completed:"+participantId });
        }
      }
      return NextResponse.json({ ok: true,idempotent:trial.status==="completed" });
    }
    return NextResponse.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "저장에 실패했습니다." }, { status: 500 }); }
}
