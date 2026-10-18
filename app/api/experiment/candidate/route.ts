import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { participantSessionMatches } from "@/lib/auth/participant";
import { EXPERIMENT } from "@/config/experiment";
import { chooseOneCatalogCandidateWithClaude } from "@/lib/agent/claude";
import { loadAgentSessionContext } from "@/lib/agent/sessionContext";
import { logEvent } from "@/lib/events";
import { storeTranscriptMessage } from "@/lib/experiment/transcript";

const requestSchema=z.object({action:z.literal("request"),participantId:z.string().uuid(),trialId:z.string().uuid(),tabId:z.string().uuid(),text:z.string().trim().min(1).max(1200),idempotencyKey:z.string().uuid()});
const confirmSchema=z.object({action:z.literal("confirm"),participantId:z.string().uuid(),trialId:z.string().uuid(),tabId:z.string().uuid(),requestId:z.string().uuid(),idempotencyKey:z.string().uuid()});

const stopWords=new Set(["선물","사람","받는","주는","분","위해","에게","이런","저런","그리고","있는","좋은","원하는","기준","추천","후보","하나","이번","주세요","선택","보고","싶은"]);
const directionHints=["사용","쓰는","평소","관리","꾸미","휴대","보관","독서","사진","요리","주방","식탁","피부","스킨케어","운동","정리","휴식","취미","여행","출근","수납"];
function words(value:string){return (value.toLowerCase().match(/[가-힣]{2,}|[a-z]{3,}/g)??[]).filter(word=>!stopWords.has(word));}
function requestNeedsMoreDetail(text:string,profile:any,products:any[]){
  const profileText=[profile.hobbies,profile.recent_interest,profile.lifestyle_context,profile.preference,profile.dislike].flat().filter(Boolean).join(" ").toLowerCase();
  const contextTerms=words(profileText);
  const requestWords=words(text);
  const hasRecipientEvidence=contextTerms.some(term=>requestWords.some(word=>word.includes(term)||term.includes(word)));
  const catalogTerms=words(products.flatMap(item=>[item.category,item.search_tags_ko,item.product_name_ko,item.product_name_original]).flat().filter(Boolean).join(" "));
  const hasConcreteDirection=directionHints.some(term=>text.toLowerCase().includes(term))||catalogTerms.some(term=>requestWords.some(word=>word.includes(term)||term.includes(word)));
  if(!hasRecipientEvidence||!hasConcreteDirection){
    const missing=[!hasRecipientEvidence?"선물 받을 사람의 관심사나 사용 상황":"",!hasConcreteDirection?"이번 후보의 구체적인 용도·종류":""].filter(Boolean).join("과 ");
    return `후보를 하나씩 만들기 위해 ${missing}을 요청에 적어 주세요. 예를 들어 종이로 받은 프로필의 관심사와 실제 사용할 상황을 연결해 구체적으로 작성해 주세요.`;
  }
  if(text.length<8)return "선물 받을 사람의 구체적인 특성과 이번 후보의 방향을 함께 적어 주세요.";
  return null;
}

async function access(participantId:string,trialId:string,tabId:string){
  if(!await participantSessionMatches(participantId))throw Object.assign(new Error("SESSION_EXPIRED"),{status:401});
  const db=supabaseAdmin();
  const [{data:trial,error:trialError},{data:person,error:personError}]=await Promise.all([
    db.from("trials").select("id,participant_id,profile_id,condition_id,current_phase,status,experiment_version,candidate_builder,candidate_mode,decision_authority,candidate_version,dataset_version").eq("id",trialId).eq("participant_id",participantId).single(),
    db.from("participants").select("id,role").eq("id",participantId).single(),
  ]);
  if(trialError||personError||!trial||!person)throw Object.assign(new Error("TRIAL_NOT_FOUND"),{status:404});
  if(trial.experiment_version!==EXPERIMENT.version||trial.status!=="active"||trial.current_phase!=="candidates"||trial.candidate_mode!=="human_sequential"||trial.candidate_builder!=="human"||person.role!=="giver")throw Object.assign(new Error("CANDIDATE_REQUEST_NOT_ALLOWED"),{status:403});
  const [{data:profile,error:profileError},{data:record,error:recordError},{data:prior,error:priorError}]=await Promise.all([
    db.from("recipient_profiles").select("*").eq("id",trial.profile_id).single(),
    db.from("v6_phase_records").select("phase_status,active_tab_id,lease_until,last_heartbeat_at,effective_exposure_ms").eq("trial_id",trial.id).eq("phase","candidates").single(),
    db.from("trial_candidates").select("gift_candidate_id,display_order,product_snapshot").eq("trial_id",trial.id).order("display_order"),
  ]);
  if(profileError||recordError||priorError||!profile||!record)throw Object.assign(profileError??recordError??priorError??new Error("PHASE_NOT_READY"),{status:409});
  if(record.phase_status!=="active"||Number(record.effective_exposure_ms)>=180000||record.active_tab_id!==tabId||!record.lease_until||new Date(record.lease_until).getTime()<Date.now()||!record.last_heartbeat_at||Date.now()-new Date(record.last_heartbeat_at).getTime()>5000)throw Object.assign(new Error("CONTENT_NOT_ACTIVE"),{status:409});
  const slot=(prior??[]).length+1;
  if(slot>3)throw Object.assign(new Error("CANDIDATE_SLOTS_COMPLETE"),{status:409});
  return {db,trial,person,profile,record,prior:prior??[],slot};
}

