import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { createClient } from "@supabase/supabase-js";
import { PROFILES, EXPERIMENT } from "../config/experiment";
import { supabaseServerEnvironment } from "../lib/supabase/env";

export function dbClient() {
  const {url,key}=supabaseServerEnvironment();
  if (!url || !key) throw new Error("Set Supabase URL and server secret key in .env.local first.");
  return createClient(url, key, { auth: { persistSession: false } });
}
export async function seedFixtures(db: ReturnType<typeof dbClient>) {
  const seqRows = Object.entries(EXPERIMENT.sequences).map(([id,s])=>({id,sequence_name:id,position_1:s[0],position_2:s[1],position_3:s[2],position_4:s[3],version:EXPERIMENT.sequenceVersion}));
  const {data:oldSeq,error:sqErr}=await db.from("experiment_sequences").select("id");if(sqErr)throw sqErr;const seqSet=new Set((oldSeq??[]).map(x=>x.id));const newSeq=seqRows.filter(x=>!seqSet.has(x.id));if(newSeq.length){const {error:se}=await db.from("experiment_sequences").insert(newSeq);if(se)throw se;}
  const profiles=PROFILES.map(p=>({id:p.id,profile_code:p.id,name:p.name,age:p.age,gender:p.gender,occupation:null,
    hobbies:p.hobbies,recent_interest:p.recent_interest,preference:p.preference,dislike:p.dislike,
    lifestyle_context:p.lifestyle_context,gift_budget:p.gift_budget,gift_occasion:p.gift_occasion,
    participant_text:p.participant_text,source_provenance:{source_uuid:p.source_uuid,source_file:"gift_stimuli_relationship_types_v3.json",
      editorial_change:"researcher assigned gender replaces occupation; original JSON retained"},version:EXPERIMENT.profileVersion}));
  const {data:oldProfiles,error:prErr}=await db.from("recipient_profiles").select("id");if(prErr)throw prErr;const profileSet=new Set((oldProfiles??[]).map(x=>x.id));const newProfiles=profiles.filter(x=>!profileSet.has(x.id));if(newProfiles.length){const {error:pe}=await db.from("recipient_profiles").insert(newProfiles);if(pe)throw pe;}
  return { sequences: seqRows.length, profiles: profiles.length };
}
