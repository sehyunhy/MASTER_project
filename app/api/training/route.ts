import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { logEvent } from "@/lib/events";
import { participantSessionMatches } from "@/lib/auth/participant";
import { EXPERIMENT, MINIMUM_EXPOSURE_MS } from "@/config/experiment";
import { validPracticeExposureMs, type PracticeExposureEvent } from "@/lib/experiment/practiceExposure";

const practiceProductIds = ["10308385", "36995775", "864008591"];

const expected = [
  { comparison: "giver", decision: "giver" },
  { comparison: "agent", decision: "agent" },
] as const;

const timedPracticePhases = ["criteria", "candidates", "comparison"] as const;
type TimedPracticePhase = typeof timedPracticePhases[number];

async function context(participantId: string) {
  if (!await participantSessionMatches(participantId)) throw new Error("SESSION_EXPIRED");
  const db = supabaseAdmin();
  const { data: participant, error } = await db.from("participants")
    .select("id,role,training_attempts").eq("id", participantId).eq("is_mock", false).single();
  if (error || !participant) throw new Error("PARTICIPANT_NOT_FOUND");
  return { db, participant };
}

export async function GET(request: Request) {
  const participantId = new URL(request.url).searchParams.get("participantId") ?? "";
  try {
    const {db,participant} = await context(participantId);
    const [{data:checks,error},{count:passed}] = await Promise.all([
      db.from("training_practice_checks").select("scenario_index,passed").eq("participant_id",participantId),
      db.from("training_attempts").select("id",{count:"exact",head:true}).eq("participant_id",participantId).eq("passed",true),
    ]);
    if(error)throw error;
    if(passed)return NextResponse.json({role:participant.role,passed:true,checks:checks??[],practiceProducts:[]});
    const {data:catalog,error:catalogError}=await db.from("product_catalog")
      .select("source_product_id,product_name_ko,product_name_original,category,price_experiment,price_original,image_url,description,source_url,source_timestamp_raw")
      .eq("dataset_version",EXPERIMENT.candidateVersion).eq("experiment_eligible",true).eq("is_active",true)
      .contains("profile_codes",["R4v2"]).in("source_product_id",practiceProductIds);
    if(catalogError)throw catalogError;
    const practiceProducts=practiceProductIds.map(id=>(catalog??[]).find(item=>item.source_product_id===id));
    if(practiceProducts.some(item=>!item||!item.image_url||item.price_experiment==null))
      return NextResponse.json({error:"연습 상품 3개의 이미지와 연구용 가격이 준비되지 않았습니다. 연구자가 v4 상품과 관찰 자극을 승인해야 합니다."},{status:409});
    return NextResponse.json({role:participant.role,passed:false,checks:checks??[],practiceProducts});
  } catch(e) { return NextResponse.json({error:(e as Error).message},{status:401}); }
}

