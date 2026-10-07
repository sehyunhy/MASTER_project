import { dbClient, seedFixtures } from "./common";
import { EXPERIMENT } from "../config/experiment";
const db=dbClient();
await seedFixtures(db);
const rows=[] as any[];
for(let i=1;i<=40;i++){
  const groupIndex=i<=20?i-1:i-21;
  rows.push({participant_code:`P${String(i).padStart(3,"0")}`,role:process.env.PARTICIPANT_ROLE==="recipient"?"recipient":"giver",intimacy_condition:i<=20?"high":"low",sequence_id:`S${Math.floor(groupIndex/5)+1}`,status:"assigned",experiment_version:EXPERIMENT.version,is_mock:false});
}
const {data:existing,error:lookupError}=await db.from("participants").select("participant_code").like("participant_code","P___").eq("is_mock",false);
if(lookupError)throw lookupError;
const existingCodes=new Set((existing??[]).map(p=>p.participant_code));
const missing=rows.filter(p=>!existingCodes.has(p.participant_code));
if(missing.length){const {error}=await db.from("participants").insert(missing);if(error)throw error;}
console.log(`Provisioned ${missing.length} new real slots (${process.env.PARTICIPANT_ROLE??"giver"}; high/low 20 each, 5 per sequence cell). Existing assignments were preserved.`);
