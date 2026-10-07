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
  const profiles=PROFILES.map(p=>({...p,profile_code:p.id,version:EXPERIMENT.profileVersion}));
  const {data:oldProfiles,error:prErr}=await db.from("recipient_profiles").select("id");if(prErr)throw prErr;const profileSet=new Set((oldProfiles??[]).map(x=>x.id));const newProfiles=profiles.filter(x=>!profileSet.has(x.id));if(newProfiles.length){const {error:pe}=await db.from("recipient_profiles").insert(newProfiles);if(pe)throw pe;}
  return { sequences: seqRows.length, profiles: profiles.length };
}
