import { EXPERIMENT } from "@/config/experiment";

/** Build every Claude call from the same assigned trial/profile used by the screen. */
export async function loadAgentSessionContext(db:any,trialId:string,candidateOverride?:any[]) {
  const {data:trial,error:trialError}=await db.from("trials").select("*").eq("id",trialId).single();
  if(trialError||!trial)throw trialError??new Error("TRIAL_MISSING");
  const [{data:participant,error:participantError},{data:profile,error:profileError},{data:state,error:stateError},{data:candidates,error:candidatesError},{data:messages,error:messagesError},{data:selection,error:selectionError}]=await Promise.all([
    db.from("participants").select("role").eq("id",trial.participant_id).single(),
    db.from("recipient_profiles").select("*").eq("id",trial.profile_id).single(),
    db.from("trial_search_states").select("*").eq("trial_id",trialId).maybeSingle(),
    db.from("trial_candidates").select("display_order,product_snapshot").eq("trial_id",trialId).order("display_order"),
    db.from("trial_messages").select("actor_type,phase,content").eq("trial_id",trialId).order("created_at",{ascending:false}).limit(12),
    db.from("final_selections").select("selected_candidate_id,selected_by").eq("trial_id",trialId).limit(1),
  ]);
  const error=participantError??profileError??stateError??candidatesError??messagesError??selectionError;
  if(error||!participant||!profile)throw error??new Error("PROFILE_OR_PARTICIPANT_MISSING");
  const {data:catalog,error:catalogError}=await db.from("product_catalog").select("category,search_tags_ko")
    .eq("dataset_version",EXPERIMENT.candidateVersion).eq("source_type","walmart_csv_snapshot")
    .eq("experiment_eligible",true).eq("is_active",true)
    .contains("profile_codes",[profile.profile_code]).lte("price_experiment",profile.gift_budget);
  if(catalogError)throw catalogError;
  const usedCandidates=candidateOverride??candidates??[];
  return {
    trialId,condition:trial.condition_id,phase:trial.current_phase,executionAutonomy:trial.execution_autonomy,
    decisionAuthority:trial.decision_authority,participantRole:participant.role,recipientRole:"recipient",
    stimulusVersion:trial.stimulus_version,scenarioId:trial.scenario_id,
    profile:{name:profile.name,age:profile.age,occupation:profile.occupation,hobbies:profile.hobbies,
      recentInterest:profile.recent_interest,preference:profile.preference,dislike:profile.dislike,
      giftOccasion:profile.gift_occasion,lifestyleContext:profile.lifestyle_context},
    budget:profile.gift_budget,category:state?.selected_category??null,
    criteria:state?.selection_priorities??[],freeTextCriteria:state?.query_text??"",tags:state?.preference_tags??[],
    excludedFeatures:state?.excluded_features??[],
    catalog:{datasetVersion:EXPERIMENT.candidateVersion,sourceType:"walmart_csv_snapshot",profileCode:profile.profile_code,
      allowedCategories:[...new Set((catalog??[]).map((item:any)=>item.category))],
      allowedTags:[...new Set((catalog??[]).flatMap((item:any)=>item.search_tags_ko??[]))],eligibleCount:catalog?.length??0},
    candidates:usedCandidates.map((item:any)=>item.product_snapshot??item),
    priorMessages:[...(messages??[])].reverse(),selection:selection?.[0]??null,
    permittedActions:{taskActor:trial.execution_autonomy==="human_guided"?"giver_request":"agent",
      decisionActor:trial.decision_authority},
  };
}
