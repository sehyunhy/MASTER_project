import { dbClient, seedFixtures } from "./common";
import { EXPERIMENT } from "../config/experiment";
import { v6RosterSlot } from "../lib/experiment/assignment";

async function main() {
  if (EXPERIMENT.version !== "6.0.0") throw new Error("This roster is only for experiment version 6.0.0.");
  const blockIndex=process.argv.indexOf("--block");
  const blockNumber=blockIndex>=0?Number(process.argv[blockIndex+1]):NaN;
  if(!Number.isInteger(blockNumber)||blockNumber<1||blockNumber>6)throw new Error("Choose one enrollment block at a time: npm run seed:v6-roster -- --block 1 (through 6).");
  const db=dbClient();
  await seedFixtures(db);
  const sequences=Object.keys(EXPERIMENT.sequences);
  console.log(`Preparing enrollment block ${blockNumber}/6 (five participants).`);
  const firstIndex=(blockNumber-1)*EXPERIMENT.enrollmentBlockSize;
  const lastIndex=firstIndex+EXPERIMENT.enrollmentBlockSize;
  for(let index=firstIndex;index<lastIndex;index++){
    const number=index+1;
    const studyCode=`N${String(number).padStart(3,"0")}`;
    const block=Math.floor(index/5),withinBlock=index%5;
    const giverFirstSlots=new Set([0,1,4]);
    const roleOrder=(giverFirstSlots.has((withinBlock+block)%5)?["giver","recipient"]:["recipient","giver"]);
    const {sequenceId,profileRotationOffset}=v6RosterSlot(number-1,sequences);
    const {data:old,error:lookupError}=await db.from("research_subjects").select("*").eq("study_code",studyCode).maybeSingle();
    if(lookupError)throw lookupError;
    let subjectId=old?.id;
    if(old){
      if(old.role_order.join(",")!==roleOrder.join(",")||old.sequence_id!==sequenceId||old.profile_rotation_offset!==profileRotationOffset||old.experiment_version!==EXPERIMENT.version)
        throw new Error(`${studyCode} already has a different assignment; no existing assignment was changed.`);
    } else {
      const {data:created,error}=await db.from("research_subjects").insert({study_code:studyCode,role_order:roleOrder,sequence_id:sequenceId,profile_rotation_offset:profileRotationOffset,enrollment_block:block+1,experiment_version:EXPERIMENT.version}).select("id").single();
      if(error||!created)throw error??new Error(`Failed to assign ${studyCode}.`);
      subjectId=created.id;
    }
    for(let roleIndex=0;roleIndex<2;roleIndex++){
      const role=roleOrder[roleIndex] as "giver"|"recipient";
      const roleProfileOffset=(profileRotationOffset+(role==="recipient"?1:0))%4;
      const participantCode=`${studyCode}-${role==="giver"?"G":"R"}`;
      const {data:existingParticipant,error:participantLookupError}=await db.from("participants").select("id,role,sequence_id,experiment_version,is_mock,v6_roster").eq("participant_code",participantCode).maybeSingle();
      if(participantLookupError)throw participantLookupError;
      let participantId=existingParticipant?.id;
      if(existingParticipant){
        if(existingParticipant.role!==role||existingParticipant.sequence_id!==sequenceId||existingParticipant.experiment_version!==EXPERIMENT.version||existingParticipant.is_mock||!existingParticipant.v6_roster)
          throw new Error(`${participantCode} has a different assignment; no existing row was changed.`);
      } else {
        const {data:created,error}=await db.from("participants").insert({participant_code:participantCode,role,intimacy_condition:null,sequence_id:sequenceId,status:"assigned",experiment_version:EXPERIMENT.version,is_mock:false,v6_roster:true}).select("id").single();
        if(error||!created)throw error??new Error(`Failed to create ${participantCode}.`);
        participantId=created.id;
      }
      const {data:oldRole,error:roleLookupError}=await db.from("role_sessions").select("id,role_order_index,participant_id,profile_rotation_offset").eq("subject_id",subjectId).eq("role",role).maybeSingle();
      if(roleLookupError)throw roleLookupError;
      if(oldRole){
        if(oldRole.role_order_index!==roleIndex+1||oldRole.participant_id!==participantId||oldRole.profile_rotation_offset!==roleProfileOffset)throw new Error(`${studyCode} ${role} session conflicts with the roster.`);
      } else {
        const {error}=await db.from("role_sessions").insert({subject_id:subjectId,role,role_order_index:roleIndex+1,participant_id:participantId,profile_rotation_offset:roleProfileOffset,status:"assigned",next_trial_number:1});
        if(error)throw error;
      }
    }
  }
  console.log(`Prepared v6 research subjects ${firstIndex+1}–${lastIndex} in block ${blockNumber}/6. Existing assignments were not changed.`);
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