export async function POST(request:Request){
  let raw:any;try{raw=await request.json();}catch{return NextResponse.json({error:"요청 내용을 확인해 주세요."},{status:400});}
  const parsed=raw?.action==="request"?requestSchema.safeParse(raw):confirmSchema.safeParse(raw);
  if(!parsed.success)return NextResponse.json({error:"후보 요청 정보를 확인해 주세요."},{status:400});
  const input=parsed.data;
  try{
    const {db,trial,person,profile,prior,slot}=await access(input.participantId,input.trialId,input.tabId);
    if(input.action==="request"){
      const {data:pool,error:poolError}=await db.from("product_catalog").select("id,source_product_id,sku,product_name,product_name_ko,product_name_original,brand,category,price_experiment,currency_experiment,price_original,currency_original,fx_rate_version,description,description_ko,description_original,image_url,specifications,source_url,source_timestamp_raw,dataset_version,use_cases,search_tags_ko,source_type")
        .eq("dataset_version",trial.dataset_version).eq("source_type","walmart_csv_snapshot").eq("experiment_eligible",true).eq("is_active",true).contains("profile_codes",[profile.profile_code]).lte("price_experiment",profile.gift_budget).order("source_product_id").limit(100);
      if(poolError)throw poolError;
      const used=new Set(prior.map((item:any)=>item.product_snapshot?.source_product_id));
      const products=(pool??[]).filter((item:any)=>!used.has(item.source_product_id));
      if(products.length<3-slot+1)throw new Error(`CATALOG_SCOPE_TOO_SMALL profile=${profile.profile_code} slot=${slot}`);
      const insufficient=requestNeedsMoreDetail(input.text,profile,products);
      if(insufficient){
        await logEvent({participantId:person.id,trialId:trial.id,eventType:"candidate_request_needs_detail",phase:"candidates",actorType:"system",eventOrigin:"system",payload:{slot,missingContext:true},idempotencyKey:`v6-detail:${input.idempotencyKey}`});
        return NextResponse.json({error:insufficient,needsDetail:true},{status:422});
      }
      const {data:existing,error:existingError}=await db.from("v6_candidate_requests").select("id,status,response_text,product_snapshot,request_revision").eq("trial_id",trial.id).eq("idempotency_key",input.idempotencyKey).maybeSingle();
      if(existingError)throw existingError;
      if(existing?.status==="proposed")return NextResponse.json({ok:true,idempotent:true,requestId:existing.id,slot,candidate:existing.product_snapshot,response:existing.response_text});
      if(existing?.status==="processing")return NextResponse.json({error:"요청을 처리 중입니다. 잠시 기다려 주세요."},{status:409});
      let claimed:any=existing?.status==="failed"?existing:null;
      if(claimed){
        const {data:reclaimed,error:reclaimError}=await db.from("v6_candidate_requests").update({status:"processing",request_text:input.text,error_code:null,updated_at:new Date().toISOString()}).eq("id",claimed.id).eq("status","failed").select("id").maybeSingle();
        if(reclaimError)throw reclaimError;
        if(!reclaimed)return NextResponse.json({error:"앞선 요청이 처리 중입니다."},{status:409});
        claimed=reclaimed;
      } else {
        const {data:created,error:claimError}=await db.from("v6_candidate_requests").insert({trial_id:trial.id,participant_id:person.id,slot_number:slot,request_revision:1+Number((await db.from("v6_candidate_requests").select("id",{count:"exact",head:true}).eq("trial_id",trial.id).eq("slot_number",slot)).count??0),request_text:input.text,idempotency_key:input.idempotencyKey,status:"processing",actor_type:"participant"}).select("id").single();
        if(claimError||!created){
          const {data:retry}=await db.from("v6_candidate_requests").select("id,status,response_text,product_snapshot").eq("trial_id",trial.id).eq("idempotency_key",input.idempotencyKey).maybeSingle();
          if(retry?.status==="proposed")return NextResponse.json({ok:true,idempotent:true,requestId:retry.id,slot,candidate:retry.product_snapshot,response:retry.response_text});
          return NextResponse.json({error:"앞선 요청이 처리 중입니다."},{status:409});
        }
        claimed=created;
      }
      try{
        await logEvent({participantId:person.id,trialId:trial.id,eventType:"candidate_request_submitted",phase:"candidates",actorType:"participant",eventOrigin:"participant",payload:{slot,requestId:claimed.id},idempotencyKey:`v6-candidate-request-submitted:${claimed.id}`});
        const context=await loadAgentSessionContext(db,trial.id,prior);
        const output=await chooseOneCatalogCandidateWithClaude(products,context,input.text);
        const product=products.find((item:any)=>item.source_product_id===output.sourceProductId);
        if(!product)throw new Error("CLAUDE_CANDIDATE_ID_OUTSIDE_ALLOWED_POOL");
        const snapshot={id:product.id,source_product_id:product.source_product_id,sku:product.sku,product_name:product.product_name_ko??product.product_name_original,product_name_original:product.product_name_original,brand:product.brand,category:product.category,price:product.price_experiment,currency:product.currency_experiment,price_original:product.price_original,currency_original:product.currency_original,fx_rate_version:product.fx_rate_version,description:product.description_ko??product.description,description_original:product.description_original,image_url:product.image_url,specifications:product.specifications??{},source_url:product.source_url,source_timestamp:product.source_timestamp_raw,dataset_version:product.dataset_version,use_cases:product.use_cases??[],search_tags_ko:product.search_tags_ko??[],is_mock:false};
        const responseText=`요청하신 방향에서 상품 기록과 맞는 후보 ${slot}개를 찾았습니다. 상품 정보를 확인한 뒤 종이 프로필 자극물과 함께 살펴보고, 이 후보를 확정하거나 요청을 구체화해 다시 물어보세요.`;
        const {error:updateError}=await db.from("v6_candidate_requests").update({status:"proposed",product_catalog_id:product.id,source_product_id:product.source_product_id,product_snapshot:snapshot,response_text:responseText,claude_model:output.model,claude_response_id:output.responseId,claude_latency_ms:output.latencyMs,prompt_version:EXPERIMENT.promptVersion,proposed_at:new Date().toISOString()}).eq("id",claimed.id).eq("status","processing");
        if(updateError)throw updateError;
        await storeTranscriptMessage(db,{trialId:trial.id,phase:"candidates",actorType:"participant",messageType:"task_request",content:input.text,payload:{slot,requestId:claimed.id,requestRevision:1},idempotencyKey:`v6-candidate-request:${claimed.id}`,eventOrigin:"participant"});
        await storeTranscriptMessage(db,{trialId:trial.id,phase:"candidates",actorType:"agent",messageType:"product_cards",content:responseText,payload:{slot,requestId:claimed.id,candidate:{gift_candidate_id:null,display_order:slot,product_snapshot:snapshot},claudeModel:output.model},idempotencyKey:`v6-candidate-proposal:${claimed.id}`,eventOrigin:"participant"});
        await logEvent({participantId:person.id,trialId:trial.id,eventType:"candidate_proposed",phase:"candidates",actorType:"agent",eventOrigin:"participant",elapsedMs:output.latencyMs,payload:{slot,sourceProductId:product.source_product_id,model:output.model,responseId:output.responseId,promptVersion:EXPERIMENT.promptVersion,requestId:claimed.id,recipientEvidence:output.recipientEvidence,candidateDirection:output.candidateDirection},idempotencyKey:`v6-candidate-proposed:${claimed.id}`});
        return NextResponse.json({ok:true,requestId:claimed.id,slot,candidate:snapshot,response:responseText});
      }catch(error){
        await db.from("v6_candidate_requests").update({status:"failed",error_code:String((error as any)?.message??"CLAUDE_REQUEST_FAILED").slice(0,120)}).eq("id",claimed.id);
        throw error;
      }
    }
    const {data:requestRow,error:requestError}=await db.from("v6_candidate_requests").select("*").eq("id",input.requestId).eq("trial_id",trial.id).single();
    if(requestError||!requestRow)throw Object.assign(new Error("CANDIDATE_REQUEST_NOT_FOUND"),{status:404});
    const {data:result,error:confirmError}=await db.rpc("v6_confirm_candidate",{p_trial_id:trial.id,p_participant_id:person.id,p_tab_id:input.tabId,p_request_id:requestRow.id,p_idempotency_key:input.idempotencyKey});
    if(confirmError)throw confirmError;
    await logEvent({participantId:person.id,trialId:trial.id,eventType:"human_candidate_confirmed",phase:"candidates",actorType:"participant",eventOrigin:"participant",payload:{slot:requestRow.slot_number,sourceProductId:requestRow.source_product_id,requestId:requestRow.id},idempotencyKey:`v6-candidate-confirm:${input.idempotencyKey}`});
    await storeTranscriptMessage(db,{trialId:trial.id,phase:"candidates",actorType:"participant",messageType:"task_request",content:`후보 ${requestRow.slot_number}을 확정했습니다.`,payload:{slot:requestRow.slot_number,sourceProductId:requestRow.source_product_id},idempotencyKey:`v6-candidate-confirm-message:${input.idempotencyKey}`,eventOrigin:"participant"});
    return NextResponse.json({ok:true,result});
  }catch(error){
    const message=String((error as any)?.message??error);
    console.error("[v6 candidate]",message);
    const status=(error as any)?.status??(message.includes("CANDIDATE")||message.includes("TIME")||message.includes("NOT_ACTIVE")?409:500);
    return NextResponse.json({error:status===422?message:message.includes("SESSION_EXPIRED")?"참가자 세션이 만료되었습니다.":"후보를 처리하지 못했습니다. 다시 시도해 주세요.",code:message.split(" ")[0]},{status});
  }
}
