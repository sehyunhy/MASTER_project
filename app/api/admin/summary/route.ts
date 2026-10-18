import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (!process.env.ADMIN_PASSWORD || request.headers.get("x-admin-password") !== process.env.ADMIN_PASSWORD)
    return NextResponse.json({ error: "관리자 인증이 필요합니다." }, { status: 401 });
  try {
    const db = supabaseAdmin();
    const [{ data: people, error: pe }, { data: trials, error: te }] = await Promise.all([
      db.from("study_people").select("id,enrollment_number,first_role,current_role,role_order,condition_order,enrollment_block,profile_code,status").order("enrollment_number"),
      db.from("study_trials").select("id,person_id,role,condition,phase,operator_review_needed"),
    ]);
    if (pe || te) throw pe ?? te;
    const persons = people ?? [], trialRows = trials ?? [];
    return NextResponse.json({
      people: persons, count: persons.length, completed: persons.filter(p=>p.status==="completed").length,
      active: persons.filter(p=>p.status==="active").length,
      reviewNeeded: trialRows.filter(t=>t.operator_review_needed).length,
      trialsCompleted: trialRows.filter(t=>t.phase==="complete").length,
      orderCounts: Object.fromEntries(["ACDB","CBAD","BDCA","DABC"].map(order =>
        [order, persons.filter(person=>person.condition_order.join("")===order).length])),
      conditionCompleted: Object.fromEntries(["A","B","C","D"].map(condition =>
        [condition,trialRows.filter(trial=>trial.condition===condition&&trial.phase==="complete").length])),
    });
  } catch (cause) {
    console.error("Study admin summary failed",cause);
    return NextResponse.json({error:"관리자 현황을 불러오지 못했습니다."},{status:500});
  }
}
