import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { logEvent } from "@/lib/events";
import { participantSessionMatches } from "@/lib/auth/participant";

// Must match the four radio groups in Training.tsx in display order:
// guided questions = yes, autonomous generation = no,
// participant chooses = user, AI chooses = ai.
const correct = ["yes", "no", "user", "ai"];
export async function POST(request: Request) {
  const { participantId, answers } = await request.json();
  if (typeof participantId !== "string" || !Array.isArray(answers) || answers.length !== 4) return NextResponse.json({ error: "훈련 응답을 확인해 주세요." }, { status: 400 });
  if(!await participantSessionMatches(participantId)) return NextResponse.json({error:"참가자 세션이 만료되었습니다. 연구자에게 문의해 주세요."},{status:401});
  try {
    const db = supabaseAdmin();
    const { data: participant, error: pErr } = await db.from("participants").select("id,training_attempts").eq("id", participantId).eq("is_mock", false).single();
    if (pErr || !participant) return NextResponse.json({ error: "참가자 정보를 찾을 수 없습니다." }, { status: 404 });
    const score = answers.reduce((n: number, value: string, i: number) => n + (value === correct[i] ? 1 : 0), 0);
    const attempt = participant.training_attempts + 1;
    const passed = score === 4;
    const { error } = await db.from("training_attempts").insert({ participant_id: participantId, attempt_number: attempt, score, passed, responses: answers });
    if (error) throw error;
    await db.from("participants").update({ training_attempts: attempt }).eq("id", participantId);
    await logEvent({ participantId, eventType: "training_answered", payload: { attempt, score, passed } });
    await logEvent({ participantId, eventType: passed ? "training_passed" : "training_failed", payload: { attempt, score } });
    return NextResponse.json({ passed, score, attempt });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "훈련 저장 중 오류가 발생했습니다." }, { status: 500 }); }
}
