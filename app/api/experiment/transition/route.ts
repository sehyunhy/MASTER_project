import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { participantSessionMatches } from "@/lib/auth/participant";
import { logEvent } from "@/lib/events";

export async function POST(request:Request){
  let body:any;
  try{body=await request.json();}catch{return NextResponse.json({error:"코드 입력을 확인해 주세요."},{status:400});}
  const participantId=typeof body.participantId==="string"?body.participantId:"";
  const code=typeof body.code==="string"?body.code.trim():"";
  const idempotencyKey=typeof body.idempotencyKey==="string"?body.idempotencyKey:"";
  if(!participantId)return NextResponse.json({error:"코드 입력을 확인해 주세요."},{status:400});
  if(!await participantSessionMatches(participantId))return NextResponse.json({error:"참가자 세션이 만료되었습니다."},{status:401});
  const requestKey=idempotencyKey&&idempotencyKey.length<=100?idempotencyKey:randomUUID();
  if(!/^\d{3,6}$/.test(code)){
    const db=supabaseAdmin();
    const [{data:session},{data:person}]=await Promise.all([db.from("role_sessions").select("id,next_trial_number").eq("participant_id",participantId).maybeSingle(),db.from("participants").select("experiment_version").eq("id",participantId).maybeSingle()]);
    if(session&&session.next_trial_number<=4){
      await db.from(person?.experiment_version==="6.0.0"?"v6_transition_attempts":"v5_transition_attempts").upsert({role_session_id:session.id,trial_number:session.next_trial_number,success:false,idempotency_key:requestKey},{onConflict:"role_session_id,idempotency_key",ignoreDuplicates:true});
      await logEvent({participantId,eventType:"transition_code_rejected",phase:"transition",actorType:"participant",eventOrigin:"participant",payload:{trialNumber:session.next_trial_number,success:false,formatValid:false},idempotencyKey:`v5-transition:${session.id}:${requestKey}`});
    }
    return NextResponse.json({error:"코드를 확인해 주세요. 연구자에게 받은 현재 순서의 코드를 입력해 주세요."},{status:400});
  }
  try{
    const db=supabaseAdmin();
    const [{data:participant,error:participantError},{data:session,error:sessionError}]=await Promise.all([
      db.from("participants").select("id,role,experiment_version,is_mock").eq("id",participantId).single(),
      db.from("role_sessions").select("id,subject_id,role,next_trial_number,status").eq("participant_id",participantId).single(),
    ]);
    if(participantError||sessionError||!participant||!session)throw new Error("V5_ROLE_SESSION_NOT_FOUND");
    if(!["5.0.0","6.0.0"].includes(participant.experiment_version)||participant.is_mock)return NextResponse.json({error:"이 전환 절차는 현재 실험 버전에만 사용할 수 있습니다."},{status:409});
    const codeHash=createHash("sha256").update(code,"utf8").digest("hex");
    const {data,error:rpcError}=await db.rpc(participant.experiment_version==="6.0.0"?"v6_verify_transition_code":"v5_verify_transition_code",{p_participant_id:participantId,p_code_sha256:codeHash,p_idempotency_key:requestKey});
    if(rpcError)throw rpcError;
    const result=data as {accepted?:boolean;idempotent?:boolean;trial_id?:string;trial_number?:number;next_trial_number?:number;role_complete?:boolean};
    await logEvent({participantId,trialId:result.trial_id,eventType:result.accepted?"transition_code_verified":"transition_code_rejected",
      phase:"transition",actorType:"participant",eventOrigin:"participant",idempotencyKey:`v5-transition:${session.id}:${requestKey}`,
      payload:{trialNumber:result.trial_number??session.next_trial_number,success:Boolean(result.accepted),idempotent:Boolean(result.idempotent)}});
    if(!result.accepted)return NextResponse.json({accepted:false,error:"코드를 확인해 주세요. 연구자에게 받은 현재 순서의 코드를 입력해 주세요."},{status:400});
    const {data:trial,error:trialError}=await db.from("trials").select("id,trial_number,condition_id,profile_id,current_phase,candidate_builder,decision_authority,status")
      .eq("participant_id",participantId).eq("trial_number",result.trial_number).single();
    if(trialError||!trial)throw trialError??new Error("V5_TRIAL_NOT_PROVISIONED");
    return NextResponse.json({accepted:true,trial,roleComplete:Boolean(result.role_complete)});
  }catch(error){
    const message=String((error as any)?.message??error);
    const status=message.includes("V5_ROLE_ORDER_LOCKED")?409:message.includes("V5_PREVIOUS")?409:500;
    if(status===409){
      try{
        const db=supabaseAdmin();const [{data:session},{data:person}]=await Promise.all([db.from("role_sessions").select("id,next_trial_number").eq("participant_id",participantId).maybeSingle(),db.from("participants").select("experiment_version").eq("id",participantId).maybeSingle()]);
        if(session&&session.next_trial_number<=4){
          await db.from(person?.experiment_version==="6.0.0"?"v6_transition_attempts":"v5_transition_attempts").upsert({role_session_id:session.id,trial_number:session.next_trial_number,success:false,idempotency_key:requestKey},{onConflict:"role_session_id,idempotency_key",ignoreDuplicates:true});
          await logEvent({participantId,eventType:"transition_code_rejected",phase:"transition",actorType:"participant",eventOrigin:"participant",payload:{trialNumber:session.next_trial_number,success:false,blockedByPrerequisite:true},idempotencyKey:`v5-transition:${session.id}:${requestKey}`});
        }
      }catch{}
    }
    return NextResponse.json({error:status===409?"앞선 조건의 완료와 설문 확인을 먼저 마쳐 주세요.":"코드를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요."},{status});
  }
}
