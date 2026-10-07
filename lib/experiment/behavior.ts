export type BehaviorEvent={event_type:string;event_target?:string|null;event_value?:string|null;client_timestamp?:string|null;server_timestamp?:string|null;created_at?:string|null;payload?:Record<string,any>|null;elapsed_ms?:number|null};
export type GuidedMetric={response_time_ms?:number|null;revision_count?:number|null;confirmed_at?:string|null;shown_at?:string|null;answered_at?:string|null};
const t=(e:BehaviorEvent)=>{const raw=e.client_timestamp||e.server_timestamp||e.created_at;return raw?new Date(raw).getTime():NaN;};
function intervals(events:BehaviorEvent[],start:number,end:number,from:string,to:string){const a=events.filter(e=>e.event_type===from).map(t).filter(Number.isFinite);const b=events.filter(e=>e.event_type===to).map(t).filter(Number.isFinite);return Math.max(0,Math.min(end,Math.max(...a,end))-Math.max(start,Math.min(...b,start)));}
function range(events:BehaviorEvent[],from:string,to:string):[number,number]|null{const a=events.filter(e=>e.event_type===from).map(t).filter(Number.isFinite);const b=events.filter(e=>e.event_type===to).map(t).filter(Number.isFinite);if(!a.length||!b.length)return null;return [Math.min(...a),Math.max(...b)];}
export function hiddenDuration(events:BehaviorEvent[],start:number,end:number){let hiddenAt:number|null=null;let total=0;for(const e of [...events].sort((a,b)=>t(a)-t(b))){const at=t(e);if(!Number.isFinite(at))continue;if(e.event_type==="page_hidden"&&hiddenAt===null)hiddenAt=at;if(e.event_type==="page_visible"&&hiddenAt!==null){total+=Math.max(0,Math.min(end,at)-Math.max(start,hiddenAt));hiddenAt=null;}}if(hiddenAt!==null)total+=Math.max(0,end-Math.max(start,hiddenAt));return total;}
export function activeDuration(events:BehaviorEvent[],start:number,end:number){return Math.max(0,end-start-hiddenDuration(events,start,end));}
export function deriveBehaviorMetrics(events:BehaviorEvent[],responses:GuidedMetric[],decisionAuthority:"human"|"agent",guided:boolean,completed:boolean){
  const sorted=[...events].sort((a,b)=>t(a)-t(b));const profile=range(sorted,"profile_shown","human_final_selection")??range(sorted,"profile_shown","agent_final_selection");const total=profile?Math.max(0,profile[1]-profile[0]):null;
  const inspection=range(sorted,"candidates_shown","comparison_shown");const comparison=range(sorted,"comparison_shown",decisionAuthority==="human"?"human_selection_screen_shown":"agent_selection_started");const choice=decisionAuthority==="human"?range(sorted,"human_selection_screen_shown","human_final_selection"):null;
  const inspectionRaw=inspection?Math.max(0,inspection[1]-inspection[0]):null;const inspectionActive=inspection?activeDuration(sorted,...inspection):null;
  const comparisonRaw=comparison?Math.max(0,comparison[1]-comparison[0]):null;const comparisonActive=comparison?activeDuration(sorted,...comparison):null;
  const choiceLatency=choice?Math.max(0,choice[1]-choice[0]):null;
  const guidedSum=guided&&responses.length?responses.reduce((n,r)=>n+(r.response_time_ms??0),0):null;
  const guidedActive=guided&&responses.length?responses.reduce((n,r)=>{const a=r.shown_at?new Date(r.shown_at).getTime():NaN;const b=r.answered_at?new Date(r.answered_at).getTime():NaN;return n+(Number.isFinite(a)&&Number.isFinite(b)?activeDuration(sorted,a,b):(r.response_time_ms??0));},0):null;
  const guidedMean=guidedSum!==null&&responses.length?guidedSum/responses.length:null;
  const guidedRevision=guided?responses.reduce((n,r)=>n+(r.revision_count??0),0):null;
  const humanActive=guided?((guidedActive??0)+(inspectionActive??0)+(comparisonActive??0)+(choiceLatency??0)):((inspectionActive??0)+(comparisonActive??0)+(choiceLatency??0));
  let processing=0;let processingAt:number|null=null;for(const e of sorted){const at=t(e);if(e.event_type==="system_processing_started"||e.event_type==="autonomous_processing_started"||e.event_type==="agent_selection_started")processingAt=at;if((e.event_type==="system_processing_completed"||e.event_type==="autonomous_processing_completed"||e.event_type==="agent_final_selection")&&processingAt!==null&&Number.isFinite(at)){processing+=Math.max(0,at-processingAt);processingAt=null;}}
  const count=(name:string)=>sorted.filter(e=>e.event_type===name).length;
  const opens=count("candidate_opened"),details=count("candidate_detail_viewed"),revisits=count("candidate_reopened");
  return {
    total_task_time_ms:total,total_task_time_sec:total===null?null:total/1000,
    human_active_time_ms:total===null?null:humanActive,system_processing_time_ms:processing,
    candidate_inspection_time_ms:inspectionRaw,active_candidate_inspection_time_ms:inspectionActive,
    candidate_interaction_count:opens+details,candidate_open_count:opens,candidate_detail_view_count:details,
    candidate_a_views:opens+details?sorted.filter(e=>(e.event_target??"").toUpperCase()==="A"&&["candidate_opened","candidate_detail_viewed"].includes(e.event_type)).length:0,
    candidate_b_views:sorted.filter(e=>(e.event_target??"").toUpperCase()==="B"&&["candidate_opened","candidate_detail_viewed"].includes(e.event_type)).length,
    candidate_c_views:sorted.filter(e=>(e.event_target??"").toUpperCase()==="C"&&["candidate_opened","candidate_detail_viewed"].includes(e.event_type)).length,
    candidate_revisit_count:revisits,comparison_time_ms:comparisonRaw,active_comparison_time_ms:comparisonActive,
    final_choice_latency_ms:decisionAuthority==="human"?choiceLatency:null,
    guided_total_response_time_ms:guided?guidedSum:null,guided_mean_response_time_ms:guided?guidedMean:null,
    guided_answer_revision_count:guided?guidedRevision:null,
    final_choice_revision_count:decisionAuthority==="human"?count("human_candidate_changed"):null,
    guided_question_count:count("guided_question_shown"),guided_answer_count:count("guided_answer_confirmed"),candidate_count:count("candidates_shown"),
    human_selection_event_count:count("human_final_selection"),agent_selection_event_count:count("agent_final_selection"),
    refresh_count:count("page_refreshed"),reconnect_count:count("connection_restored"),trial_restart_count:Math.max(0,count("trial_started")-1),duplicate_submission_count:count("duplicate_submission"),
    browser_visibility_change_count:count("page_hidden")+count("page_visible"),visibility_hidden_time_ms:total===null?0:hiddenDuration(sorted,profile?.[0]??0,profile?.[1]??0),error_count:count("error_occurred"),trial_completed:completed
  };
}