export async function POST(request: Request) {
  let input:any;
  try { input=await request.json(); } catch { return NextResponse.json({error:"요청 형식을 확인해 주세요."},{status:400}); }
  if(typeof input.participantId!=="string")return NextResponse.json({error:"참가자 정보가 필요합니다."},{status:400});
  try {
    const {db,participant}=await context(input.participantId);
    if(input.action==="practice_exposure") {
      const scenarioIndex=input.scenarioIndex;
      const phase=input.phase as TimedPracticePhase;
      const practiceRunId=input.practiceRunId;
      const operation=input.operation;
      if(![0,1].includes(scenarioIndex)||!timedPracticePhases.includes(phase)||typeof practiceRunId!=="string"||!/^[\w-]{8,80}$/.test(practiceRunId)||!["begin","heartbeat","gate","complete"].includes(operation))
        return NextResponse.json({error:"연습 확인시간 요청이 올바르지 않습니다."},{status:400});
      if(operation==="heartbeat"&&typeof input.active!=="boolean")
        return NextResponse.json({error:"연습 화면 상태가 올바르지 않습니다."},{status:400});
      const identity={training:true,practiceRunId,scenarioIndex,phase};
      const {data:events,error:eventsError}=await db.from("event_logs")
        .select("event_type,created_at,effective_exposure_ms,payload_json")
        .eq("participant_id",participant.id)
        .in("event_type",["practice_phase_started","practice_phase_heartbeat","practice_phase_threshold_met","practice_phase_completed"])
        .contains("payload_json",identity)
        .order("created_at",{ascending:true}).limit(3_000);
      if(eventsError)throw eventsError;
      const history=(events??[]) as PracticeExposureEvent[];
      const hasStart=history.some(event=>event.event_type==="practice_phase_started");
      const completed=history.some(event=>event.event_type==="practice_phase_completed");
      if(operation==="begin") {
        if(!hasStart)await logEvent({participantId:participant.id,eventType:"practice_phase_started",phase,payload:identity,actorType:"participant",eventOrigin:"participant"});
        return NextResponse.json({ok:true,passed:completed});
      }
      if(!hasStart)return NextResponse.json({error:"연습 화면을 다시 열어 주세요."},{status:409});
      if(operation==="heartbeat") {
        if(!completed)await logEvent({participantId:participant.id,eventType:"practice_phase_heartbeat",phase,payload:{...identity,active:input.active},actorType:"participant",eventOrigin:"participant"});
        return NextResponse.json({ok:true});
      }
      const minimumMs=MINIMUM_EXPOSURE_MS.practice[participant.role as "giver"|"recipient"];
      const effectiveExposureMs=validPracticeExposureMs(history,Date.now());
      if(effectiveExposureMs<minimumMs)return NextResponse.json({passed:false,effectiveExposureMs,remainingMs:minimumMs-effectiveExposureMs});
      if(operation==="gate"&&!history.some(event=>event.event_type==="practice_phase_threshold_met"))
        await logEvent({participantId:participant.id,eventType:"practice_phase_threshold_met",phase,payload:{...identity,effectiveExposureMs},effectiveExposureMs,actorType:"participant",eventOrigin:"participant"});
      if(operation==="complete"&&!completed)
        await logEvent({participantId:participant.id,eventType:"practice_phase_completed",phase,payload:{...identity,effectiveExposureMs},effectiveExposureMs,actorType:"participant",eventOrigin:"participant"});
      return NextResponse.json({passed:true,effectiveExposureMs});
    }
    if(input.action==="practice_event") {
      if(input.eventType==="practice_product_detail_opened") {
        if(![0,1].includes(input.scenarioIndex)||!practiceProductIds.includes(input.sourceProductId))
          return NextResponse.json({error:"연습 상품 정보가 올바르지 않습니다."},{status:400});
        await logEvent({participantId:participant.id,eventType:input.eventType,payload:{training:true,scenarioIndex:input.scenarioIndex,sourceProductId:input.sourceProductId},actorType:"participant",eventOrigin:"participant"});
        return NextResponse.json({ok:true});
      }
      if(!["observation_started","practice_replayed","practice_step_shown"].includes(input.eventType)||![0,1].includes(input.scenarioIndex))return NextResponse.json({error:"연습 이벤트가 올바르지 않습니다."},{status:400});
      const actors=[ ["giver","giver","giver","agent","giver","agent","giver","agent"], ["agent","agent","agent","agent"] ];
      const scripted=input.eventType==="practice_step_shown";
      const step=Number(input.step);
      if(scripted&&(!Number.isInteger(step)||step<0||step>=actors[input.scenarioIndex].length))return NextResponse.json({error:"연습 단계가 올바르지 않습니다."},{status:400});
      const actor=scripted?actors[input.scenarioIndex][step]:null;
      const observedScript=scripted&&(participant.role==="recipient"||actor==="agent");
      await logEvent({participantId:participant.id,eventType:input.eventType,payload:{training:true,scenarioIndex:input.scenarioIndex,step:scripted?step:null,actor},actorType:scripted?(actor==="giver"?(participant.role==="recipient"?"simulated_giver":"participant"):"agent"):"participant",eventOrigin:observedScript?"scripted":"participant"});
      return NextResponse.json({ok:true});
    }
    if(input.action==="check") {
      const index=input.scenarioIndex;
      if(![0,1].includes(index)||!["giver","agent"].includes(input.comparison)||!["giver","agent"].includes(input.decision))return NextResponse.json({error:"확인 응답을 선택해 주세요."},{status:400});
      if(typeof input.practiceRunId!=="string"||!/^[\w-]{8,80}$/.test(input.practiceRunId))return NextResponse.json({error:"연습을 다시 시작해 주세요."},{status:400});
      const {data:completedPhases,error:phaseError}=await db.from("event_logs")
        .select("payload_json").eq("participant_id",participant.id).eq("event_type","practice_phase_completed")
        .contains("payload_json",{training:true,practiceRunId:input.practiceRunId,scenarioIndex:index});
      if(phaseError)throw phaseError;
      if(!timedPracticePhases.every(phase=>(completedPhases??[]).some(event=>event.payload_json?.phase===phase)))
        return NextResponse.json({error:"각 연습 화면의 최소 확인시간을 채워 주세요."},{status:409});
      const passed=input.comparison===expected[index].comparison&&input.decision===expected[index].decision;
      const {data:prior}=await db.from("training_practice_checks").select("attempts").eq("participant_id",participant.id).eq("scenario_index",index).maybeSingle();
      const {error}=await db.from("training_practice_checks").upsert({participant_id:participant.id,scenario_index:index,comparison_answer:input.comparison,decision_answer:input.decision,passed,attempts:(prior?.attempts??0)+1,updated_at:new Date().toISOString()},{onConflict:"participant_id,scenario_index"});
      if(error)throw error;
      await logEvent({participantId:participant.id,eventType:"practice_check_answered",payload:{training:true,scenarioIndex:index,comparison:input.comparison,decision:input.decision,passed},eventOrigin:"participant"});
      return NextResponse.json({passed,replayPhase:input.comparison!==expected[index].comparison?"comparison":input.decision!==expected[index].decision?"decision":null});
    }
    if(input.action==="complete") {
      const {data:checks,error}=await db.from("training_practice_checks").select("scenario_index,passed").eq("participant_id",participant.id);
      if(error)throw error;
      if(checks?.length!==2||checks.some((row:any)=>!row.passed))return NextResponse.json({error:"두 연습의 행동을 확인한 뒤 시작할 수 있습니다."},{status:409});
      const {count:alreadyPassed}=await db.from("training_attempts").select("id",{count:"exact",head:true}).eq("participant_id",participant.id).eq("passed",true);
      if(alreadyPassed)return NextResponse.json({passed:true});
      const attempt=participant.training_attempts+1;
      const {error:insertError}=await db.from("training_attempts").insert({participant_id:participant.id,attempt_number:attempt,score:4,passed:true,responses:["giver","giver","agent","agent"]});
      if(insertError)throw insertError;
      const {error:updateError}=await db.from("participants").update({training_attempts:attempt}).eq("id",participant.id);
      if(updateError)throw updateError;
      await logEvent({participantId:participant.id,eventType:"training_passed",payload:{training:true,practiceOnly:true},eventOrigin:"participant"});
      return NextResponse.json({passed:true});
    }
    return NextResponse.json({error:"지원하지 않는 연습 동작입니다."},{status:400});
  } catch(e) { return NextResponse.json({error:(e as Error).message},{status:500}); }
}
