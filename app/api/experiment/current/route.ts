import { NextResponse } from "next/server";
import { studySession, profileFor, trialFor } from "@/lib/study/server";
import { visibleRecipientMessages, visibleRecipientTrial } from "@/lib/study/visibility";

export async function GET(request: Request) {
  try {
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "giver" && role !== "recipient") return NextResponse.json({ error: "역할을 선택해 주세요." }, { status: 400 });
    const { db, person } = await studySession(role);
    const { trial, trials } = await trialFor(db, person.id, role);
    const visible = trials.filter((item: any) => item.order_position <= trial.order_position);
    const ids = visible.map((item: any) => item.id);
    const { data: messages, error } = await db.from("study_messages").select("*").in("trial_id", ids).order("id");
    if (error) throw error;
    const profile = profileFor(trial.profile_code);
    if (!profile) throw new Error("PROFILE_MISSING");
    const currentMessages = role === "recipient" ? visibleRecipientMessages(messages ?? [],trial) : messages ?? [];
    const safeTrial = role === "recipient" ? visibleRecipientTrial(trial,currentMessages) : trial;
    const safeTrials = visible.map((item: any) => item.id === trial.id ? safeTrial : item);
    return NextResponse.json({
      person: { id: person.id, enrollmentNumber: person.enrollment_number, roleOrder: person.role_order,
        conditionOrder: person.condition_order, enrollmentBlock: person.enrollment_block, currentRole: person.active_role },
      trial: safeTrial, trials: safeTrials, messages: currentMessages, profile,
      aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  } catch (cause) {
    console.error("Study current state failed", cause);
    return NextResponse.json({ error: "실험 상태를 불러오지 못했습니다. 연구자에게 알려주세요." }, { status: 500 });
  }
}
