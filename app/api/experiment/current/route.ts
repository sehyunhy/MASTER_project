import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { participantSessionMatches } from "@/lib/auth/participant";
import { storeTranscriptMessage } from "@/lib/experiment/transcript";
import { EXPERIMENT } from "@/config/experiment";
import { loadApprovedRelationshipCopy, relationshipForParticipant } from "@/lib/experiment/relationship";

export async function GET(request: Request) {
  const participantId = new URL(request.url).searchParams.get("participantId");
  if (!participantId) return NextResponse.json({ error: "참가자 정보가 없습니다." }, { status: 400 });
  if(!await participantSessionMatches(participantId))return NextResponse.json({error:"참가자 세션이 만료되었습니다."},{status:401});
  try {
    const db = supabaseAdmin();
    const { data: p, error } = await db.from("participants").select("id,participant_code,role,intimacy_condition,sequence_id,status,experiment_version,training_attempts").eq("id", participantId).single();
    if (error || !p) return NextResponse.json({ error: "참가자 정보를 찾을 수 없습니다." }, { status: 404 });
    if(p.status==="withdrawn")return NextResponse.json({error:"참여 중단이 기록되었습니다."},{status:403});
    if(p.experiment_version!==EXPERIMENT.version)return NextResponse.json({error:"이 참가자 세션은 이전 연구 버전입니다. 연구자에게 확인해 주세요."},{status:409});
    const {count:passed}=await db.from("training_attempts").select("id",{count:"exact",head:true}).eq("participant_id",participantId).eq("passed",true);
    if(!passed)return NextResponse.json({error:"먼저 연습 안내와 이해도 확인을 완료해 주세요."},{status:403});
    const { data: trials, error:trialsError } = await db.from("trials").select("*, recipient_profiles(*), trial_candidates(*, gift_candidates(*)), final_selections(*),guided_responses(*),event_logs(*),trial_phase_exposures(*),trial_messages(*)").eq("participant_id", participantId).order("trial_number");
    if(trialsError)throw trialsError;
    const normalized=(trials??[]).map((t:any)=>({...t,final_selections:Array.isArray(t.final_selections)?t.final_selections:t.final_selections?[t.final_selections]:[]}));
    const active = normalized.find((t: any) => t.status !== "completed");
    if(active&&active.experiment_version!==EXPERIMENT.version)return NextResponse.json({error:"현재 trial은 이전 연구 버전으로 시작되었습니다. 연구자에게 확인해 주세요."},{status:409});
    let stimulus:any=null;
    if(active&&p.role==="recipient"){
      let stimulusQuery=db.from("recipient_stimuli").select("*").eq("scenario_id",active.scenario_id).eq("review_status","approved");
      if(active.stimulus_id)stimulusQuery=stimulusQuery.eq("id",active.stimulus_id);
      const {data,error:stimulusError}=await stimulusQuery.order("version",{ascending:false}).limit(1).maybeSingle();
      if(stimulusError)throw stimulusError;
      if(!data?.frozen_at)return NextResponse.json({error:`${active.scenario_id}에 검토·동결된 선물 받는 사람 관찰 자극이 없습니다. 연구자가 해당 프로필의 실제 상품과 대화를 검토해야 합니다.`},{status:409});
      stimulus=data;
      if(!active.stimulus_id){
        const {error:pinError}=await db.from("trials").update({stimulus_id:data.id,stimulus_version:data.version,stimulus_source:data.source_kind})
          .eq("id",active.id).is("stimulus_id",null);
        if(pinError)throw pinError;
        active.stimulus_id=data.id;active.stimulus_version=data.version;active.stimulus_source=data.source_kind;
      }
    }
    if(active&&!active.started_at){
      const startedAt=new Date().toISOString();
      const {error:startError}=await db.from("trials").update({started_at:startedAt}).eq("id",active.id).is("started_at",null);
      if(startError)throw startError;
      active.started_at=startedAt;
    }
    if(active?.current_phase==="criteria"){
      const hasOpening=(active.trial_messages??[]).some((message:any)=>message.idempotency_key==="criteria-opening-v2");
      if(!hasOpening){
        const profile=active.recipient_profiles;
        if(p.role==="recipient"){
          const t=stimulus.transcript;
          await storeTranscriptMessage(db,{trialId:active.id,phase:"criteria",actorType:"simulated_giver",messageType:"text",content:t.criteria_dropdown,payload:{inputMode:"dropdown",selectedCategory:t.criteria_category,selectedPriority:t.criteria_priority,scenarioId:active.scenario_id},idempotencyKey:"scripted-criteria-dropdown",simulatedActorEvent:true,eventOrigin:stimulus.source_kind,transcriptId:stimulus.id,stimulusVersion:stimulus.version});
          await storeTranscriptMessage(db,{trialId:active.id,phase:"criteria",actorType:"simulated_giver",messageType:"text",content:t.criteria_giver,payload:{inputMode:"chat"},idempotencyKey:"scripted-criteria-text",simulatedActorEvent:true,eventOrigin:stimulus.source_kind,transcriptId:stimulus.id,stimulusVersion:stimulus.version});
          await storeTranscriptMessage(db,{trialId:active.id,phase:"criteria",actorType:"agent",messageType:"text",content:t.criteria_agent,payload:{scenarioId:active.scenario_id},idempotencyKey:"criteria-opening-v2",eventOrigin:stimulus.source_kind,transcriptId:stimulus.id,stimulusVersion:stimulus.version});
        } else {
          await storeTranscriptMessage(db,{trialId:active.id,phase:"criteria",actorType:"agent",messageType:"text",content:`선물 받는 사람 ${profile?.name??"프로필"}의 관심사와 ${Number(profile?.gift_budget??0).toLocaleString()}원 예산을 확인했습니다. 선호 기준을 반영해 후보를 살펴보겠습니다.`,payload:{profileCode:profile?.profile_code,budget:profile?.gift_budget,profileVersion:active.profile_version},idempotencyKey:"criteria-opening-v2"});
        }
        const {data:messages}=await db.from("trial_messages").select("*").eq("trial_id",active.id).order("created_at");
        active.trial_messages=messages??[];
      }
    }
    if(active?.current_phase==="awaiting_survey"){
      const selection=active.final_selections?.[0];
      const selectedCandidate=(active.trial_candidates??[]).find((candidate:any)=>candidate.gift_candidate_id===selection?.selected_candidate_id);
      const product=selectedCandidate?.product_snapshot??selectedCandidate?.gift_candidates??{};
      const hasDecision=(active.trial_messages??[]).some((message:any)=>message.idempotency_key==="final-decision-v2");
      if(!hasDecision&&selection){
        const human=selection.selected_by==="human";
        const simulated=human&&p.role==="recipient";
        await storeTranscriptMessage(db,{trialId:active.id,phase:"decision",actorType:simulated?"simulated_giver":human?"participant":"agent",messageType:"decision",content:`${human?"선물 주는 사람이 선택한 최종 선물":"Agent가 선택한 최종 선물"}: ${product.product_name??"선물 후보"}`,payload:{candidateId:selection.selected_candidate_id,productSnapshot:selectedCandidate?.product_snapshot??{}},idempotencyKey:"final-decision-v2",simulatedActorEvent:simulated,eventOrigin:p.role==="recipient"?stimulus?.source_kind:"system",transcriptId:stimulus?.id,stimulusVersion:stimulus?.version});
      }
      const hasSurveyPrompt=(active.trial_messages??[]).some((message:any)=>message.idempotency_key==="paper-survey-prompt-v2");
      if(!hasSurveyPrompt){
        await storeTranscriptMessage(db,{trialId:active.id,phase:"awaiting_survey",actorType:"system",messageType:"text",content:"연구자에게 받은 종이 설문에 응답해 주세요. 심리척도와 주관적 평가는 웹에서 입력하지 않습니다. 종이 설문을 작성한 뒤 완료를 확인해 주세요.",payload:{paperSurveyTimeExcluded:true},idempotencyKey:"paper-survey-prompt-v2"});
      }
      const {data:messages,error:messagesError}=await db.from("trial_messages").select("*").eq("trial_id",active.id).order("created_at");
      if(messagesError)throw messagesError;
      active.trial_messages=messages??[];
    }
    for(const t of normalized){
      t.trial_phase_exposures=[...(t.trial_phase_exposures??[])].sort((a:any,b:any)=>a.phase.localeCompare(b.phase));
      t.trial_messages=[...(t.trial_messages??[])].sort((a:any,b:any)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime());
    }
    let searchState:any=null;let catalogOptions:any={categories:[],tags:[],eligibleCount:0};
    if(active&&p.role==="giver"){
      const {data:state,error:stateError}=await db.from("trial_search_states").select("*").eq("trial_id",active.id).maybeSingle();
      if(stateError)throw stateError;
      searchState=state;
      const {data:options,error:optionsError}=await db.from("product_catalog").select("category,search_tags_ko")
        .eq("dataset_version",EXPERIMENT.candidateVersion).eq("source_type","walmart_csv_snapshot").eq("experiment_eligible",true).eq("is_active",true)
        .contains("profile_codes",[active.recipient_profiles.profile_code]).lte("price_experiment",active.recipient_profiles.gift_budget);
      if(optionsError)throw optionsError;
      const available=options??[];
      const categories=[...new Set(available.map((x:any)=>x.category))].filter(category=>available.filter((x:any)=>x.category===category).length>=3);
      const tags=[...new Set(available.flatMap((x:any)=>x.search_tags_ko??[]))].filter(tag=>available.filter((x:any)=>(x.search_tags_ko??[]).includes(tag)).length>=3);
      catalogOptions={categories,tags,eligibleCount:available.length,items:available};
    }
    const relationshipCopy = active ? await loadApprovedRelationshipCopy(db) : null;
    return NextResponse.json({ participant: p, trials: normalized, activeTrial: active ?? null,stimulusSource:stimulus?.source_kind??null,searchState,catalogOptions,relationship:relationshipForParticipant(p.intimacy_condition,p.role,relationshipCopy),aiConfigured:p.role==="giver"?Boolean(process.env.ANTHROPIC_API_KEY):undefined });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "데이터를 불러오지 못했습니다." }, { status: 500 }); }
}
