import { mkdirSync, writeFileSync } from "node:fs";
import { dbClient } from "./common";
import { EXPERIMENT } from "../config/experiment";
import { validateWilliamsSequences } from "../lib/experiment/assignment";

const report:any={generatedAt:new Date().toISOString(),errors:[],checks:{}};
try{report.checks.williams=validateWilliamsSequences();}catch(e){report.errors.push(String(e));}
const db=dbClient();
const {data:participants,error}=await db.from("participants").select("id,participant_code,intimacy_condition,sequence_id,role,is_mock").eq("is_mock",true);
if(error)report.errors.push(error.message);
const ps=participants??[];
report.checks.mockParticipants={total:ps.length,high:ps.filter(p=>p.intimacy_condition==="high").length,low:ps.filter(p=>p.intimacy_condition==="low").length,cells:Object.fromEntries(["high","low"].flatMap(level=>["S1","S2","S3","S4"].map(seq=>[`${level}-${seq}`,ps.filter(p=>p.intimacy_condition===level&&p.sequence_id===seq).length])))};
if(ps.length!==40||report.checks.mockParticipants.high!==20||report.checks.mockParticipants.low!==20||Object.values(report.checks.mockParticipants.cells).some((n:any)=>n!==5))report.errors.push("Mock participant balance must be 20/20 with five in each intimacy-by-sequence cell.");
const counts={trials:0,conditions:0,profiles:0,candidates:0,responses:0,selections:0};
for(const p of ps){
  const {data:trials,error:te}=await db.from("trials").select("id,trial_number,profile_id,condition_id,execution_autonomy,decision_authority,is_mock").eq("participant_id",p.id).order("trial_number");
  if(te){report.errors.push(te.message);continue;}const ts=trials??[];counts.trials+=ts.length;
  const expected=EXPERIMENT.sequences[p.sequence_id as keyof typeof EXPERIMENT.sequences];
  if(ts.length!==4||ts.some((t,i)=>t.condition_id!==expected[i])||new Set(ts.map(t=>t.condition_id)).size!==4)report.errors.push(`${p.participant_code}: trial conditions/order do not match assigned sequence.`);
  if(new Set(ts.map(t=>t.profile_id)).size!==4)report.errors.push(`${p.participant_code}: must see four unique profiles.`);
  for(const t of ts){
    const {count:c}=await db.from("trial_candidates").select("id",{count:"exact",head:true}).eq("trial_id",t.id);counts.candidates+=c??0;if(c!==3)report.errors.push(`${p.participant_code}/${t.condition_id}: expected exactly three candidates.`);
    const {data:selection}=await db.from("final_selections").select("selected_by").eq("trial_id",t.id).maybeSingle();if(selection){counts.selections++;if(selection.selected_by!==t.decision_authority)report.errors.push(`${p.participant_code}/${t.condition_id}: selected_by does not match assigned authority.`);}else report.errors.push(`${p.participant_code}/${t.condition_id}: final selection missing.`);
    const {count:r}=await db.from("guided_responses").select("id",{count:"exact",head:true}).eq("trial_id",t.id);counts.responses+=r??0;const guided=t.execution_autonomy==="human_guided";if(guided&&r!==3)report.errors.push(`${p.participant_code}/${t.condition_id}: expected three guided responses.`);if(!guided&&r!==0)report.errors.push(`${p.participant_code}/${t.condition_id}: autonomous trial has guided responses.`);
    if(!t.is_mock)report.errors.push(`${p.participant_code}/${t.condition_id}: mock trial is missing is_mock flag.`);
  }
}
report.checks.mockRows=counts;
report.result=report.errors.length?"failed":"passed";
mkdirSync("reports",{recursive:true});writeFileSync("reports/experiment-validation.json",JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1;
