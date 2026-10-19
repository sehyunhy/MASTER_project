import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

const rawTables = ["study_people","study_products","study_stimuli","study_trials","study_messages","study_events"] as const;
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
function metricRows(trials:any[],events:any[],people:any[]) {
  const byTrial=new Map<string,any[]>();
  for(const event of events) if(event.trial_id) byTrial.set(event.trial_id,[...(byTrial.get(event.trial_id)??[]),event]);
  const personById=new Map(people.map(person=>[person.id,person]));
  return trials.map(trial=>{
    const list=byTrial.get(trial.id)??[];
    const count=(type:string)=>list.filter(event=>event.event_type===type).length;
    const dwell=list.filter(event=>event.event_type==="candidate_dwell")
      .reduce((sum,event)=>sum+Number(event.payload?.duration_ms||0),0);
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
    const openCounts:Record<string,number>={};
    for(const event of openEvents) openCounts[event.target]=(openCounts[event.target]??0)+1;
    const revisitCounts=Object.fromEntries(Object.entries(openCounts).map(([productId,total])=>[productId,Math.max(0,total-1)]));
    const finalLatency=list.filter(event=>event.event_type==="final_selection"&&event.payload?.actor==="agent")
      .reduce((sum,event)=>sum+Number(event.payload?.latency_ms||0),0);
    const person=personById.get(trial.person_id);
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
      candidate_detail_dwell_ms:dwell||null,candidate_open_count:openEvents.length,
      candidate_revisit_count:openEvents.length-Object.keys(openCounts).length,
      candidate_dwell_by_id_ms:byProduct("candidate_dwell","duration_ms"),
      candidate_open_by_id:openCounts,
      candidate_revisit_by_id:revisitCounts,
      prompt_edit_count:count("prompt_changed"),candidate_request_count:count("candidate_request_sent"),
      candidate_confirm_count:count("candidate_confirmed"),
      selection_change_count:count("selection_changed"),reason_edit_count:count("reason_changed"),
      agent_candidate_latency_ms:candidateLatency||null,agent_final_latency_ms:finalLatency||null,
      phase_timeout_count:count("phase_timeout"),timeout_phase:trial.timeout_phase,
      skipped_at:trial.skipped_at,condition_skip_count:count("condition_skipped_after_timeout"),
      tab_leave_count:count("tab_hidden"),
      reconnect_count:count("connection_restored")+count("reconnected"),
      error_count:count("agent_error")+count("error"),event_count:list.length,
      survey_completed_at:trial.survey_completed_at,operator_review_needed:trial.operator_review_needed,
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
      const [trials,events,people]=await Promise.all([
        allRows(db,"study_trials"),allRows(db,"study_events"),allRows(db,"study_people"),
      ]);
      rows=metricRows(trials,events,people);
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
