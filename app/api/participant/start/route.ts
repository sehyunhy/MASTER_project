import { NextResponse } from "next/server";
import { startSchema } from "@/lib/validation/schemas";
import { supabaseAdmin } from "@/lib/supabase/server";
import { logEvent } from "@/lib/events";
import { profileAt } from "@/lib/experiment/assignment";
import { createParticipantSession } from "@/lib/auth/participant";

export async function POST(request: Request) {
  const parsed = startSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "참가자 코드 형식을 확인해 주세요." }, { status: 400 });
  try {
    const db = supabaseAdmin();
    const { data: p, error } = await db.from("participants").select("*").eq("participant_code", parsed.data.participantCode).eq("role", parsed.data.role).eq("is_mock", false).single();
    if (error || !p) return NextResponse.json({ error: "등록되지 않은 코드 또는 참여 방식입니다. 연구자에게 확인해 주세요." }, { status: 404 });
    if (p.status === "completed" || p.status === "withdrawn") return NextResponse.json({ error: "이 참가자 코드는 완료되었거나 중단 처리되었습니다." }, { status: 409 });
    const now = new Date().toISOString();
    if (!p.started_at) await db.from("participants").update({ status: "started", started_at: now }).eq("id", p.id);
    const { data: existing } = await db.from("trials").select("id").eq("participant_id", p.id).limit(1);
    if (!existing?.length) {
      const { data: seq } = await db.from("experiment_sequences").select("*").eq("id", p.sequence_id).single();
      if (!seq) throw new Error("Assigned sequence is missing.");
      const positions = [seq.position_1, seq.position_2, seq.position_3, seq.position_4];
      const offset = Number(p.participant_code.slice(-1)) % 4;
      const rows = positions.map((condition: string, i: number) => {
        const autonomy = condition === "C1" || condition === "C2" ? "human_guided" : "agent_autonomous";
        const authority = condition === "C1" || condition === "C3" ? "human" : "agent";
        return { participant_id: p.id, trial_number: i + 1, profile_id: profileAt(i + 1, offset), condition_id: condition, execution_autonomy: autonomy, decision_authority: authority, experiment_version: p.experiment_version };
      });
      const { error: trialError } = await db.from("trials").insert(rows);
      if (trialError) throw trialError;
    }
    await logEvent({ participantId: p.id, eventType: "experiment_started", payload: { role: p.role, resumed: Boolean(p.started_at) } });
    const response=NextResponse.json({ participant: { id: p.id, role: p.role, status: p.status } });
    response.cookies.set("participant_session",createParticipantSession(p.id),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*8});
    return response;
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "서버 오류" }, { status: 500 }); }
}
