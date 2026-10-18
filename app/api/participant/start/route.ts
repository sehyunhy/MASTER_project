import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { createParticipantSession, currentParticipantIdFromSession } from "@/lib/auth/participant";

const schema = z.object({ role: z.enum(["giver", "recipient"]), browserKey: z.uuid(), newParticipant: z.boolean().optional() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "진행할 역할을 선택해 주세요." }, { status: 400 });
  try {
    const db = supabaseAdmin();
    const previousId = await currentParticipantIdFromSession();
    let person: any = null;
    if (previousId) {
      const result = await db.from("study_people").select("*").eq("id", previousId).maybeSingle();
      if (result.error) throw result.error;
      person = result.data;
    }
    if (parsed.data.newParticipant || !person) {
      const { data, error } = parsed.data.newParticipant
        ? await db.rpc("study_begin_new_person", {
          p_previous_id: person?.id ?? null,
          p_role: parsed.data.role,
          p_browser_key: parsed.data.browserKey,
        })
        : await db.rpc("study_enroll", {
          p_role: parsed.data.role,
          p_browser_key: parsed.data.browserKey,
        });
      if (error) throw error;
      const result = await db.from("study_people").select("*").eq("id", data.person_id).single();
      if (result.error) throw result.error;
      person = result.data;
    }
    if (person.status !== "active" || person.active_role !== parsed.data.role)
      return NextResponse.json({
        error: person.status === "completed"
          ? "이 참가자의 두 역할이 완료되었습니다. 새 참가자라면 ‘새 참가자로 시작’을 선택해 주세요."
          : person.status === "withdrawn"
            ? "이 참가자의 진행은 종료되었습니다. 새 참가자라면 ‘새 참가자로 시작’을 선택해 주세요."
            : `현재 참가자 #${person.enrollment_number}은(는) ${person.active_role === "giver" ? "P01 · 선물 주는 사람" : "P02 · 선물 받는 사람"} 역할을 진행 중입니다. 새 참가자라면 ‘새 참가자로 시작’을 선택해 주세요.`,
        canStartNew: true,
      }, { status: 409 });
    const response = NextResponse.json({ participant: { id: person.id, role: parsed.data.role },
      enrollmentNumber: person.enrollment_number, roleCode: parsed.data.role === "giver" ? "P01" : "P02" });
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
