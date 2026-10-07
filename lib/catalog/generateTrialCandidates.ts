import { createHash } from "node:crypto";
import { EXPERIMENT } from "@/config/experiment";
import { recommendCatalogItems } from "@/lib/catalog/recommend";

function snapshot(item:any) {
  return {
    id:item.id,source_product_id:item.source_product_id,sku:item.sku,
    product_name:item.product_name_ko??item.product_name_original,
    product_name_original:item.product_name_original,brand:item.brand,category:item.category,
    price:item.price_experiment,currency:item.currency_experiment,
    price_original:item.price_original,currency_original:item.currency_original,
    fx_rate_version:item.fx_rate_version,description:item.description_ko??item.description,
    description_original:item.description_original,image_url:item.image_url,
    specifications:item.specifications??{},source_url:item.source_url,
    source_timestamp:item.source_timestamp_raw,dataset_version:item.dataset_version,
    use_cases:item.use_cases??[],strengths:[],limitations:[],care_requirements:null,
    fit_reason:(item.use_cases??[])[0]??"원본 정보에 기반한 후보입니다.",
    source_type:item.source_type,is_mock:false,
  };
}

export async function generateTrialCandidates(db:any,trialId:string) {
  const {data:trial,error:trialError}=await db.from("trials")
    .select("id,profile_id,participant_id,experiment_version,dataset_version,scenario_id,condition_id,stimulus_id")
    .eq("id",trialId).single();
  if(trialError||!trial)throw trialError??new Error("Trial not found.");
  const [{data:profile,error:profileError},{data:participant,error:participantError},{data:state}] = await Promise.all([
    db.from("recipient_profiles").select("id,profile_code,gift_budget").eq("id",trial.profile_id).single(),
    db.from("participants").select("role").eq("id",trial.participant_id).single(),
    db.from("trial_search_states").select("*").eq("trial_id",trialId).maybeSingle(),
  ]);
  if(profileError||participantError||!profile||!participant)throw profileError??participantError??new Error("Profile missing.");
  let picked:any[]=[];
  let stimulus:any=null;
  if(participant.role==="recipient") {
    let stimulusQuery=db.from("recipient_stimuli").select("*").eq("scenario_id",trial.scenario_id).eq("review_status","approved");
    if(trial.stimulus_id)stimulusQuery=stimulusQuery.eq("id",trial.stimulus_id);
    const result=await stimulusQuery.order("version",{ascending:false}).limit(1).maybeSingle();
    if(result.error)throw result.error;
    stimulus=result.data;
    if(!stimulus||!stimulus.frozen_at)throw new Error(`선물 받는 사람 시나리오 ${trial.scenario_id}의 검토·동결된 자극이 없습니다. 연구자가 상품과 대화를 확인해야 합니다.`);
    const ids=(stimulus.candidate_snapshots??[]).map((p:any)=>p.source_product_id);
    if(ids.length!==3||new Set(ids).size!==3||!ids.includes(stimulus.final_source_product_id))throw new Error("동결 자극의 세 후보와 최종 상품을 확인해 주세요.");
    const {data:rows,error}=await db.from("product_catalog").select("*").eq("dataset_version",EXPERIMENT.candidateVersion).in("source_product_id",ids).eq("experiment_eligible",true);
    if(error)throw error;
    picked=ids.map((id:string)=>(rows??[]).find((row:any)=>row.source_product_id===id));
    if(picked.some(item=>!item))throw new Error("동결 자극의 상품이 현재 카탈로그에 없습니다.");
    const frozen=stimulus.candidate_snapshots;
    for(let i=0;i<3;i++){
      const current=snapshot(picked[i]);
      if(current.source_product_id!==frozen[i].source_product_id||Number(current.price)!==Number(frozen[i].price)||current.image_url!==frozen[i].image_url||current.product_name_original!==frozen[i].product_name_original||JSON.stringify(current.specifications)!==JSON.stringify(frozen[i].specifications))
        throw new Error("동결 상품 정보와 DB가 다릅니다. 연구자가 자극 버전을 재검토해야 합니다.");
    }
  } else {
    const {data:catalog,error}=await db.from("product_catalog").select("*")
      .eq("dataset_version",EXPERIMENT.candidateVersion).eq("source_type","walmart_csv_snapshot")
      .eq("experiment_eligible",true).eq("is_active",true)
      .contains("profile_codes",[profile.profile_code]).lte("price_experiment",profile.gift_budget);
    if(error)throw error;
    const tags:string[]=state?.preference_tags??[];
    const filtered=(catalog??[]).filter((item:any)=>(!state?.selected_category||item.category===state.selected_category)
      &&(!tags.length||tags.some(tag=>(item.search_tags_ko??[]).includes(tag))));
    picked=recommendCatalogItems(filtered,profile.profile_code,{priority:state?.selection_priorities?.[0]},Number(profile.gift_budget));
  }
  if(picked.length!==3)throw new Error(`프로필 ${profile.profile_code}의 적합한 실제 상품이 3개 미만입니다. 추가 자료가 필요합니다.`);
  const snapshots=stimulus?.candidate_snapshots??picked.map(snapshot);
  const candidateSetHash=createHash("sha256").update(JSON.stringify(snapshots)).digest("hex");
  const candidateSetId=stimulus?.id??`walmart-${trial.id}-${candidateSetHash.slice(0,12)}`;
  const {data:existing,error:existingError}=await db.from("trial_candidates").select("gift_candidate_id,display_order,product_snapshot").eq("trial_id",trialId).order("display_order");
  if(existingError)throw existingError;
  if(existing?.length){
    if(existing.length!==3||JSON.stringify(existing.map((x:any)=>x.product_snapshot))!==JSON.stringify(snapshots))throw new Error("이미 저장된 후보 집합이 현재 자극과 다릅니다.");
    return {candidates:existing.map((x:any)=>({gift_candidate_id:x.gift_candidate_id,display_order:x.display_order,product_snapshot:x.product_snapshot})),candidateSetId,candidateSetHash,stimulus};
  }
  const result=[];
  for(let index=0;index<3;index++){
    const item=picked[index], productSnapshot=snapshots[index];
    const {data:candidate,error:candidateError}=await db.from("gift_candidates").upsert({
      profile_id:profile.id,candidate_set_id:candidateSetId,product_catalog_id:item.id,
      product_name:productSnapshot.product_name,category:item.category,price:item.price,
      description:item.description,fit_reason:productSnapshot.fit_reason,
      preference_score:null,practicality_score:null,budget_score:null,overall_score:null,
      image_url:item.image_url,product_snapshot:productSnapshot,version:EXPERIMENT.candidateVersion,is_mock:false,
    },{onConflict:"profile_id,candidate_set_id,product_name"}).select("id").single();
    if(candidateError||!candidate)throw candidateError??new Error("후보 저장 실패");
    const {error:linkError}=await db.from("trial_candidates").upsert({
      trial_id:trialId,gift_candidate_id:candidate.id,display_order:index+1,product_snapshot:productSnapshot,
      is_mock:false,is_simulated:participant.role==="recipient",
    },{onConflict:"trial_id,gift_candidate_id"});
    if(linkError)throw linkError;
    result.push({gift_candidate_id:candidate.id,display_order:index+1,product_snapshot:productSnapshot});
  }
  const {error:updateError}=await db.from("trials").update({candidate_set_hash:candidateSetHash,stimulus_id:stimulus?.id??null,stimulus_version:stimulus?.version??1,stimulus_source:stimulus?.source_kind??"participant_live"}).eq("id",trialId);
  if(updateError)throw updateError;
  return {candidates:result,candidateSetId,candidateSetHash,stimulus};
}
