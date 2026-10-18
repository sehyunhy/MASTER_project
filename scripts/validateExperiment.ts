import { mkdirSync, writeFileSync } from "node:fs";
import { dbClient } from "./common";
import { EXPERIMENT } from "../config/experiment";
import { profileAt, validateWilliamsSequences, v6RosterSlot } from "../lib/experiment/assignment";

async function main(){
  if(EXPERIMENT.version!=="6.0.0")throw new Error("Validation is for experiment version 6.0.0 only.");
  const db=dbClient();
  const report:any={generatedAt:new Date().toISOString(),experimentVersion:EXPERIMENT.version,errors:[],warnings:[],checks:{}};
  report.checks.sequences=validateWilliamsSequences();
  const sequenceIds=Object.keys(EXPERIMENT.sequences);
  const roster=[] as any[];
  for(let i=0;i<30;i++)roster.push(v6RosterSlot(i,sequenceIds));
  report.checks.roster={subjects:roster.length,blocks:6,blockSize:5,expectedConditionProfileRange:[7,8]};
  const conditionProfile=new Map<string,number>();
  for(const slot of roster){
    const sequence=EXPERIMENT.sequences[slot.sequenceId as keyof typeof EXPERIMENT.sequences];
    sequence.forEach((condition,index)=>{
      const key=`${condition}:${profileAt(index+1,slot.profileRotationOffset,EXPERIMENT.profileVersion)}`;
      conditionProfile.set(key,(conditionProfile.get(key)??0)+1);
    });
  }
  const rosterCounts=[...conditionProfile.values()];
  if(conditionProfile.size!==16||Math.min(...rosterCounts)!==7||Math.max(...rosterCounts)!==8)report.errors.push("Roster condition×profile cells are not balanced 7–8.");
  const [{data:profiles,error:profileError},{data:catalog,error:catalogError},{data:stimuli,error:stimulusError},{data:trials,error:trialError},{data:subjects,error:subjectError}]=await Promise.all([
    db.from("recipient_profiles").select("id,profile_code,gift_budget,version").eq("version",EXPERIMENT.profileVersion),
    db.from("product_catalog").select("source_product_id,profile_codes,price_experiment,experiment_eligible,is_active,dataset_version,source_type"),
    db.from("v6_stimuli").select("id,scenario_id,profile_id,profile_version,condition_id,version,candidate_snapshots,candidate_order,final_source_product_id,transcript,review_status,frozen_at,content_hash"),
    db.from("trials").select("id,participant_id,trial_number,condition_position,profile_id,profile_version,scenario_id,condition_id,candidate_builder,candidate_mode,decision_authority,status,completion_outcome,stimulus_id,stimulus_version,stimulus_source,candidate_set_hash,final_selections(selected_by,selected_candidate_id,is_simulated,participant_reason_text),trial_candidates(gift_candidate_id,product_snapshot,display_order,is_simulated),v6_phase_records(phase,phase_status,effective_exposure_ms,end_reason),v6_candidate_requests(slot_number,request_revision,status,source_product_id,product_snapshot,request_text),event_logs(event_type,event_origin,actor_type,simulated_actor_event),participants!inner(role,participant_code,experiment_version,intimacy_condition)").eq("experiment_version",EXPERIMENT.version).limit(10000),
    db.from("research_subjects").select("study_code,enrollment_block,role_order,sequence_id,profile_rotation_offset,current_role_index,status,experiment_version"),
  ]);
  for(const [name,error] of [["profiles",profileError],["catalog",catalogError],["v6_stimuli",stimulusError],["trials",trialError],["research_subjects",subjectError]] as const)if(error)report.errors.push(`${name}: ${error.message}`);
  if(report.errors.length)throw new Error("Required v6 tables could not be checked.");
  if(profiles?.length!==4)report.errors.push(`Expected 4 v6 profiles, found ${profiles?.length??0}.`);
  const usable=(catalog??[]).filter((row:any)=>row.dataset_version===EXPERIMENT.candidateVersion&&row.source_type==="walmart_csv_snapshot"&&row.experiment_eligible&&row.is_active);
  report.checks.catalog={datasetVersion:EXPERIMENT.candidateVersion,usableRows:usable.length,byProfile:{}};
  for(const profile of profiles??[]){
    const count=usable.filter((row:any)=>(row.profile_codes??[]).includes(profile.profile_code)&&Number(row.price_experiment)<=Number(profile.gift_budget)).length;
    report.checks.catalog.byProfile[profile.profile_code]=count;
    if(count<3)report.errors.push(`${profile.profile_code}: only ${count} eligible products under fixed budget.`);
  }
  const approved=(stimuli??[]).filter((row:any)=>row.review_status==="approved"&&row.frozen_at);
  report.checks.recipientStimuli={approved:approved.length,required:16};
  for(const profile of profiles??[])for(const condition of ["C1","C2","C3","C4"]){
    const rows=approved.filter((row:any)=>row.profile_id===profile.id&&row.profile_version===EXPERIMENT.profileVersion&&row.condition_id===condition);
    if(rows.length!==1)report.errors.push(`${profile.profile_code}/${condition}: expected one approved frozen stimulus, found ${rows.length}.`);
  }
  for(const profile of profiles??[]){
    const rows=approved.filter((row:any)=>row.profile_id===profile.id&&row.profile_version===EXPERIMENT.profileVersion);
    const baseline=rows[0];
    if(rows.length===4&&baseline&&!rows.every((row:any)=>JSON.stringify(row.candidate_order)===JSON.stringify(baseline.candidate_order)&&JSON.stringify(row.candidate_snapshots)===JSON.stringify(baseline.candidate_snapshots)&&row.final_source_product_id===baseline.final_source_product_id))report.errors.push(`${profile.profile_code}: recipient stimuli differ across conditions.`);
  }
  const subjectsByBlock=new Map<number,any[]>();
  for(const subject of subjects??[]){const block=Number(subject.enrollment_block);subjectsByBlock.set(block,[...(subjectsByBlock.get(block)??[]),subject]);}
  for(let block=1;block<=6;block++)if((subjectsByBlock.get(block)??[]).length!==5)report.warnings.push(`Enrollment block ${block} currently contains ${(subjectsByBlock.get(block)??[]).length} subjects (fill in batches of five).`);
  for(const [block,rows] of subjectsByBlock){const first=rows.filter((row:any)=>row.role_order?.[0]==="giver").length;if(rows.length===5&&first!==3)report.errors.push(`Enrollment block ${block}: expected 3 giver-first and 2 recipient-first sessions.`);}
  const conditionMap:any={C1:{candidate_builder:"human",candidate_mode:"human_sequential",decision_authority:"human"},C3:{candidate_builder:"agent",candidate_mode:"agent_batch",decision_authority:"human"},C2:{candidate_builder:"human",candidate_mode:"human_sequential",decision_authority:"agent"},C4:{candidate_builder:"agent",candidate_mode:"agent_batch",decision_authority:"agent"}};
  report.checks.trials={total:trials?.length??0,completed:0,giver:0,recipient:0};
  for(const trial of trials??[]){
    const participant=Array.isArray(trial.participants)?trial.participants[0]:trial.participants;
    if(!participant)continue;
    if(participant.experiment_version!=="6.0.0"||participant.intimacy_condition!==null)report.errors.push(`${participant.participant_code}/T${trial.trial_number}: v6 assignment/version or intimacy field mismatch.`);
    if(!trial.profile_version||!conditionMap[trial.condition_id]||Object.entries(conditionMap[trial.condition_id]).some(([key,value])=>(trial as any)[key]!==value))report.errors.push(`${participant.participant_code}/T${trial.trial_number}: condition authority mapping mismatch.`);
    report.checks.trials[participant.role]=(report.checks.trials[participant.role]??0)+1;
    const candidateRows=[...(trial.trial_candidates??[])].sort((a:any,b:any)=>a.display_order-b.display_order);
    const requests=trial.v6_candidate_requests??[];const selection=Array.isArray(trial.final_selections)?trial.final_selections[0]:trial.final_selections;
    if(["complete","timeout"].includes(trial.completion_outcome)&&trial.status==="completed")report.checks.trials.completed++;
    if(candidateRows.length>3||new Set(candidateRows.map((row:any)=>row.product_snapshot?.source_product_id)).size!==candidateRows.length)report.errors.push(`${participant.participant_code}/T${trial.trial_number}: candidate IDs duplicate or exceed three.`);
    if(trial.status==="completed"&&trial.completion_outcome!=="timeout"&&candidateRows.length!==3)report.errors.push(`${participant.participant_code}/T${trial.trial_number}: completed trial does not have three candidates.`);
    if(selection&&selection.selected_by!==trial.decision_authority)report.errors.push(`${participant.participant_code}/T${trial.trial_number}: final actor mismatch.`);
    if(participant.role==="giver"&&selection?.selected_by==="human"&&!selection.participant_reason_text)report.errors.push(`${participant.participant_code}/T${trial.trial_number}: human selection has no written reason.`);
    if(participant.role==="recipient"&&selection&&!selection.is_simulated)report.errors.push(`${participant.participant_code}/T${trial.trial_number}: recipient stimulus selection is not marked simulated.`);
    if(participant.role==="giver"&&trial.candidate_mode==="human_sequential"&&requests.some((row:any)=>row.status==="confirmed")&&requests.filter((row:any)=>row.status==="confirmed").length!==candidateRows.length)report.errors.push(`${participant.participant_code}/T${trial.trial_number}: confirmed request count does not match saved candidates.`);
    for(const phase of ["candidates","decision"]){const row=(trial.v6_phase_records??[]).find((item:any)=>item.phase===phase);if(trial.status==="completed"&&trial.completion_outcome!=="timeout"&&(!row||row.effective_exposure_ms<60000||row.effective_exposure_ms>180000))report.errors.push(`${participant.participant_code}/T${trial.trial_number}: ${phase} exposure outside 60–180 seconds.`);}
    if(participant.role==="recipient"){
      const stimulus=approved.find((row:any)=>row.id===trial.stimulus_id);
      if(!stimulus)report.errors.push(`${participant.participant_code}/T${trial.trial_number}: frozen stimulus is not pinned.`);
      else if(candidateRows.length===3&&JSON.stringify(candidateRows.map((row:any)=>row.product_snapshot?.source_product_id))!==JSON.stringify(stimulus.candidate_order))report.errors.push(`${participant.participant_code}/T${trial.trial_number}: displayed candidate IDs or order differ from stimulus.`);
      if((trial.event_logs??[]).some((event:any)=>event.actor_type==="simulated_giver"&&event.event_origin==="participant"))report.errors.push(`${participant.participant_code}/T${trial.trial_number}: simulated giver event classified as participant action.`);
    }
  }
  report.result=report.errors.length?"failed":report.warnings.length?"needs_review":"passed";
  mkdirSync("reports",{recursive:true});writeFileSync("reports/experiment-validation.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.errors.length)process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
