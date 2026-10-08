import { mkdirSync, writeFileSync } from "node:fs";
import { dbClient } from "./common";
import { EXPERIMENT } from "../config/experiment";
import { validateWilliamsSequences } from "../lib/experiment/assignment";

async function main(){
  const db=dbClient();
  const report:any={generatedAt:new Date().toISOString(),experimentVersion:EXPERIMENT.version,datasetVersion:EXPERIMENT.candidateVersion,errors:[],warnings:[],checks:{}};
  try{report.checks.williams=validateWilliamsSequences();}catch(e){report.errors.push(String(e));}
  const [{data:profiles,error:profileError},{data:catalog,error:catalogError},{data:stimuli,error:stimulusError},{data:trials,error:trialError}]=await Promise.all([
    db.from("recipient_profiles").select("profile_code,gift_budget").eq("version",EXPERIMENT.profileVersion),
    db.from("product_catalog").select("source_product_id,profile_codes,price_experiment,experiment_eligible,is_active,dataset_version,source_type"),
    db.from("recipient_stimuli").select("id,scenario_id,profile_code,version,source_kind,candidate_snapshots,final_source_product_id,review_status,frozen_at,candidate_set_hash"),
    db.from("trials").select("id,participant_id,trial_number,profile_id,scenario_id,condition_id,execution_autonomy,decision_authority,status,stimulus_id,stimulus_version,stimulus_source,candidate_set_hash,final_selections(selected_by,selected_candidate_id),trial_candidates(gift_candidate_id,product_snapshot,display_order),trial_phase_exposures(phase,accumulated_ms),event_logs(event_type,event_origin,actor_type,trial_number,phase),participants(role,participant_code,experiment_version)").eq("experiment_version",EXPERIMENT.version).limit(10000),
  ]);
  for(const [name,error] of [["profiles",profileError],["catalog",catalogError],["stimuli",stimulusError],["trials",trialError]] as const){if(error)report.errors.push(`${name}: ${error.message}`);}
  if(report.errors.length)throw new Error("필수 DB 테이블을 읽지 못했습니다.");
  const usable=(catalog??[]).filter((row:any)=>row.dataset_version===EXPERIMENT.candidateVersion&&row.source_type==="walmart_csv_snapshot"&&row.experiment_eligible&&row.is_active);
  report.checks.catalog={sourceRows:(catalog??[]).filter((row:any)=>row.dataset_version===EXPERIMENT.candidateVersion).length,usableRows:usable.length,byProfile:{}};
  for(const profile of profiles??[]){
    const count=usable.filter((row:any)=>(row.profile_codes??[]).includes(profile.profile_code)&&Number(row.price_experiment)<=Number(profile.gift_budget)).length;
    report.checks.catalog.byProfile[profile.profile_code]=count;
    if(count<3)report.errors.push(`${profile.profile_code}: 예산 내 검토 상품 ${count}개, 최소 3개 필요`);
  }
  const approved=(stimuli??[]).filter((row:any)=>row.review_status==="approved"&&row.frozen_at);
  const byScenario=new Map(approved.map((row:any)=>[row.scenario_id,row]));
  for(const profile of profiles??[]){
    const scenario=`gift-scenario-${profile.profile_code}`;
    if(!byScenario.has(scenario))report.errors.push(`${scenario}: 승인·동결된 수혜자 자극 없음`);
  }
  for(const stimulus of approved){
    const ids=(stimulus.candidate_snapshots??[]).map((item:any)=>item.source_product_id);
    if(ids.length!==3||new Set(ids).size!==3||!ids.includes(stimulus.final_source_product_id))report.errors.push(`${stimulus.id}: 후보·최종 상품 통제 위반`);
  }
  report.checks.trials={total:(trials??[]).length,completed:0,recipient:0,giver:0};
  for(const trial of trials??[]){
    const participant=Array.isArray(trial.participants)?trial.participants[0]:trial.participants;
    if(!participant)continue;
    report.checks.trials[participant.role]=(report.checks.trials[participant.role]??0)+1;
    if(trial.status!=="completed")continue;
    report.checks.trials.completed++;
    const key=`${participant.participant_code}/T${trial.trial_number}`;
    const candidates=[...(trial.trial_candidates??[])].sort((a:any,b:any)=>a.display_order-b.display_order);
    const selection=Array.isArray(trial.final_selections)?trial.final_selections[0]:trial.final_selections;
    if(candidates.length!==3)report.errors.push(`${key}: 후보 3개가 아님`);
    if(!selection||selection.selected_by!==trial.decision_authority)report.errors.push(`${key}: 최종 선택 주체가 배정과 다름`);
    for(const phase of ["criteria","candidates","comparison"]){
      const row=(trial.trial_phase_exposures??[]).find((item:any)=>item.phase===phase);
      if(!row||row.accumulated_ms<EXPERIMENT.minimumPhaseExposureMs)report.errors.push(`${key}: ${phase} 유효 노출 30초 미달`);
    }
    if(participant.role==="recipient"){
      const stimulus=approved.find((item:any)=>item.id===trial.stimulus_id);
      if(!stimulus)report.errors.push(`${key}: 승인 자극 미연결`);
      else{
        const expected=stimulus.candidate_snapshots.map((item:any)=>item.source_product_id);
        const actual=candidates.map((item:any)=>item.product_snapshot?.source_product_id);
        if(JSON.stringify(actual)!==JSON.stringify(expected))report.errors.push(`${key}: 조건 간 후보 스냅샷 불일치`);
        const selected=candidates.find((item:any)=>item.gift_candidate_id===selection?.selected_candidate_id);
        if(selected?.product_snapshot?.source_product_id!==stimulus.final_source_product_id)report.errors.push(`${key}: 동결 최종 상품 불일치`);
      }
      if((trial.event_logs??[]).some((event:any)=>event.event_type==="human_candidate_selected"||event.event_type==="human_candidate_changed"))report.errors.push(`${key}: 관찰자에게 선택 행동이 기록됨`);
      if((trial.event_logs??[]).some((event:any)=>event.actor_type==="simulated_giver"&&event.event_origin==="participant"))report.errors.push(`${key}: 스크립트 증여자 행동이 실제 참가자 행동으로 분류됨`);
    }
  }
  report.result=report.errors.length?"failed":"passed";
  mkdirSync("reports",{recursive:true});writeFileSync("reports/experiment-validation.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(report.errors.length)process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
