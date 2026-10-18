import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { proposeThree, chooseFinal } from "@/lib/study/agent";
import { searchLiveProducts } from "@/lib/study/live-shopping";
import { RECIPIENT_SEARCH_PROFILE, RECIPIENT_STIMULUS_VERSION } from "@/lib/study/recipient-context";
import { recipientStimulusRows } from "@/lib/study/recipient-stimulus";

export const maxDuration = 120;

const bodySchema = z.object({action:z.enum(["prepare","approve"])});

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
    candidates:first?.candidate_snapshots??[],finalProductId:first?.final_product_id??null};
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
    if (parsed.data.action==="prepare") {
      if (existing.length) return NextResponse.json({error:"이미 준비한 관찰 자료가 있습니다. 내용을 확인해 주세요.",...preview(existing)},{status:409});
      const search=await searchLiveProducts({
        request:"A birthday gift for an adult friend. The vignette gives no age, gender or specific tastes. Find diverse, generally suitable physical gift products under the study budget; do not assume interests.",
        profile:RECIPIENT_SEARCH_PROFILE,excludedIds:[],minimum:3,
      });
      if (search.products.length<3) throw new Error("RECIPIENT_WEB_PRODUCTS_INCOMPLETE");
      const selected=await proposeThree({profile:RECIPIENT_SEARCH_PROFILE,condition:"B",products:search.products});
      const products=selected.value.product_ids.map(productId=>search.products.find(item=>item.source_product_id===productId)!);
      const final=await chooseFinal({profile:RECIPIENT_SEARCH_PROFILE,condition:"D",products});
      const {error:productError}=await db.from("study_products").upsert(products,{onConflict:"source_product_id"});
      if (productError) throw productError;
      const prepared=recipientStimulusRows({products,finalId:final.value.product_id,
        evidenceQuotes:selected.value.evidence_quotes,searchModel:search.model,
        searchResponseId:search.responseIds.join(","),candidateModel:selected.model,
        candidateResponseId:selected.responseId,finalModel:final.model,finalResponseId:final.responseId});
      const {error:insertError}=await db.from("study_stimuli").insert(prepared);
      if (insertError) throw insertError;
      return NextResponse.json(preview(await rows(db)));
    }
    if (existing.length!==16 || existing.some(item=>item.approved_at))
      return NextResponse.json({error:"확정할 관찰 자료 16개를 먼저 준비해 주세요.",...preview(existing)},{status:409});
    const expected=new Set(["R1","R2","R3","R4"].flatMap(profile=>["A","B","C","D"].map(condition=>`${profile}:${condition}`)));
    const baseline=JSON.stringify(existing[0].candidate_snapshots);
    const finalId=existing[0].final_product_id;
    const products=existing[0].candidate_snapshots as {source_product_id:string;name_original:string;price_krw:number;image_url:string;dataset_version:string}[];
    if (products.length!==3 || new Set(products.map(item=>item.source_product_id)).size!==3 ||
      !products.some(item=>item.source_product_id===finalId) ||
      existing.some(item=>!expected.delete(`${item.profile_code}:${item.condition}`) ||
        JSON.stringify(item.candidate_snapshots)!==baseline || item.final_product_id!==finalId) || expected.size)
      throw new Error("RECIPIENT_STIMULUS_CONTROL_MISMATCH");
    const {data:verified,error:productError}=await db.from("study_products").select("*")
      .in("source_product_id",products.map(item=>item.source_product_id));
    if (productError) throw productError;
    if (verified?.length!==3 || products.some(snapshot=>{
      const source=verified.find(item=>item.source_product_id===snapshot.source_product_id);
      return !source?.reviewed || !source.dataset_version.startsWith("live-web-") ||
        source.price_krw>RECIPIENT_SEARCH_PROFILE.gift_budget ||
        source.name_original!==snapshot.name_original || source.price_krw!==snapshot.price_krw ||
        source.image_url!==snapshot.image_url;
    })) throw new Error("RECIPIENT_STIMULUS_SOURCE_MISMATCH");
    const {error:approvalError}=await db.from("study_stimuli")
      .update({approved_at:new Date().toISOString(),approved_by:"researcher-reviewed-live-web"})
      .eq("stimulus_version",RECIPIENT_STIMULUS_VERSION).is("approved_at",null);
    if (approvalError) throw approvalError;
    return NextResponse.json(preview(await rows(db)));
  } catch (cause) {
    console.error("Recipient stimulus preparation failed",{action:parsed.data.action,cause});
    return NextResponse.json({error:"상품이나 관찰 자료를 준비하지 못했습니다. 판매 페이지와 Claude 검색 설정을 확인해 주세요."},{status:503});
  }
}
