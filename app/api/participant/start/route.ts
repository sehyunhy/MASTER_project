import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createParticipantSession, currentParticipantIdFromSession } from "@/lib/auth/participant";
import { randomUUID } from "node:crypto";
import { validParticipantId } from "@/lib/study/participant-id";

const schema = z.object({ role: z.enum(["giver", "recipient"]), browserKey: z.uuid(),
  participantNumber:z.string().max(12).default("") });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "진행할 역할을 선택해 주세요." }, { status: 400 });
  const participantNumber=parsed.data.participantNumber.trim().toUpperCase();
  if (!validParticipantId(participantNumber,parsed.data.role))
    return NextResponse.json({error:parsed.data.role==="giver"
      ?"선물 주는 사람 ID는 K02처럼 K와 짝수 번호를 입력해 주세요."
      :"선물 받는 사람 ID는 K01처럼 K와 홀수 번호를 입력해 주세요."},{status:400});
  try {
    const db = supabaseAdmin();
    const previousId = await currentParticipantIdFromSession();
    let person: any = null;
    if (previousId) {
      const result = await db.from("study_people").select("*").eq("id", previousId).maybeSingle();
      if (result.error) throw result.error;
      person = result.data;
    }
    let previousPerson=person;
    if (!previousPerson) {
      const result=await db.from("study_people").select("id,participant_number,giver_number,recipient_number,browser_key,status")
        .eq("browser_key",parsed.data.browserKey).maybeSingle();
      if (result.error) throw result.error;
      previousPerson=result.data;
    }
    const priorRoleId=previousPerson && (parsed.data.role==="giver"
      ? previousPerson.giver_number??previousPerson.participant_number
      : previousPerson.recipient_number??previousPerson.participant_number);
    const switchingPerson=Boolean(previousPerson && priorRoleId!==participantNumber);
    const assignedBrowserKey=switchingPerson?randomUUID():person?.browser_key??parsed.data.browserKey;
    if (switchingPerson || !person) {
      const { data, error } = switchingPerson
        ? await db.rpc("study_begin_new_person", {
          p_previous_id: previousPerson?.id ?? null,
          p_role: parsed.data.role,
          p_browser_key: assignedBrowserKey,
          p_participant_number:participantNumber,
        })
        : await db.rpc("study_enroll", {
          p_role: parsed.data.role,
          p_browser_key: assignedBrowserKey,
          p_participant_number:participantNumber,
        });
      if (error) {
        if (/PARTICIPANT_NUMBER_TAKEN/.test(error.message))
          return NextResponse.json({error:"이미 다른 기기에서 사용 중인 참가자 ID입니다. 같은 참가자를 이어서 진행하려면 기존 기기를 사용해 주세요."},{status:409});
        if (/INVALID_ENROLLMENT/.test(error.message))
          return NextResponse.json({error:"역할에 맞는 참가자 ID를 확인해 주세요. 받는 사람은 K01, 주는 사람은 K02부터 시작합니다."},{status:400});
        if (/PARTICIPANT_NUMBER_MISMATCH/.test(error.message))
          return NextResponse.json({error:"참가자 ID가 현재 브라우저의 기록과 일치하지 않습니다. 화면을 새로고침한 뒤 다시 입력해 주세요."},{status:409});
        throw error;
      }
      const result = await db.from("study_people").select("*").eq("id", data.person_id).single();
      if (result.error) throw result.error;
      person = result.data;
    }
    if (person.status !== "active" || person.active_role !== parsed.data.role)
      return NextResponse.json({
        error: person.status === "completed"
          ? "이 참가자의 두 역할이 완료되었습니다. 다음 참가자 ID를 입력해 주세요."
          : person.status === "withdrawn"
            ? "이 참가자의 진행은 종료되었습니다. 다음 참가자 ID를 입력해 주세요."
            : `현재는 ${person.active_role === "giver" ? "선물 주는 사람" : "선물 받는 사람"} 역할을 진행 중입니다. 해당 역할의 참가자 ID를 입력해 주세요.`,
      }, { status: 409 });
    const response = NextResponse.json({ participant: { id: person.id, role: parsed.data.role,participantNumber },
      browserKey:assignedBrowserKey,enrollmentNumber: person.enrollment_number, roleCode: parsed.data.role === "giver" ? "P01" : "P02" });
    response.cookies.set("participant_session", createParticipantSession(person.id), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
      path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    console.error("Study enrollment failed", error);
    return NextResponse.json({ error: "연구 시작 정보를 저장하지 못했습니다. 연구자에게 알려주세요." }, { status: 500 });
  }
}
