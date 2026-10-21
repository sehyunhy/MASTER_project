import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { FIXED_STUDY_DATASET_VERSION } from "@/lib/study/prepared-products";
import { RECIPIENT_SEARCH_PROFILE, RECIPIENT_STIMULUS_VERSION } from "@/lib/study/recipient-context";

const bodySchema = z.object({action:z.literal("approve")});

function authorized(request:Request) {
  return Boolean(process.env.ADMIN_PASSWORD && request.headers.get("x-admin-password")===process.env.ADMIN_PASSWORD);
}

async function rows(db:ReturnType<typeof supabaseAdmin>) {
  const result=await db.from("study_stimuli").select("*")
    .eq("stimulus_version",RECIPIENT_STIMULUS_VERSION).order("profile_code").order("condition");
  if (result.error) throw result.error;
  return result.data??[];
}

function preview(records:Awaited<ReturnType<typeof rows>>) {
  const first=records[0];
  return {version:RECIPIENT_STIMULUS_VERSION,count:records.length,
    approved:records.length===16 && records.every(item=>Boolean(item.approved_at)),
    candidates:first?.candidate_snapshots??[],finalProductId:first?.final_product_id??null,
    scripts:["A","B","C","D"].map(condition=>{
      const row=records.find(item=>item.profile_code===first?.profile_code && item.condition===condition);
      return {condition,messages:Array.isArray(row?.transcript)?row.transcript.map((message:any)=>({
        phase:message.phase,speaker:message.speaker,kind:message.kind,content:message.content,
        offset_ms:message.offset_ms,
      })):[]};
    })};
}

export async function GET(request:Request) {
  if (!authorized(request)) return NextResponse.json({error:"관리자 인증이 필요합니다."},{status:401});
  try { return NextResponse.json(preview(await rows(supabaseAdmin()))); }
  catch (cause) { console.error("Recipient stimulus read failed",cause);
    return NextResponse.json({error:"관찰 자료를 불러오지 못했습니다."},{status:503}); }
}

export async function POST(request:Request) {
  if (!authorized(request)) return NextResponse.json({error:"관리자 인증이 필요합니다."},{status:401});
  const parsed=bodySchema.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({error:"요청을 확인해 주세요."},{status:400});
  try {
    const db=supabaseAdmin();
    const existing=await rows(db);
    if (existing.length!==16 || existing.some(item=>item.approved_at))
      return NextResponse.json({error:"확정할 관찰 자료 16개를 먼저 준비해 주세요.",...preview(existing)},{status:409});
    const expected=new Set(["R1","R2","R3","R4"].flatMap(profile=>["A","B","C","D"].map(condition=>`${profile}:${condition}`)));
    const baseline=JSON.stringify(existing[0].candidate_snapshots);
    const finalId=existing[0].final_product_id;
    const products=existing[0].candidate_snapshots as {source_product_id:string;name_original:string;price_krw:number;image_url:string;dataset_version:string}[];
    if (products.length!==3 || products.map(item=>item.source_product_id).join(",")!==
      "study-fixed:cup,study-fixed:notebook,study-fixed:blanket" ||
      finalId!=="study-fixed:cup" ||
      !products.some(item=>item.source_product_id===finalId) ||
      existing.some(item=>!expected.delete(`${item.profile_code}:${item.condition}`) ||
        JSON.stringify(item.candidate_snapshots)!==baseline || item.final_product_id!==finalId) || expected.size)
      throw new Error("RECIPIENT_STIMULUS_CONTROL_MISMATCH");
    if (existing.some(item=>{
      const transcript=Array.isArray(item.transcript)?item.transcript:[];
      const count=(kind:string)=>transcript.filter((message:any)=>message.kind===kind).length;
      const final=transcript.find((message:any)=>message.kind==="final_selection");
      return count("final_selection")!==1 || final?.payload?.source_product_id!==finalId ||
        final?.speaker!==(["A","B"].includes(item.condition)?"giver":"agent") ||
        (["A","B"].includes(item.condition) && transcript.filter((message:any)=>message.phase==="decision").length<6) ||
        (["A","C"].includes(item.condition)
          ? count("candidate_request")!==3 || count("candidate_proposal")!==3 || count("candidate_confirmed")!==3
          : count("candidate_batch")!==1);
    })) throw new Error("RECIPIENT_STIMULUS_DIALOGUE_INVALID");
    const {data:verified,error:productError}=await db.from("study_products").select("*")
      .in("source_product_id",products.map(item=>item.source_product_id));
    if (productError) throw productError;
    if (verified?.length!==3 || products.some(snapshot=>{
      const source=verified.find(item=>item.source_product_id===snapshot.source_product_id);
      return !source?.reviewed ||
        source.dataset_version!==FIXED_STUDY_DATASET_VERSION ||
        source.price_krw>RECIPIENT_SEARCH_PROFILE.gift_budget ||
        source.name_original!==snapshot.name_original || source.price_krw!==snapshot.price_krw ||
        source.image_url!==snapshot.image_url;
    })) throw new Error("RECIPIENT_STIMULUS_SOURCE_MISMATCH");
    const {error:approvalError}=await db.from("study_stimuli")
      .update({approved_at:new Date().toISOString(),approved_by:"researcher-reviewed"})
      .eq("stimulus_version",RECIPIENT_STIMULUS_VERSION).is("approved_at",null);
    if (approvalError) throw approvalError;
    return NextResponse.json(preview(await rows(db)));
  } catch (cause) {
    console.error("Recipient stimulus approval failed",{action:parsed.data.action,cause});
    return NextResponse.json({error:"관찰 자료를 승인하지 못했습니다. 고정 상품과 대본을 확인해 주세요."},{status:503});
  }
}
