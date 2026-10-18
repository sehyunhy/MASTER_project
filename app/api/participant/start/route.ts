import { NextResponse } from "next/server";
import { startSchema } from "@/lib/validation/schemas";
import { supabaseAdmin } from "@/lib/supabase/server";
import { logEvent } from "@/lib/events";
import { profileAt } from "@/lib/experiment/assignment";
import { createParticipantSession } from "@/lib/auth/participant";
import { EXPERIMENT } from "@/config/experiment";
import { anthropicModel } from "@/lib/agent/model";
import { assignedRelationshipType, relationshipScenarioId } from "@/lib/experiment/relationship";

export async function POST(request: Request) {
  const parsed = startSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "참가자 코드 형식을 확인해 주세요." }, { status: 400 });
  try {
    const db = supabaseAdmin();
    if(EXPERIMENT.version==="6.0.0"&&!parsed.data.participantCode.startsWith("N"))return NextResponse.json({error:"현재 연구의 참가자 코드를 확인해 주세요. 연구자에게 발급받은 코드를 입력해 주세요."},{status:409});
    if((EXPERIMENT.version==="6.0.0"&&parsed.data.participantCode.startsWith("N"))){
      const {data:subject,error:subjectError}=await db.from("research_subjects").select("*").eq("study_code",parsed.data.participantCode).single();
      if(subjectError||!subject)return NextResponse.json({error:"등록된 참가자 코드를 찾을 수 없습니다. 연구자에게 확인해 주세요."},{status:404});
      const {data:session,error:sessionError}=await db.from("role_sessions").select("*").eq("subject_id",subject.id).eq("role",parsed.data.role).single();
      if(sessionError||!session)return NextResponse.json({error:"해당 역할 세션을 찾을 수 없습니다."},{status:404});
      if(subject.status==="withdrawn"||session.status==="withdrawn")return NextResponse.json({error:"참여 중단이 기록되었습니다."},{status:403});
      if(subject.status==="completed"||session.status==="completed")return NextResponse.json({error:"이 역할 세션은 이미 완료되었습니다."},{status:409});
      if(subject.experiment_version!==EXPERIMENT.version)return NextResponse.json({error:"참가자 배정 버전이 현재 연구와 다릅니다."},{status:409});
      if(subject.role_order?.[Number(subject.current_role_index)]!==parsed.data.role)return NextResponse.json({error:"연구자가 안내한 역할 순서가 아직 아닙니다."},{status:409});
      const {data:p,error:pError}=await db.from("participants").select("*").eq("id",session.participant_id).eq("role",parsed.data.role).single();
      if(pError||!p)return NextResponse.json({error:"역할별 참가자 자료를 찾을 수 없습니다."},{status:404});
      if(p.experiment_version!==EXPERIMENT.version||(EXPERIMENT.version==="6.0.0"?!p.v6_roster:!p.v5_roster))return NextResponse.json({error:"이 참가자는 새 실험 버전에 배정되지 않았습니다."},{status:409});
      const {data:existing,error:existingError}=await db.from("trials").select("id").eq("participant_id",p.id).limit(1);
      if(existingError)throw existingError;
      if(!existing?.length){
        const {data:seq,error:seqError}=await db.from("experiment_sequences").select("*").eq("id",subject.sequence_id).single();
        if(seqError||!seq)throw seqError??new Error("V5_SEQUENCE_NOT_FOUND");
        const positions=[seq.position_1,seq.position_2,seq.position_3,seq.position_4];
        const offset=Number(session.profile_rotation_offset??subject.profile_rotation_offset??0);
        const rows=positions.map((condition:string,i:number)=>{
          const rights=EXPERIMENT.conditions[condition as keyof typeof EXPERIMENT.conditions];
          const profileId=profileAt(i+1,offset,EXPERIMENT.profileVersion);
          return {participant_id:p.id,trial_number:i+1,condition_position:i+1,profile_id:profileId,
            scenario_id:`gift-scenario-${profileId}-v6`,condition_id:condition,candidate_builder:rights.candidateBuilder,
            execution_autonomy:rights.autonomy,decision_authority:rights.authority,candidate_mode:rights.candidateMode,status:"pending",current_phase:"candidates",
            experiment_version:EXPERIMENT.version,ui_version:EXPERIMENT.uiVersion,profile_version:EXPERIMENT.profileVersion,
            candidate_version:EXPERIMENT.candidateVersion,dataset_version:EXPERIMENT.candidateVersion,prompt_version:EXPERIMENT.promptVersion,
            model_version:p.role==="recipient"?"researcher-script-v6":anthropicModel(),sequence_version:subject.sequence_id,
            stimulus_source:p.role==="recipient"?"scripted":"participant_live",is_mock:false};
        });
        const {error:trialError}=await db.from("trials").insert(rows);
        if(trialError)throw trialError;
      }
      const now=new Date().toISOString();
      await db.from("role_sessions").update({status:"active",started_at:session.started_at??now,updated_at:now}).eq("id",session.id);
      await db.from("participants").update({status:"started",started_at:p.started_at??now}).eq("id",p.id);
      const response=NextResponse.json({participant:{id:p.id,role:p.role,status:p.status,studyCode:subject.study_code},study:{id:subject.id,roleSessionId:session.id,roleOrder:subject.role_order,sequenceId:subject.sequence_id}});
      response.cookies.set("participant_session",createParticipantSession(p.id),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:60*60*8});
      return response;
    }
    const { data: p, error } = await db.from("participants").select("*").eq("participant_code", parsed.data.participantCode).eq("role", parsed.data.role).eq("is_mock", false).maybeSingle();
    if (error) {
      console.error("Participant lookup failed", { code: error.code, message: error.message });
      return NextResponse.json({ error: "참가자 정보를 확인하지 못했습니다. 서버 로그를 확인해 주세요." }, { status: 500 });
    }
    if (!p) return NextResponse.json({ error: "등록되지 않은 코드 또는 참여 방식입니다. 연구자에게 확인해 주세요." }, { status: 404 });
    if (p.status === "completed" || p.status === "withdrawn") return NextResponse.json({ error: "이 참가자 코드는 완료되었거나 중단 처리되었습니다." }, { status: 409 });
    if (p.experiment_version !== EXPERIMENT.version) return NextResponse.json({error:"이 참가자 코드는 이전 연구 버전으로 배정되어 있습니다. 연구자가 새 버전 배정을 확인해 주세요."},{status:409});
    const now = new Date().toISOString();
    if (!p.started_at) {
      const {error:updateError}=await db.from("participants").update({ status: "started", started_at: now }).eq("id", p.id);
      if(updateError)throw updateError;
    }
    const { data: existing } = await db.from("trials").select("id").eq("participant_id", p.id).limit(1);
    if (!existing?.length) {
      const { data: seq } = await db.from("experiment_sequences").select("*").eq("id", p.sequence_id).single();
      if (!seq) throw new Error("Assigned sequence is missing.");
      const positions = [seq.position_1, seq.position_2, seq.position_3, seq.position_4];
      const offset = Number(p.profile_rotation_offset ?? 0);
      const rows = positions.map((condition: string, i: number) => {
        const autonomy = condition === "C1" || condition === "C2" ? "human_guided" : "agent_autonomous";
        const authority = condition === "C1" || condition === "C3" ? "human" : "agent";
        const profileId=profileAt(i + 1, offset, EXPERIMENT.profileVersion);
        return { participant_id: p.id, trial_number: i + 1, profile_id: profileId, scenario_id: (EXPERIMENT.profileVersion as string) === "profiles-v3-relationship-types" ? relationshipScenarioId(profileId,p.intimacy_condition) : "gift-scenario-"+profileId, relationship_type:(EXPERIMENT.profileVersion as string) === "profiles-v3-relationship-types"?assignedRelationshipType(p.intimacy_condition):null, condition_id: condition, execution_autonomy: autonomy, decision_authority: authority,
          experiment_version: p.experiment_version,ui_version:EXPERIMENT.uiVersion,profile_version:EXPERIMENT.profileVersion,candidate_version:EXPERIMENT.candidateVersion,dataset_version:EXPERIMENT.candidateVersion,prompt_version:EXPERIMENT.promptVersion,model_version:p.role==="recipient"?"frozen-script-v2":anthropicModel(),sequence_version:EXPERIMENT.sequenceVersion,
          stimulus_source:p.role==="recipient"?"researcher_scripted":"participant_live" };
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
