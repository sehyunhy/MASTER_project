import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { participantSessionMatches } from "@/lib/auth/participant";
import { EXPERIMENT } from "@/config/experiment";
import { interpretMessage, explainWithCatalogTools } from "@/lib/agent/claude";
import { logEvent } from "@/lib/events";
import { storeTranscriptMessage } from "@/lib/experiment/transcript";
import { isOnlyCriteria, mergeCriteria, normalizeCriteria } from "@/lib/experiment/criteria";
import { restoreRecordedCandidates } from "@/lib/catalog/generateTrialCandidates";
import { loadAgentSessionContext } from "@/lib/agent/sessionContext";

const inputSchema=z.object({participantId:z.string().uuid(),trialId:z.string().uuid(),
  tabId:z.string().uuid(),
  inputMode:z.enum(["chat","dropdown"]),text:z.string().trim().max(1200).default(""),
  selectedCategory:z.string().nullable().optional(),preferenceTags:z.array(z.string()).max(5).optional(),
  selectedPriority:z.enum(["취향 적합성","실용성","감성적","개인적 의미"]).nullable().optional(),
  selectedPriorities:z.array(z.enum(["취향 적합성","실용성","감성적","개인적 의미"])).max(3).optional(),
  requestIntent:z.enum(["criteria_update","search_request","compare_request"]).optional(),
  idempotencyKey:z.string().uuid()});

