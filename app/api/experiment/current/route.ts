import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { participantSessionMatches } from "@/lib/auth/participant";

export async function GET(request: Request) {
  const participantId = new URL(request.url).searchParams.get("participantId");
  if (!participantId) return NextResponse.json({ error: "참가자 정보가 없습니다." }, { status: 400 });
  if(!await participantSessionMatches(participantId))return NextResponse.json({error:"참가자 세션이 만료되었습니다."},{status:401});
  try {
    const db = supabaseAdmin();
    const { data: p, error } = await db.from("participants").select("id,participant_code,role,intimacy_condition,sequence_id,status,experiment_version,training_attempts").eq("id", participantId).single();
    if (error || !p) return NextResponse.json({ error: "참가자 정보를 찾을 수 없습니다." }, { status: 404 });
    const {count:passed}=await db.from("training_attempts").select("id",{count:"exact",head:true}).eq("participant_id",participantId).eq("passed",true);
    if(!passed)return NextResponse.json({error:"먼저 연습 안내와 이해도 확인을 완료해 주세요."},{status:403});
    const { data: trials } = await db.from("trials").select("*, recipient_profiles(*), trial_candidates(*, gift_candidates(*)), final_selections(*),event_logs(*)").eq("participant_id", participantId).order("trial_number");
    const normalized=(trials??[]).map((t:any)=>({...t,final_selections:Array.isArray(t.final_selections)?t.final_selections:t.final_selections?[t.final_selections]:[]}));
    const active = normalized.find((t: any) => t.status !== "completed");
    return NextResponse.json({ participant: p, trials: normalized, activeTrial: active ?? null });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "데이터를 불러오지 못했습니다." }, { status: 500 }); }
}
