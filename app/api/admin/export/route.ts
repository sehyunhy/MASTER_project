import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

const rawTables = ["study_people","study_products","study_stimuli","study_trials","study_messages","study_events","study_survey_responses"] as const;
function csvCell(value:unknown) {
  let text=typeof value==="string"?value:JSON.stringify(value??"");
  if (/^[\s]*[=+@-]/.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function csv(rows:Record<string,unknown>[],columns:string[]) {
  return [columns.join(","),...rows.map(row=>columns.map(column=>csvCell(row[column])).join(","))].join("\n");
}
async function allRows(db:ReturnType<typeof supabaseAdmin>,table:string) {
  const rows:any[]=[];
  for(let offset=0;;offset+=1000) {
    const {data,error}=await db.from(table).select("*")
      .order(table==="study_products"?"source_product_id":"id").range(offset,offset+999);
    if(error)throw error;
    rows.push(...(data??[]));
    if(!data||data.length<1000)break;
  }
  return rows;
}
function metricRows(trials:any[],events:any[],people:any[],surveys:any[]) {
  const byTrial=new Map<string,any[]>();
  for(const event of events) if(event.trial_id) {
    let bucket=byTrial.get(event.trial_id);
    if(!bucket){bucket=[];byTrial.set(event.trial_id,bucket);}
    bucket.push(event);
  }
  const personById=new Map(people.map(person=>[person.id,person]));
  const surveyByTrial=new Map(surveys.filter(item=>item.trial_id&&item.form_section==="posttrial")
    .map(item=>[item.trial_id,item]));
  return trials.map(trial=>{
    const list=byTrial.get(trial.id)??[];
    const count=(type:string)=>list.filter(event=>event.event_type===type).length;
    const matching=(type:string)=>list.filter(event=>event.event_type===type);
    const inTask=(event:any)=>["candidates","decision"].includes(
      event.payload?.opened_phase??event.phase_at_capture??event.phase);
    const sumDuration=(type:string)=>{
      const items=matching(type);
      return items.length?items.reduce((sum,event)=>sum+Number(event.payload?.duration_ms||0),0):null;
    };
    const maxDepth=(type:string)=>{
      const items=matching(type);
      return items.length?Math.max(...items.map(event=>Number(event.payload?.percent||0))):null;
    };
    const dwellEvents=matching("candidate_dwell");
    const dwell=dwellEvents
      .reduce((sum,event)=>sum+Number(event.payload?.duration_ms||0),0);
    const taskDuration=(type:string)=>{
      const items=matching(type).filter(inTask);
      return items.length?items.reduce((sum,event)=>sum+Number(event.payload?.duration_ms||0),0):null;
    };
    const byProduct=(type:string,field?:string)=>{
      const result:Record<string,number>={};
      for(const event of list.filter(event=>event.event_type===type&&event.target)) {
        const amount=field?Number(event.payload?.[field]||0):1;
        result[event.target]=(result[event.target]??0)+amount;
      }
      return result;
    };
    const candidateLatency=list.filter(event=>["candidate_proposed","candidate_batch_ready"].includes(event.event_type))
      .reduce((sum,event)=>sum+Number(event.payload?.latency_ms||0),0);
    const openEvents=list.filter(event=>["candidate_opened","candidate_revisited"].includes(event.event_type)&&event.target);
    const taskOpenEvents=openEvents.filter(inTask);
    const openCounts:Record<string,number>={};
    for(const event of openEvents) openCounts[event.target]=(openCounts[event.target]??0)+1;
    const revisitCounts=Object.fromEntries(Object.entries(openCounts).map(([productId,total])=>[productId,Math.max(0,total-1)]));
    const finalLatency=list.filter(event=>event.event_type==="final_selection"&&event.payload?.actor==="agent")
      .reduce((sum,event)=>sum+Number(event.payload?.latency_ms||0),0);
    const person=personById.get(trial.person_id);
    const survey=surveyByTrial.get(trial.id);
    const cardExposure=matching("candidate_card_exposure");
    const scriptedExposure=matching("message_exposure").filter(event=>event.payload?.origin==="scripted");
    const firstSelection=list.find(event=>event.event_type==="decision_draft_saved"&&event.payload?.source_product_id);
    return {
      person_id:trial.person_id,participant_number:trial.participant_number??person?.participant_number??null,
      enrollment_number:person?.enrollment_number??null,
      enrollment_block:person?.enrollment_block??null,condition_order:person?.condition_order??null,
      role:trial.role,role_code:trial.role==="giver"?"P01":"P02",
      trial_id:trial.id,condition:trial.condition,order_position:trial.order_position,
      candidate_builder:trial.candidate_builder,decision_actor:trial.decision_actor,
      profile_code:trial.profile_code,phase:trial.phase,stimulus_id:trial.stimulus_id,
      candidate_ids:(trial.candidate_snapshots??[]).map((item:any)=>item.source_product_id),
      final_product_id:trial.final_product_id,final_actor:trial.final_actor,
      final_reason:trial.final_reason,candidates_effective_ms:trial.candidates_effective_ms,
      decision_effective_ms:trial.decision_effective_ms,
      human_selection_latency_ms:trial.final_actor==="human"&&trial.role==="giver"&&trial.final_at&&trial.phase_started_at
        ?Math.max(0,new Date(trial.final_at).getTime()-new Date(trial.phase_started_at).getTime()):null,
      candidate_detail_dwell_ms:dwellEvents.length?dwell:null,candidate_open_count:openEvents.length,
      candidate_detail_dwell_task_ms:taskDuration("candidate_dwell"),
      candidate_open_task_count:taskOpenEvents.length,
      candidate_card_exposure_ms:cardExposure.length?byProduct("candidate_card_exposure","duration_ms"):null,
      candidate_card_exposure_total_ms:sumDuration("candidate_card_exposure"),
      candidate_card_exposure_task_ms:taskDuration("candidate_card_exposure"),
      comparison_exposure_ms:sumDuration("comparison_exposure"),
      comparison_exposure_task_ms:taskDuration("comparison_exposure"),
      comparison_scroll_max_percent:maxDepth("comparison_scroll_depth"),
      chat_scroll_max_percent:maxDepth("chat_scroll_depth"),
      candidate_detail_scroll_max_percent:maxDepth("candidate_detail_scroll_depth"),
      candidate_revisit_count:openEvents.length-Object.keys(openCounts).length,
      candidate_dwell_by_id_ms:dwellEvents.length?byProduct("candidate_dwell","duration_ms"):null,
      candidate_open_by_id:openCounts,
      candidate_revisit_by_id:revisitCounts,
      prompt_edit_count:count("prompt_input"),candidate_request_count:count("candidate_request_sent"),
      prompt_snapshot_count:count("prompt_changed"),prompt_paste_count:count("prompt_pasted"),
      prompt_focus_count:count("prompt_focused"),
      candidate_confirm_count:count("candidate_confirmed"),
      candidate_proposal_count:count("candidate_proposed"),
      candidate_batch_count:count("candidate_batch_ready"),
      candidate_confirmation_attempt_count:count("candidate_confirmation_attempt"),
      candidate_confirmation_cancel_count:count("candidate_confirmation_cancelled"),
      selection_change_count:count("selection_changed"),reason_edit_count:count("reason_input"),
      reason_snapshot_count:count("reason_changed"),reason_paste_count:count("reason_pasted"),
      reason_focus_count:count("reason_focused"),
      first_selection_at:firstSelection?.server_at??null,
      first_choice_effective_ms:firstSelection?.payload?.phase_effective_ms??null,
      selection_draft_count:count("selection_draft"),
      finalize_attempt_count:count("finalize_attempt"),action_rejection_count:count("action_rejected"),
      first_choice_latency_ms:trial.role==="giver"&&trial.decision_actor==="human"&&trial.candidates_ended_at&&
        firstSelection?.server_at
          ?Math.max(0,new Date(firstSelection.server_at).getTime()-
            new Date(trial.candidates_ended_at).getTime()):null,
      agent_operation_failure_count:count("agent_operation_failed"),
      agent_operation_success_count:count("agent_operation_completed"),
      agent_operation_wait_ms:count("agent_operation_completed")+count("agent_operation_failed")
        ?list.filter(event=>["agent_operation_completed","agent_operation_failed"].includes(event.event_type))
          .reduce((sum,event)=>sum+Number(event.payload?.latency_ms||0),0):null,
      agent_failed_latency_ms:count("agent_operation_failed")
        ?matching("agent_operation_failed").reduce((sum,event)=>sum+Number(event.payload?.latency_ms||0),0):null,
      agent_candidate_latency_ms:count("candidate_proposed")+count("candidate_batch_ready")?candidateLatency:null,
      agent_final_latency_ms:list.some(event=>event.event_type==="final_selection"&&event.payload?.actor==="agent")?finalLatency:null,
      phase_timeout_count:count("phase_timeout"),timeout_phase:trial.timeout_phase,
      skipped_at:trial.skipped_at,condition_skip_count:count("condition_skipped_after_timeout"),
      tab_leave_count:count("tab_hidden"),
      window_blur_count:count("window_blurred"),connection_loss_count:count("connection_lost"),
      reconnect_count:count("connection_restored"),
      page_reload_count:list.filter(event=>event.event_type==="page_loaded"&&event.payload?.navigation_type==="reload").length,
      scripted_message_exposure_ms:scriptedExposure.length
        ?scriptedExposure.reduce((sum,event)=>sum+Number(event.payload?.duration_ms||0),0):null,
      message_exposure_total_ms:sumDuration("message_exposure"),
      message_exposure_task_ms:taskDuration("message_exposure"),
      message_exposure_by_id_ms:count("message_exposure")?byProduct("message_exposure","duration_ms"):null,
      candidate_image_failure_count:count("candidate_image_failed"),
      telemetry_v2_count:list.filter(event=>event.event_schema_version===2).length,
      page_unload_count:count("page_unloaded"),page_restore_count:count("page_restored"),
      action_request_count:count("action_requested"),
      error_count:count("agent_error")+count("error"),event_count:list.length,
      survey_completed_at:trial.survey_completed_at,
      survey_response_entered_at:survey?.entered_at??null,
      survey_response_updated_at:survey?.updated_at??null,
      survey_revision_count:survey?Array.isArray(survey.revision_history)?survey.revision_history.length:0:null,
      survey_form_version:survey?.form_version??null,
      survey_answer_count:survey?Object.keys(survey.answers??{}).length:null,
      operator_review_needed:trial.operator_review_needed,
      experiment_version:list[0]?.experiment_version??null,
    };
  });
}
export async function GET(request:Request) {
  if(!process.env.ADMIN_PASSWORD||request.headers.get("x-admin-password")!==process.env.ADMIN_PASSWORD)
    return NextResponse.json({error:"관리자 인증이 필요합니다."},{status:401});
  const name=new URL(request.url).searchParams.get("name")??"";
  if(!rawTables.includes(name as any)&&name!=="study_metrics")
    return NextResponse.json({error:"지원하지 않는 CSV입니다."},{status:400});
  try {
    const db=supabaseAdmin();
    let rows:Record<string,unknown>[];
    if(name==="study_metrics") {
      const [trials,events,people,surveys]=await Promise.all([
        allRows(db,"study_trials"),allRows(db,"study_events"),allRows(db,"study_people"),
        allRows(db,"study_survey_responses"),
      ]);
      rows=metricRows(trials,events,people,surveys);
    } else rows=await allRows(db,name);
    const defaultColumns=name==="study_metrics"?["person_id","role","trial_id","condition","phase","candidates_effective_ms","decision_effective_ms"]:[];
    const columns=Object.keys(rows[0]??Object.fromEntries(defaultColumns.map(column=>[column,""])));
    return new Response("\ufeff"+csv(rows,columns),{headers:{
      "content-type":"text/csv; charset=utf-8",
      "content-disposition":`attachment; filename="${name}.csv"`,
      "cache-control":"no-store",
    }});
  } catch(cause) {
    console.error("Study export failed",cause);
    return NextResponse.json({error:"CSV를 만들지 못했습니다."},{status:500});
  }
}