export async function POST(request:Request){
  let parsed;
  try{parsed=inputSchema.safeParse(await request.json());}catch{return NextResponse.json({error:"입력 형식을 확인해 주세요."},{status:400});}
  if(!parsed.success)return NextResponse.json({error:"입력 내용이 올바르지 않습니다."},{status:400});
  const input=parsed.data;
  if(!await participantSessionMatches(input.participantId))return NextResponse.json({error:"참가자 세션이 만료되었습니다."},{status:401});
  try{
    const db=supabaseAdmin();
    const [{data:person},{data:trial}]=await Promise.all([
      db.from("participants").select("id,role,participant_code").eq("id",input.participantId).single(),
      db.from("trials").select("id,participant_id,profile_id,scenario_id,current_phase,status,execution_autonomy,decision_authority,experiment_version,stimulus_version").eq("id",input.trialId).eq("participant_id",input.participantId).single(),
    ]);
    if(!person||person.role!=="giver"||!trial||trial.experiment_version!==EXPERIMENT.version)return NextResponse.json({error:"이 대화는 현재 선물 주는 사람 실험에서만 사용할 수 있습니다."},{status:403});
    const {data:priorReply}=await db.from("trial_messages").select("content,payload").eq("trial_id",trial.id).eq("idempotency_key","chat-reply:"+input.idempotencyKey).maybeSingle();
    if(priorReply)return NextResponse.json({ok:true,response:priorReply.content,...priorReply.payload,idempotent:true});
    const phase=trial.current_phase;
    if(!["criteria","candidates","comparison","decision"].includes(phase)||trial.status==="completed")return NextResponse.json({error:"현재 단계에서는 대화를 입력할 수 없습니다."},{status:409});
    if(phase!=="decision"){
      const {data:exposure}=await db.from("trial_phase_exposures").select("content_ready_at,active_tab_id,lease_until")
        .eq("trial_id",trial.id).eq("phase",phase).maybeSingle();
      if(!exposure?.content_ready_at||exposure.active_tab_id!==input.tabId||!exposure.lease_until||new Date(exposure.lease_until).getTime()<Date.now())return NextResponse.json({error:"현재 활성 화면에서 내용을 확인한 뒤 입력해 주세요."},{status:409});
    }
    if(input.inputMode==="chat"&&!input.text)return NextResponse.json({error:"메시지를 입력해 주세요."},{status:400});
    const {data:profile}=await db.from("recipient_profiles").select("*").eq("id",trial.profile_id).single();
    if(!profile)throw new Error("선물 받는 사람 프로필을 찾지 못했습니다.");
    const {data:catalog,error:catalogError}=await db.from("product_catalog")
      .select("category,search_tags_ko").eq("dataset_version",EXPERIMENT.candidateVersion).eq("source_type","walmart_csv_snapshot")
      .eq("experiment_eligible",true).eq("is_active",true).contains("profile_codes",[profile.profile_code]).lte("price_experiment",profile.gift_budget);
    if(catalogError)throw catalogError;
    if(!catalog?.length)throw new Error(`CATALOG_SOURCE_EMPTY trial=${trial.id} profile=${profile.profile_code} dataset=${EXPERIMENT.candidateVersion}`);
    const allowedCategories=[...new Set((catalog??[]).map((x:any)=>x.category))] as string[];
    const allowedTags=[...new Set((catalog??[]).flatMap((x:any)=>x.search_tags_ko??[]))] as string[];
    const {data:state}=await db.from("trial_search_states").select("*").eq("trial_id",trial.id).maybeSingle();
    const current=state??{trial_id:trial.id,scenario_id:trial.scenario_id,recipient_context:profile.recent_interest??"",allowed_categories:allowedCategories,selected_category:null,preference_tags:[],use_context:null,selection_priorities:[],excluded_features:[],budget_limit:profile.gift_budget,currency:"KRW",query_text:"",state_version:0};
    // One transport request owns this UUID. A later intentional repeat uses a new UUID.
    const {data:claim,error:claimError}=await db.from("trial_messages").upsert({
      trial_id:trial.id,phase,actor_type:"participant",message_type:"text",
      content:input.inputMode==="chat"?input.text:"선택 메뉴 입력 처리 중",
      payload:{processing:true},idempotency_key:"chat-input:"+input.idempotencyKey,event_origin:"participant",
    },{onConflict:"trial_id,idempotency_key",ignoreDuplicates:true}).select("id");
    if(claimError)throw claimError;
    if(!claim?.length)return NextResponse.json({error:"앞선 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요."},{status:409,headers:{"Retry-After":"1"}});
    let intent=input.inputMode==="chat"
      ?isOnlyCriteria(input.text)?{intent:"criteria_update" as const,selected_category:null,preference_tags:[],selection_priority:null,final_ordinal:null,clarification:null}
        :await interpretMessage({text:input.text,phase,condition:trial.execution_autonomy,allowedCategories,allowedTags,sessionContext:await loadAgentSessionContext(db,trial.id)})
      :{intent:input.requestIntent??"criteria_update",selected_category:input.selectedCategory??null,preference_tags:input.preferenceTags??[],selection_priority:input.selectedPriority??null,final_ordinal:null,clarification:null};
    if(phase==="criteria"&&input.inputMode==="chat"&&intent.intent==="clarify"&&!/(후보|찾아|추천해|비교|최종|선택해|결정해)/.test(input.text))
      intent={...intent,intent:"criteria_update",clarification:null};
    const requestedPriorities=normalizeCriteria(input.selectedPriorities??(input.selectedPriority?[input.selectedPriority]:current.selection_priorities??[]));
    const allPriorities=mergeCriteria(requestedPriorities,input.text,intent.selection_priority);
    const mode=input.inputMode;
    await logEvent({participantId:person.id,trialId:trial.id,eventType:mode==="chat"?"chat_message_submitted":"dropdown_changed",phase,actorType:"participant",eventOrigin:"participant",inputMode:mode,intent:intent.intent,payload:{text:input.text,selectedCategory:intent.selected_category,preferenceTags:intent.preference_tags,selectedPriorities:allPriorities},idempotencyKey:"chat-input:"+input.idempotencyKey});
    if(mode==="chat")await storeTranscriptMessage(db,{trialId:trial.id,phase,actorType:"participant",messageType:"text",content:input.text,payload:{inputMode:mode,intent:intent.intent},idempotencyKey:"chat-input:"+input.idempotencyKey,eventOrigin:"participant"});
    else await storeTranscriptMessage(db,{trialId:trial.id,phase,actorType:"participant",messageType:"text",content:`선택해서 입력하기 · 추천 기준: ${allPriorities.join(" · ")||"선택 없음"} · 카테고리: ${intent.selected_category??"전체"} · 특성: ${intent.preference_tags.join(" · ")||"선택 없음"}`,payload:{inputMode:mode,intent:intent.intent,selectedPriorities:allPriorities},idempotencyKey:"chat-input:"+input.idempotencyKey,eventOrigin:"participant"});
    let response="";let advanceRequested=false;let finalCandidateId:string|null=null;
    const taskIntent=["search_request","compare_request","final_choice"].includes(intent.intent);
    if(intent.intent==="clarify"){
      response=intent.clarification??"조건을 조금 더 구체적으로 알려주세요.";
      await logEvent({participantId:person.id,trialId:trial.id,eventType:"clarification_requested",phase,actorType:"agent",inputMode:mode,intent:intent.intent,payload:{reason:response}});
    } else if((intent.intent==="criteria_update"&&phase!=="criteria")||taskIntent&&((intent.intent==="final_choice"&&trial.decision_authority!=="human")||
      (intent.intent==="final_choice"&&phase!=="decision")||
      (["search_request","compare_request"].includes(intent.intent)&&trial.execution_autonomy!=="human_guided")||
      (intent.intent==="search_request"&&phase!=="criteria")||
      (intent.intent==="compare_request"&&phase!=="candidates"))){
      response="이 단계에서는 후보 집합이나 과업 진행·최종 선택 권한을 변경할 수 없습니다. 표시된 상품에 대한 설명은 질문할 수 있습니다.";
      await logEvent({participantId:person.id,trialId:trial.id,eventType:"permission_rejected",phase,actorType:"system",inputMode:mode,intent:intent.intent,payload:{condition:trial.execution_autonomy,decisionAuthority:trial.decision_authority}});
    } else if(intent.intent==="final_choice"){
      if(!intent.final_ordinal){response="선택할 후보 번호를 알려주세요.";}
      else {
        const {data:link}=await db.from("trial_candidates").select("gift_candidate_id").eq("trial_id",trial.id).eq("display_order",intent.final_ordinal).maybeSingle();
        if(!link)response="해당 번호의 후보가 없습니다. 화면에 표시된 번호를 확인해 주세요.";
        else{finalCandidateId=link.gift_candidate_id;response=`${intent.final_ordinal}번 후보를 최종 선택 대상으로 확인했습니다.`;}
      }
    } else {
      const nextState=phase==="criteria"?{...current,allowed_categories:allowedCategories,
        selected_category:mode==="dropdown"?intent.selected_category:input.selectedCategory??intent.selected_category??current.selected_category,
        preference_tags:mode==="dropdown"?intent.preference_tags:[...new Set([...(current.preference_tags??[]),...(input.preferenceTags??[]),...intent.preference_tags])],
        selection_priorities:allPriorities,
        query_text:mode==="chat"&&input.text&&!String(current.query_text??"").split("\n").includes(input.text)?[current.query_text,input.text].filter(Boolean).join("\n"):current.query_text,
        state_version:Number(current.state_version)+1,updated_at:new Date().toISOString()}:current;
      if(nextState.selected_category&&!allowedCategories.includes(nextState.selected_category))return NextResponse.json({error:"이 프로필에서 허용되지 않은 카테고리입니다."},{status:400});
      if(nextState.preference_tags.some((tag:string)=>!allowedTags.includes(tag)))return NextResponse.json({error:"허용되지 않은 상품 특성입니다."},{status:400});
      // Budget and scenario always come from the assigned profile and trial.
      nextState.budget_limit=profile.gift_budget;nextState.scenario_id=trial.scenario_id;nextState.currency="KRW";
      if(phase==="criteria"){
        const {error:stateError}=await db.from("trial_search_states").upsert(nextState,{onConflict:"trial_id"});
        if(stateError)throw stateError;
        await logEvent({participantId:person.id,trialId:trial.id,eventType:"filters_applied",phase,actorType:"participant",inputMode:mode,intent:intent.intent,payload:{stateVersion:nextState.state_version,selectedCategory:nextState.selected_category,preferenceTags:nextState.preference_tags,selectionPriorities:nextState.selection_priorities}});
      }
      if(intent.intent==="search_request"||intent.intent==="compare_request"){
        const {data:exposure}=await db.from("trial_phase_exposures").select("accumulated_ms").eq("trial_id",trial.id).eq("phase",phase).maybeSingle();
        if(Number(exposure?.accumulated_ms??0)<EXPERIMENT.minimumPhaseExposureMs)response="현재 내용을 최소 20초 동안 확인한 뒤 다음 과업을 요청할 수 있습니다.";
        else{response=intent.intent==="search_request"?"후보 구성을 요청했습니다.":"후보 비교를 요청했습니다.";advanceRequested=true;}
      }else if(phase==="criteria"&&intent.intent==="criteria_update"){
        const criterionText=allPriorities.length===1&&allPriorities[0]!=="감성적"?`${allPriorities[0]}을`:allPriorities.length?`${allPriorities.join("·")} 기준을`:"입력한 조건을";
        response=`${profile.name}님의 관심사와 ${Number(profile.gift_budget).toLocaleString()}원 예산을 바탕으로 ${criterionText} 추천 기준에 반영했습니다.`;
      }else{
        let {data:links,error:linksError}=await db.from("trial_candidates").select("display_order,product_snapshot").eq("trial_id",trial.id).order("display_order");
        if(linksError)throw linksError;
        if(["candidates","comparison","decision"].includes(phase)&&(links??[]).length!==3){
          const restored=await restoreRecordedCandidates(db,trial.id);
          if(restored)links=restored;
        }
        if(["candidates","comparison","decision"].includes(phase)&&(links??[]).length!==3)throw new Error(`CANDIDATE_STATE_MISSING trial=${trial.id} phase=${phase}`);
        const ids=(links??[]).map((x:any)=>x.product_snapshot?.source_product_id).filter(Boolean);
        const sessionContext=await loadAgentSessionContext(db,trial.id,links??[]);
        const answer=await explainWithCatalogTools({db,trialId:trial.id,profileCode:profile.profile_code,budget:profile.gift_budget,question:input.text||"적용된 조건을 확인해 주세요.",state:nextState,candidateIds:ids,sessionContext});
        response=answer.text;
        for(const tool of answer.toolCalls){
          await logEvent({participantId:person.id,trialId:trial.id,eventType:"tool_called",phase,actorType:"agent",inputMode:mode,intent:intent.intent,payload:{tool,model:answer.model}});
          await logEvent({participantId:person.id,trialId:trial.id,eventType:"tool_result_returned",phase,actorType:"agent",inputMode:mode,intent:intent.intent,payload:{tool}});
        }
      }
    }
    await storeTranscriptMessage(db,{trialId:trial.id,phase,actorType:"agent",messageType:"text",content:response,payload:{inputMode:mode,intent:intent.intent,advanceRequested,finalCandidateId},idempotencyKey:"chat-reply:"+input.idempotencyKey,eventOrigin:"system"});
    return NextResponse.json({ok:true,response,advanceRequested,finalCandidateId,intent:intent.intent,stateVersion:phase==="criteria"?Number(current.state_version)+1:Number(current.state_version)});
  }catch(e){console.error("[experiment/chat]",e);return NextResponse.json({error:"상품 정보를 불러오지 못했습니다. 다시 시도해 주세요."},{status:500});}
}
