import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { deriveBehaviorMetrics } from "@/lib/experiment/behavior";
import { EXPERIMENT } from "@/config/experiment";
import { anthropicModel } from "@/lib/agent/model";

const allowed=["participants","trials","guided_responses","gift_candidates","product_catalog","final_selections","event_logs","trial_messages","trial_phase_exposures","trial_search_states","recipient_stimuli","training_practice_checks","experiment_metadata","analysis_ready","behavior_analysis_ready","research_subjects","role_sessions","v5_phase_records","v5_surveys","v5_transition_attempts","v5_stimuli","v5_analysis_ready","v6_phase_records","v6_candidate_requests","v6_transition_attempts","v6_stimuli","v6_analysis_ready"];
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
    if(name==="v6_analysis_ready"){
      const [{data:trials,error:trialError},{data:phases,error:phaseError},{data:events,error:eventError},{data:selections,error:selectionError},{data:links,error:linkError},{data:people,error:peopleError},{data:subjects,error:subjectError},{data:sessions,error:sessionError},{data:surveys,error:surveyError},{data:requests,error:requestError}]=await Promise.all([
        db.from("trials").select("id,participant_id,trial_number,condition_position,profile_id,condition_id,candidate_builder,candidate_mode,decision_authority,status,completion_outcome,started_at,completed_at,experiment_version,ui_version,profile_version,candidate_version,prompt_version,sequence_version,scenario_id,dataset_version,model_version,stimulus_id,stimulus_version,stimulus_source,candidate_set_hash,final_decision_source,agent_reason_text").eq("experiment_version","6.0.0").order("participant_id").order("trial_number"),
        db.from("v6_phase_records").select("trial_id,phase,phase_status,started_at,ended_at,end_reason,effective_exposure_ms,paused_at"),
        db.from("event_logs").select("id,participant_id,trial_id,event_type,event_target,event_value,client_timestamp,server_timestamp,created_at,elapsed_ms,elapsed_from_trial_start_ms,effective_exposure_ms,phase,actor_type,event_origin,idempotency_key,task_id,message_id,stimulus_version,experiment_version,payload,payload_json").eq("experiment_version","6.0.0").order("server_timestamp"),
        db.from("final_selections").select("trial_id,selected_by,selected_candidate_id,selected_at,is_simulated,participant_reason_text,reason_created_at,reason_confirmed_at"),
        db.from("trial_candidates").select("trial_id,gift_candidate_id,display_order,product_snapshot,is_simulated"),
        db.from("participants").select("id,participant_code,role,sequence_id,experiment_version,v6_roster"),
        db.from("research_subjects").select("id,study_code,role_order,sequence_id,profile_rotation_offset,current_role_index,status,experiment_version,enrollment_block"),
        db.from("role_sessions").select("id,subject_id,role,role_order_index,participant_id,status,next_trial_number,profile_rotation_offset,started_at,completed_at"),
        db.from("v5_surveys").select("trial_id,status,started_at,submitted_at,paper_completed_at"),
        db.from("v6_candidate_requests").select("trial_id,slot_number,request_revision,status,request_text,source_product_id,claude_model,claude_response_id,claude_latency_ms,prompt_version,created_at,proposed_at,confirmed_at,error_code"),
      ]);
      for(const error of [trialError,phaseError,eventError,selectionError,linkError,peopleError,subjectError,sessionError,surveyError,requestError])if(error)throw error;
      const group=(source:any[]|null,key:string)=>{const map=new Map<string,any[]>();for(const row of source??[])map.set(row[key],[...(map.get(row[key])??[]),row]);return map;};
      const phasesByTrial=group(phases,"trial_id"),eventsByTrial=group(events,"trial_id"),linksByTrial=group(links,"trial_id"),requestsByTrial=group(requests,"trial_id");
      const participantById=new Map((people??[]).map((row:any)=>[row.id,row]));const sessionByParticipant=new Map((sessions??[]).map((row:any)=>[row.participant_id,row]));const subjectById=new Map((subjects??[]).map((row:any)=>[row.id,row]));const selectionByTrial=new Map((selections??[]).map((row:any)=>[row.trial_id,row]));const surveyByTrial=new Map((surveys??[]).map((row:any)=>[row.trial_id,row]));
      rows=(trials??[]).map((trial:any)=>{
        const person:any=participantById.get(trial.participant_id);const session:any=sessionByParticipant.get(trial.participant_id);const subject:any=subjectById.get(session?.subject_id);const phaseRows=phasesByTrial.get(trial.id)??[];const eventRows=eventsByTrial.get(trial.id)??[];const productRows=(linksByTrial.get(trial.id)??[]).sort((a:any,b:any)=>a.display_order-b.display_order);const requestRows=(requestsByTrial.get(trial.id)??[]).sort((a:any,b:any)=>a.created_at-b.created_at);const selection:any=selectionByTrial.get(trial.id);const survey:any=surveyByTrial.get(trial.id);
        const phaseMs=(phase:string)=>phaseRows.find((row:any)=>row.phase===phase)?.effective_exposure_ms??null;const finalCandidate=productRows.find((row:any)=>row.gift_candidate_id===selection?.selected_candidate_id);
        const decisionPhase=phaseRows.find((row:any)=>row.phase==="decision");const eventCount=(type:string)=>eventRows.filter((row:any)=>row.event_type===type).length;
        return {study_code:subject?.study_code??null,enrollment_block:subject?.enrollment_block??null,participant_id:trial.participant_id,participant_code:person?.participant_code??null,role:person?.role??null,role_order_index:session?.role_order_index??null,trial_id:trial.id,trial_number:trial.trial_number,condition_position:trial.condition_position,condition_id:trial.condition_id,condition_label:({C1:"A",C3:"B",C2:"C",C4:"D"} as Record<string,string>)[trial.condition_id]??null,candidate_builder:trial.candidate_builder,candidate_mode:trial.candidate_mode,decision_authority:trial.decision_authority,profile_id:trial.profile_id,scenario_id:trial.scenario_id,status:trial.status,completion_outcome:trial.completion_outcome,candidate_product_ids:productRows.map((row:any)=>row.product_snapshot?.source_product_id??null),candidate_display_order:productRows.map((row:any)=>row.display_order),candidate_snapshots:productRows.map((row:any)=>row.product_snapshot),selected_source_product_id:finalCandidate?.product_snapshot?.source_product_id??null,selected_by:selection?.selected_by??null,is_simulated_selection:selection?.is_simulated??null,participant_reason_text:selection?.participant_reason_text??null,reason_created_at:selection?.reason_created_at??null,reason_confirmed_at:selection?.reason_confirmed_at??null,agent_reason_text:trial.agent_reason_text??null,candidates_effective_exposure_ms:phaseMs("candidates"),decision_effective_exposure_ms:phaseMs("decision"),phase_records:phaseRows,candidate_request_count:requestRows.length,candidate_request_revision_count:requestRows.filter((row:any)=>row.request_revision>1).length,candidate_requests:requestRows,prompt_submission_count:requestRows.length,agent_candidate_latency_ms:requestRows.reduce((sum:number,row:any)=>sum+(Number(row.claude_latency_ms)||0),0)||null,human_candidate_confirmation_count:eventCount("human_candidate_confirmed"),candidate_detail_open_count:eventCount("candidate_opened"),candidate_revisit_count:eventCount("candidate_revisited")+eventCount("candidate_reopened"),measured_candidate_detail_dwell_ms:eventRows.filter((row:any)=>row.event_type==="candidate_closed"&&Number.isFinite(Number(row.payload?.dwellMs))).reduce((sum:number,row:any)=>sum+Number(row.payload.dwellMs),0),human_selection_latency_ms:selection?.selected_by==="human"&&!selection.is_simulated&&decisionPhase?.started_at?Math.max(0,new Date(selection.selected_at).getTime()-new Date(decisionPhase.started_at).getTime()):null,timeout:eventRows.some((row:any)=>row.event_type==="phase_timeout"),visibility_loss_count:eventRows.filter((row:any)=>["page_hidden","connection_lost"].includes(row.event_type)).length,reconnect_count:eventRows.filter((row:any)=>["page_visible","connection_restored"].includes(row.event_type)).length,error_count:eventCount("error_occurred"),survey_status:survey?.status??null,paper_completed_at:survey?.paper_completed_at??null,experiment_version:trial.experiment_version,ui_version:trial.ui_version,profile_version:trial.profile_version,candidate_version:trial.candidate_version,prompt_version:trial.prompt_version,sequence_version:trial.sequence_version,dataset_version:trial.dataset_version,model_version:trial.model_version,stimulus_id:trial.stimulus_id,stimulus_version:trial.stimulus_version,stimulus_source:trial.stimulus_source,candidate_set_hash:trial.candidate_set_hash,event_count:eventRows.length,raw_event_ids:eventRows.map((row:any)=>row.id)};
      });
      columns=Object.keys(rows[0]??{study_code:"",participant_code:"",role:"",trial_id:"",condition_id:"",candidate_mode:"",candidate_builder:"",decision_authority:"",candidates_effective_exposure_ms:"",decision_effective_exposure_ms:""});
    } else if(name==="v5_analysis_ready"){
      const [{data:trials,error:trialError},{data:phases,error:phaseError},{data:events,error:eventError},{data:selections,error:selectionError},{data:links,error:linkError},{data:people,error:peopleError},{data:subjects,error:subjectError},{data:sessions,error:sessionError},{data:surveys,error:surveyError}]=await Promise.all([
        db.from("trials").select("id,participant_id,trial_number,profile_id,condition_id,condition_position,candidate_builder,decision_authority,status,completion_outcome,started_at,completed_at,experiment_version,ui_version,profile_version,candidate_version,prompt_version,sequence_version,scenario_id,dataset_version,model_version,is_mock,stimulus_id,stimulus_version,stimulus_source,candidate_set_hash,final_decision_source").eq("experiment_version","5.0.0").order("participant_id").order("trial_number"),
        db.from("v5_phase_records").select("trial_id,phase,phase_status,started_at,ended_at,end_reason,effective_exposure_ms,paused_at"),
        db.from("event_logs").select("id,participant_id,trial_id,event_type,event_target,event_value,client_timestamp,server_timestamp,created_at,elapsed_ms,elapsed_from_trial_start_ms,effective_exposure_ms,phase,actor_type,event_origin,idempotency_key,task_id,message_id,stimulus_version,experiment_version,experiment_ui_version,payload,payload_json").eq("experiment_version","5.0.0").order("server_timestamp"),
        db.from("final_selections").select("trial_id,selected_by,selected_candidate_id,selected_at,is_simulated"),
        db.from("trial_candidates").select("trial_id,gift_candidate_id,display_order,product_snapshot,is_simulated"),
        db.from("participants").select("id,participant_code,role,sequence_id,experiment_version,v5_roster"),
        db.from("research_subjects").select("id,study_code,role_order,sequence_id,profile_rotation_offset,current_role_index,status,experiment_version"),
        db.from("role_sessions").select("id,subject_id,role,role_order_index,participant_id,status,next_trial_number,profile_rotation_offset,started_at,completed_at"),
        db.from("v5_surveys").select("trial_id,status,survey_version,started_at,submitted_at,paper_completed_at,is_mock"),
      ]);
      for(const error of [trialError,phaseError,eventError,selectionError,linkError,peopleError,subjectError,sessionError,surveyError])if(error)throw error;
      const phasesByTrial=new Map<string,any[]>(),eventsByTrial=new Map<string,any[]>(),linksByTrial=new Map<string,any[]>();
      for(const [source,map] of [[phases,phasesByTrial],[events,eventsByTrial],[links,linksByTrial]] as const)for(const item of source??[]){const key=item.trial_id;map.set(key,[...(map.get(key)??[]),item]);}
      const participantById=new Map((people??[]).map((p:any)=>[p.id,p]));
      const sessionByParticipant=new Map((sessions??[]).map((s:any)=>[s.participant_id,s]));
      const subjectById=new Map((subjects??[]).map((s:any)=>[s.id,s]));
      const selectionByTrial=new Map((selections??[]).map((s:any)=>[s.trial_id,s]));
      const surveyByTrial=new Map((surveys??[]).map((s:any)=>[s.trial_id,s]));
      const phaseMs=(items:any[],phase:string)=>items.find((x:any)=>x.phase===phase)?.effective_exposure_ms??null;
      const stamp=(item:any)=>new Date(item.server_timestamp??item.created_at??item.client_timestamp??0).getTime();
      rows=(trials??[]).map((trial:any)=>{
        const person:any=participantById.get(trial.participant_id);const session:any=sessionByParticipant.get(trial.participant_id);const subject:any=subjectById.get(session?.subject_id);
        const items=eventsByTrial.get(trial.id)??[];const phaseItems=phasesByTrial.get(trial.id)??[];const products=(linksByTrial.get(trial.id)??[]).sort((a:any,b:any)=>a.display_order-b.display_order);
        const selection:any=selectionByTrial.get(trial.id);const survey:any=surveyByTrial.get(trial.id);
        const selected=products.find((item:any)=>item.gift_candidate_id===selection?.selected_candidate_id);
        const userPrompts=items.filter((event:any)=>event.event_type==="chat_message_submitted");
        const humanChoiceEvents=items.filter((event:any)=>event.event_type==="human_candidate_selected"||event.event_type==="human_candidate_changed");
        const agentTaskStarts=new Map<string,number>();let agentProcessing=0;
        for(const event of [...items].sort((a:any,b:any)=>stamp(a)-stamp(b))){if(!event.task_id)continue;if(event.event_type==="agent_task_started")agentTaskStarts.set(event.task_id,stamp(event));if(event.event_type==="agent_task_completed"&&agentTaskStarts.has(event.task_id)){agentProcessing+=Math.max(0,stamp(event)-(agentTaskStarts.get(event.task_id)??stamp(event)));agentTaskStarts.delete(event.task_id);}}
        const detailDwell=items.filter((event:any)=>event.event_type==="candidate_closed"&&Number.isFinite(Number(event.payload?.dwellMs))).reduce((sum:number,event:any)=>sum+Number(event.payload.dwellMs),0);
        const roleSession:any=session;const study:any=subject;
        return {
          study_code:study?.study_code??null,participant_id:trial.participant_id,participant_code:person?.participant_code??null,role:person?.role??null,role_session_id:roleSession?.id??null,role_order_index:roleSession?.role_order_index??null,
          condition_position:trial.condition_position,trial_id:trial.id,trial_number:trial.trial_number,condition_id:trial.condition_id,candidate_builder:trial.candidate_builder,decision_authority:trial.decision_authority,
          completion_outcome:trial.completion_outcome??(trial.status==="completed"?"complete":null),trial_status:trial.status,profile_id:trial.profile_id,scenario_id:trial.scenario_id,
          candidate_product_ids:products.map((x:any)=>x.product_snapshot?.source_product_id??null),candidate_display_order:products.map((x:any)=>x.display_order),candidate_snapshots:products.map((x:any)=>x.product_snapshot),
          selected_candidate_id:selection?.selected_candidate_id??null,selected_source_product_id:selected?.product_snapshot?.source_product_id??null,selected_at:selection?.selected_at??null,selected_by:selection?.selected_by??null,is_simulated_selection:selection?.is_simulated??null,
          criteria_effective_exposure_ms:phaseMs(phaseItems,"criteria"),candidates_effective_exposure_ms:phaseMs(phaseItems,"candidates"),comparison_effective_exposure_ms:phaseMs(phaseItems,"comparison"),decision_effective_exposure_ms:phaseMs(phaseItems,"decision"),phase_records:phaseItems,
          criteria_end_reason:phaseItems.find((x:any)=>x.phase==="criteria")?.end_reason??null,candidates_end_reason:phaseItems.find((x:any)=>x.phase==="candidates")?.end_reason??null,comparison_end_reason:phaseItems.find((x:any)=>x.phase==="comparison")?.end_reason??null,decision_end_reason:phaseItems.find((x:any)=>x.phase==="decision")?.end_reason??null,
          candidate_card_open_count:items.filter((e:any)=>e.event_type==="candidate_opened").length,candidate_revisit_count:items.filter((e:any)=>["candidate_revisited","candidate_reopened"].includes(e.event_type)).length,candidate_detail_views:items.filter((e:any)=>e.event_type==="candidate_detail_viewed").length,measured_candidate_detail_dwell_ms:detailDwell,
          prompt_submission_count:userPrompts.length,prompt_revision_count:null,human_selection_change_count:humanChoiceEvents.filter((e:any)=>e.event_type==="human_candidate_changed").length,
          human_selection_latency_ms:trial.decision_authority==="human"&&selection?.selected_by==="human"&&phaseItems.find((x:any)=>x.phase==="decision")?.started_at?Math.max(0,new Date(selection.selected_at).getTime()-new Date(phaseItems.find((x:any)=>x.phase==="decision").started_at).getTime()):null,
          agent_processing_time_ms:agentProcessing||null,agent_processing_measurement:"sum of server-timestamped agent_task_started/completed pairs",
          visibility_loss_count:items.filter((e:any)=>e.event_type==="page_hidden"||e.event_type==="connection_lost").length,reconnect_count:items.filter((e:any)=>e.event_type==="page_visible"||e.event_type==="connection_restored").length,error_count:items.filter((e:any)=>e.event_type==="error_occurred").length,
          survey_status:survey?.status??null,survey_started_at:survey?.started_at??null,survey_submitted_at:survey?.submitted_at??null,paper_completed_at:survey?.paper_completed_at??null,
          experiment_version:trial.experiment_version,ui_version:trial.ui_version,profile_version:trial.profile_version,candidate_version:trial.candidate_version,prompt_version:trial.prompt_version,sequence_version:trial.sequence_version,dataset_version:trial.dataset_version,model_version:trial.model_version,stimulus_id:trial.stimulus_id,stimulus_version:trial.stimulus_version,stimulus_source:trial.stimulus_source,candidate_set_hash:trial.candidate_set_hash,
          event_count:items.length,raw_event_ids:items.map((e:any)=>e.id),
        };
      });
      columns=Object.keys(rows[0]??{study_code:"",participant_code:"",role:"",condition_position:"",trial_id:"",condition_id:"",candidate_builder:"",decision_authority:"",criteria_effective_exposure_ms:"",event_count:""});
    } else
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
      rows=[{experiment_version:EXPERIMENT.version,ui_version:EXPERIMENT.uiVersion,profile_version:EXPERIMENT.profileVersion,candidate_version:EXPERIMENT.candidateVersion,prompt_version:EXPERIMENT.promptVersion,sequence_version:EXPERIMENT.sequenceVersion,dataset_version:EXPERIMENT.candidateVersion,giver_model_version:anthropicModel(),recipient_mode:"frozen_researcher_script",candidate_mode:"walmart_csv_reviewed_subset",minimum_phase_exposure_ms:EXPERIMENT.minimumPhaseExposureMs}];
      columns=Object.keys(rows[0]);
    } else {
      const {data,error}=await db.from(name).select("*").limit(10000);
      if(error)throw error;rows=data??[];columns=Object.keys(rows[0]??{});
    }
    return new NextResponse("\ufeff"+csv(rows,columns),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=\""+name+".csv\""}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"CSV 내보내기 실패"},{status:500});}
}
