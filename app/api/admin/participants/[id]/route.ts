import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  if(!process.env.ADMIN_PASSWORD||request.headers.get("x-admin-password")!==process.env.ADMIN_PASSWORD)
    return NextResponse.json({error:"관리자 인증이 필요합니다."},{status:401});
  const {id}=await params;
  try {
    const db=supabaseAdmin();
    const [{data:person,error:pe},{data:trials,error:te},{data:events,error:ee},{data:messages,error:me}]=await Promise.all([
      db.from("study_people").select("*").eq("id",id).single(),
      db.from("study_trials").select("*").eq("person_id",id).order("created_at"),
      db.from("study_events").select("*").eq("person_id",id).order("id"),
      db.from("study_messages").select("*,study_trials!inner(person_id)").eq("study_trials.person_id",id).order("id"),
    ]);
    if(pe||te||ee||me)throw pe??te??ee??me;
    return NextResponse.json({person,trials,events,messages});
  } catch(cause) {
    console.error("Study participant detail failed",cause);
    return NextResponse.json({error:"참가자 상세를 불러오지 못했습니다."},{status:404});
  }
}
