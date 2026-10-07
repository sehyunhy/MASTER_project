import { dbClient, seedFixtures } from "./common";
import { EXPERIMENT } from "../config/experiment";
import { randomUUID } from "node:crypto";
const db=dbClient();
await db.from("participants").delete().like("participant_code","MOCK-P%");
const candidateCount=await seedFixtures(db);
const participantRows=[] as any[];
for(let i=1;i<=40;i++){const g=i<=20?i-1:i-21;participantRows.push({participant_code:`MOCK-P${String(i).padStart(3,"0")}`,role:i%5===0?"recipient":"giver",intimacy_condition:i<=20?"high":"low",sequence_id:`S${Math.floor(g/5)+1}`,status:i>38?"active":"completed",experiment_version:EXPERIMENT.version,started_at:new Date(Date.UTC(2026,8,10,9+i)).toISOString(),completed_at:i>38?null:new Date(Date.UTC(2026,8,10,10+i)).toISOString(),is_mock:true,training_attempts:i%9===0?2:1});}
const {data:participants,error:pe}=await db.from("participants").insert(participantRows).select("id,participant_code,sequence_id,intimacy_condition,role");if(pe)throw pe;
const {data:profiles}=await db.from("recipient_profiles").select("id");
const profileIds=(profiles??[]).map(p=>p.id); const trialRows=[] as any[]; const trialInfo=new Map<string,any>();
for(const p of participants??[]){const seq=EXPERIMENT.sequences[p.sequence_id as keyof typeof EXPERIMENT.sequences];const seqNo=Number(p.sequence_id.slice(-1))-1;for(let j=0;j<4;j++){const condition=seq[j];const id=randomUUID(); const profile=profileIds[(j+seqNo)%4];const autonomy=condition==="C1"||condition==="C2"?"human_guided":"agent_autonomous";const authority=condition==="C1"||condition==="C3"?"human":"agent";trialRows.push({id,participant_id:p.id,trial_number:j+1,profile_id:profile,condition_id:condition,execution_autonomy:autonomy,decision_authority:authority,status:p.participant_code.endsWith("039")&&j===3?"active":"completed",started_at:new Date(Date.UTC(2026,8,10,9+j*2)).toISOString(),completed_at:new Date(Date.UTC(2026,8,10,9+j*2,1,20)).toISOString(),experiment_version:EXPERIMENT.version,is_mock:true});trialInfo.set(id,{participant:p,condition,profile,authority,j});}}
const {error:te}=await db.from("trials").insert(trialRows);if(te)throw te;
const {data:allCandidates}=await db.from("gift_candidates").select("id,profile_id,candidate_set_id").eq("candidate_set_id","set-v1");
const links=[] as any[],selections=[] as any[],responses=[] as any[],events=[] as any[];
for(const t of trialRows){const inf=trialInfo.get(t.id);const options=(allCandidates??[]).filter(c=>c.profile_id===inf.profile);options.slice(0,3).forEach((c,i)=>links.push({trial_id:t.id,gift_candidate_id:c.id,display_order:i+1,is_mock:true}));if(options.length)selections.push({trial_id:t.id,selected_candidate_id:options[inf.j%3].id,selected_by:inf.authority,is_mock:true});
  if(inf.condition==="C1"||inf.condition==="C2")for(let q=0;q<3;q++)responses.push({trial_id:t.id,question_id:EXPERIMENT.questions[q].id,question_text:EXPERIMENT.questions[q].text,answer_value:EXPERIMENT.questions[q].options[(inf.j+q)%3],shown_at:new Date(Date.UTC(2026,8,10,9+inf.j*2)).toISOString(),answered_at:new Date(Date.UTC(2026,8,10,9+inf.j*2,0,8+q*3)).toISOString(),response_time_ms:8000+q*3000,is_mock:true});
  for(const eventType of ["trial_started","profile_shown","candidates_shown","comparison_viewed",inf.authority==="human"?"human_final_selection":"agent_final_selection","paper_survey_confirmed_complete","trial_completed"])events.push({participant_id:inf.participant.id,trial_id:t.id,role:inf.participant.role,trial_number:inf.j+1,profile_id:inf.profile,condition_id:inf.condition,intimacy_condition:inf.participant.intimacy_condition,sequence_id:inf.participant.sequence_id,event_type:eventType,payload:{synthetic:true},created_at:new Date(Date.UTC(2026,8,10,9+inf.j*2,0,Math.min(events.length%50,59))).toISOString(),elapsed_ms:5000+events.length*3,experiment_version:EXPERIMENT.version,is_mock:true});
}
const batch=async(table:string,rows:any[])=>{for(let i=0;i<rows.length;i+=500){const {error}=await db.from(table).insert(rows.slice(i,i+500));if(error)throw error;}};
await batch("trial_candidates",links);await batch("final_selections",selections);await batch("guided_responses",responses);await batch("event_logs",events);
const training=[] as any[];
for(const p of participants??[]){const n=p.participant_code.endsWith("009")||p.participant_code.endsWith("018")||p.participant_code.endsWith("027")||p.participant_code.endsWith("036")?2:1;for(let a=1;a<=n;a++)training.push({participant_id:p.id,attempt_number:a,score:a<n?3:4,passed:a===n,responses:["yes","ai","no","user"],is_mock:true});}
await batch("training_attempts",training);
console.log(JSON.stringify({mockParticipants:participantRows.length,trials:trialRows.length,finalSelections:selections.length,guidedResponses:responses.length,trainingAttempts:training.length,candidateRecords:candidateCount,eventLogs:events.length,totalRows:participantRows.length+trialRows.length+selections.length+responses.length+training.length+candidateCount+events.length}));
