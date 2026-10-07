import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { deriveBehaviorMetrics } from "@/lib/experiment/behavior";
import { EXPERIMENT } from "@/config/experiment";

const allowed=["participants","trials","guided_responses","gift_candidates","product_catalog","final_selections","event_logs","trial_messages","trial_phase_exposures","trial_search_states","recipient_stimuli","training_practice_checks","experiment_metadata","analysis_ready","behavior_analysis_ready"];
const csv=(rows:any[],columns:string[])=>[columns.join(","),...rows.map(row=>columns.map(column=>{
  const value=row[column];
  const text=typeof value==="string"?value:JSON.stringify(value??"");
  return "\""+text.replaceAll("\"","\"\"")+"\"";
}).join(","))].join("\n");
const selectionEvent=(events:any[])=>[...(events??[])].filter(event=>["human_final_selection","agent_final_selection"].includes(event.event_type)).sort((a,b)=>new Date(a.server_timestamp??a.created_at).getTime()-new Date(b.server_timestamp??b.created_at).getTime())[0];

export async function GET(request:Request){
  if(!process.env.ADMIN_PASSWORD||request.headers.get("x-admin-password")!==process.env.ADMIN_PASSWORD)return NextResponse.json({error:"관리자 인증이 필요합니다."},{status:401});
  const name=new URL(request.url).searchParams.get("name")??"";
  if(!allowed.includes(name))return NextResponse.json({error:"지원하지 않는 CSV입니다."},{status:400});
  try{
    const db=supabaseAdmin();let rows:any[]=[],columns:string[]=[];
    if(name==="analysis_ready"||name==="behavior_analysis_ready"){
      const {data,error}=await db.from("trials").select("id,participant_id,trial_number,profile_id,condition_id,execution_autonomy,decision_authority,status,started_at,completed_at,experiment_version,ui_version,profile_version,candidate_version,prompt_version,sequence_version,scenario_id,dataset_version,model_version,is_mock,stimulus_id,stimulus_version,stimulus_source,candidate_set_hash,participants(id,participant_code,role,intimacy_condition,sequence_id,training_attempts,experiment_version),recipient_profiles(profile_code),final_selections(selected_by,selected_candidate_id,selected_at),trial_candidates(gift_candidate_id,product_snapshot,gift_candidates(product_name,product_catalog_id)),event_logs(event_type,event_target,event_value,client_timestamp,server_timestamp,created_at,elapsed_ms,elapsed_from_trial_start_ms,effective_exposure_ms,phase,actor_type,event_origin,transcript_id,stimulus_version,input_mode,intent,task_id,message_id,simulated_actor_event,payload,payload_json),guided_responses(question_id,response_time_ms,revision_count,confirmed_at,shown_at,answered_at),trial_phase_exposures(phase,content_ready_at,accumulated_ms,threshold_met_at,completed_at,paused_at)").order("participant_id").order("trial_number");
      if(error)throw error;
      rows=(data??[]).map((trial:any)=>{
        const participant=Array.isArray(trial.participants)?trial.participants[0]:trial.participants;
        const profile=Array.isArray(trial.recipient_profiles)?trial.recipient_profiles[0]:trial.recipient_profiles;
        const selection=Array.isArray(trial.final_selections)?trial.final_selections[0]:trial.final_selections;
        const chosen=trial.trial_candidates?.find((candidate:any)=>candidate.gift_candidate_id===selection?.selected_candidate_id);
        const snapshot=chosen?.product_snapshot??{};
        const exposures=Object.fromEntries((trial.trial_phase_exposures??[]).map((item:any)=>[item.phase,item]));
        const events=trial.event_logs??[];
        const chosenEvent=selectionEvent(events);
        const finalAt=chosenEvent?.server_timestamp??chosenEvent?.created_at??selection?.selected_at;
        const paperSurveyDuration=finalAt&&trial.completed_at?Math.max(0,new Date(trial.completed_at).getTime()-new Date(finalAt).getTime()):null;
        const base={
          participant_trial_key:participant?.participant_code+"_T"+trial.trial_number,
          participant_id:trial.participant_id,participant_code:participant?.participant_code,role:participant?.role,
          intimacy_condition:participant?.intimacy_condition,sequence_id:participant?.sequence_id,trial_number:trial.trial_number,
          profile_id:trial.profile_id,profile_code:profile?.profile_code,condition_id:trial.condition_id,
          execution_autonomy:trial.execution_autonomy,decision_authority:trial.decision_authority,
          selected_product_catalog_id:snapshot.id??chosen?.gift_candidates?.product_catalog_id??"",
          selected_source_product_id:snapshot.source_product_id??"",
          selected_product_name:snapshot.product_name??chosen?.gift_candidates?.product_name??"",
          selected_by:selection?.selected_by??"",selected_product_snapshot:snapshot,
          criteria_effective_exposure_ms:exposures.criteria?.accumulated_ms??"",
          candidates_effective_exposure_ms:exposures.candidates?.accumulated_ms??"",
          comparison_effective_exposure_ms:exposures.comparison?.accumulated_ms??"",
          minimum_policy_exposure_ms_per_phase:EXPERIMENT.minimumPhaseExposureMs,
          criteria_post_threshold_delay_ms:exposures.criteria?.threshold_met_at&&exposures.criteria?.completed_at?Math.max(0,new Date(exposures.criteria.completed_at).getTime()-new Date(exposures.criteria.threshold_met_at).getTime()):"",
          candidates_post_threshold_delay_ms:exposures.candidates?.threshold_met_at&&exposures.candidates?.completed_at?Math.max(0,new Date(exposures.candidates.completed_at).getTime()-new Date(exposures.candidates.threshold_met_at).getTime()):"",
          comparison_post_threshold_delay_ms:exposures.comparison?.threshold_met_at&&exposures.comparison?.completed_at?Math.max(0,new Date(exposures.comparison.completed_at).getTime()-new Date(exposures.comparison.threshold_met_at).getTime()):"",
          decision_time_ms:trial.started_at&&finalAt?Math.max(0,new Date(finalAt).getTime()-new Date(trial.started_at).getTime()):"",
          paper_survey_confirmation_time_ms:paperSurveyDuration,
          training_attempts:participant?.training_attempts,experiment_version:trial.experiment_version,ui_version:trial.ui_version,
          profile_version:trial.profile_version,candidate_version:trial.candidate_version,prompt_version:trial.prompt_version,
          dataset_version:trial.dataset_version,model_version:trial.model_version,scenario_id:trial.scenario_id,is_mock:trial.is_mock,
          stimulus_id:trial.stimulus_id,stimulus_version:trial.stimulus_version,stimulus_source:trial.stimulus_source,candidate_set_hash:trial.candidate_set_hash,
        };
        if(name==="analysis_ready")return base;
        const metrics=deriveBehaviorMetrics(events,trial.guided_responses??[],trial.decision_authority,trial.execution_autonomy==="human_guided",trial.status==="completed");
        const actual=events.filter((event:any)=>event.event_origin==="participant");
        const observerCorrection=participant?.role==="recipient"?{human_active_time_ms:null,active_human_time_ms:null,final_choice_latency_ms:null,final_choice_revision_count:null,guided_question_count:0,guided_answer_count:0,human_selection_event_count:0,agent_selection_event_count:0}:{};
        return {...base,...metrics,...observerCorrection,actual_recipient_action_count:participant?.role==="recipient"?actual.length:null,scripted_event_count:events.filter((event:any)=>["scripted","recorded"].includes(event.event_origin)).length,raw_trial_duration_ms:trial.started_at&&trial.completed_at?Math.max(0,new Date(trial.completed_at).getTime()-new Date(trial.started_at).getTime()):"",paper_survey_duration_ms:paperSurveyDuration,phase_exposure_records:exposures};
      });
      columns=Object.keys(rows[0]??{participant_trial_key:"",participant_id:"",participant_code:"",trial_number:"",condition_id:"",criteria_effective_exposure_ms:"",is_mock:""});
    } else if(name==="experiment_metadata"){
      rows=[{experiment_version:EXPERIMENT.version,ui_version:EXPERIMENT.uiVersion,profile_version:EXPERIMENT.profileVersion,candidate_version:EXPERIMENT.candidateVersion,prompt_version:EXPERIMENT.promptVersion,sequence_version:EXPERIMENT.sequenceVersion,dataset_version:EXPERIMENT.candidateVersion,giver_model_version:process.env.ANTHROPIC_MODEL??"unconfigured",recipient_mode:"frozen_researcher_script",candidate_mode:"walmart_csv_reviewed_subset",minimum_phase_exposure_ms:EXPERIMENT.minimumPhaseExposureMs}];
      columns=Object.keys(rows[0]);
    } else {
      const {data,error}=await db.from(name).select("*").limit(10000);
      if(error)throw error;rows=data??[];columns=Object.keys(rows[0]??{});
    }
    return new NextResponse("\ufeff"+csv(rows,columns),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=\""+name+".csv\""}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"CSV 내보내기 실패"},{status:500});}
}
