import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { createClient } from "@supabase/supabase-js";
import { PROFILES, CANDIDATES, EXPERIMENT } from "../config/experiment";

export function dbClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set Supabase URL and server secret key in .env.local first.");
  return createClient(url, key, { auth: { persistSession: false } });
}
export async function seedFixtures(db: ReturnType<typeof dbClient>) {
  const seqRows = Object.entries(EXPERIMENT.sequences).map(([id,s])=>({id,sequence_name:id,position_1:s[0],position_2:s[1],position_3:s[2],position_4:s[3],version:EXPERIMENT.sequenceVersion}));
  const {data:oldSeq,error:sqErr}=await db.from("experiment_sequences").select("id");if(sqErr)throw sqErr;const seqSet=new Set((oldSeq??[]).map(x=>x.id));const newSeq=seqRows.filter(x=>!seqSet.has(x.id));if(newSeq.length){const {error:se}=await db.from("experiment_sequences").insert(newSeq);if(se)throw se;}
  const profiles=PROFILES.map(p=>({...p,profile_code:p.id,version:EXPERIMENT.profileVersion}));
  const {data:oldProfiles,error:prErr}=await db.from("recipient_profiles").select("id");if(prErr)throw prErr;const profileSet=new Set((oldProfiles??[]).map(x=>x.id));const newProfiles=profiles.filter(x=>!profileSet.has(x.id));if(newProfiles.length){const {error:pe}=await db.from("recipient_profiles").insert(newProfiles);if(pe)throw pe;}
  const rows=[] as any[];
  for(const [profileId,candidates] of Object.entries(CANDIDATES)) for(const c of candidates) rows.push({profile_id:profileId,candidate_set_id:"set-v1",product_name:c.product_name,category:c.category,price:c.price,description:c.description,fit_reason:c.fit_reason,preference_score:c.preference_score,practicality_score:c.practicality_score,budget_score:c.budget_score,overall_score:c.overall_score,version:EXPERIMENT.candidateVersion,is_mock:false});
  const {data:oldCandidates,error:caErr}=await db.from("gift_candidates").select("profile_id,candidate_set_id,product_name").eq("candidate_set_id","set-v1");if(caErr)throw caErr;const candidateSet=new Set((oldCandidates??[]).map(x=>`${x.profile_id}:${x.candidate_set_id}:${x.product_name}`));const newCandidates=rows.filter(x=>!candidateSet.has(`${x.profile_id}:${x.candidate_set_id}:${x.product_name}`));if(newCandidates.length){const {error:ce}=await db.from("gift_candidates").insert(newCandidates);if(ce)throw ce;}
  return rows.length;
}
