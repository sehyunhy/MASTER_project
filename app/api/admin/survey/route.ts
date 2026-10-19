import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";

const schema = z.object({
  participantNumber: z.string().regex(/^K[0-9]{2,8}$/),
  role: z.enum(["giver", "recipient"]),
  condition: z.enum(["A", "B", "C", "D"]).optional(),
  formSection: z.enum(["baseline", "pretrial", "posttrial", "final", "crossrole"]),
  formVersion: z.string().min(1).max(80),
  answers: z.record(z.string().min(1).max(120), z.unknown()).refine(value => Object.keys(value).length > 0),
  paperFormId: z.string().max(120).optional(),
  enteredBy: z.string().min(1).max(120),
});
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>)
    .sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value)??"null";
}
export async function POST(request: Request) {
  if (!process.env.ADMIN_PASSWORD || request.headers.get("x-admin-password") !== process.env.ADMIN_PASSWORD)
    return NextResponse.json({ error: "관리자 인증이 필요합니다." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || JSON.stringify(parsed.data.answers).length > 30000)
    return NextResponse.json({ error: "설문 입력 형식이 올바르지 않습니다." }, { status: 400 });
  const body = parsed.data;
  if (body.formSection === "posttrial" && !body.condition)
    return NextResponse.json({ error: "조건 직후 설문에는 A–D 조건이 필요합니다." }, { status: 400 });
  try {
    const db = supabaseAdmin();
    const column = body.role === "giver" ? "giver_number" : "recipient_number";
    const { data: person, error: personError } = await db.from("study_people")
      .select("id").eq(column, body.participantNumber).single();
    if (personError || !person) return NextResponse.json({ error: "참가번호를 찾지 못했습니다." }, { status: 404 });
    let trialId: string | null = null;
    if (body.formSection === "posttrial") {
      const { data: trial, error: trialError } = await db.from("study_trials")
        .select("id").eq("person_id", person.id).eq("role", body.role)
        .eq("condition", body.condition!).single();
      if (trialError || !trial) return NextResponse.json({ error: "해당 조건을 찾지 못했습니다." }, { status: 404 });
      trialId = trial.id;
    }
    const { data: matches, error: lookupError } = await db.from("study_survey_responses")
      .select("id,answers,form_version,paper_form_id,entered_by").eq("person_id", person.id).eq("role", body.role)
      .eq("form_section", body.formSection)
      .filter("trial_id", trialId ? "eq" : "is", trialId ?? "null")
      .limit(1);
    if (lookupError) throw lookupError;
    const row = {
      person_id: person.id, participant_number: body.participantNumber, role: body.role,
      trial_id: trialId, form_section: body.formSection, form_version: body.formVersion,
      answers: body.answers, paper_form_id: body.paperFormId ?? null,
      entered_by: body.enteredBy,
    };
    const existing = matches?.[0];
    if (existing && canonical(existing.answers)===canonical(body.answers) &&
      existing.form_version===body.formVersion &&
      existing.paper_form_id===(body.paperFormId??null) && existing.entered_by===body.enteredBy)
      return NextResponse.json({ saved: true, id: existing.id, trialId, idempotent: true });
    const result = existing
      ? await db.from("study_survey_responses").update(row).eq("id", existing.id).select("id").single()
      : await db.from("study_survey_responses").insert(row).select("id").single();
    if (result.error) throw result.error;
    return NextResponse.json({ saved: true, id: result.data.id, trialId });
  } catch (cause) {
    console.error("Survey entry failed", cause);
    return NextResponse.json({ error: "설문 응답을 저장하지 못했습니다." }, { status: 500 });
  }
}
