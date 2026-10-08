import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropicModel, shortResponseOptions } from "@/lib/agent/model";
import { EXPERIMENT } from "@/config/experiment";

const intentSchema=z.object({
  intent:z.enum(["criteria_update","search_request","compare_request","explain","final_choice","clarify"]),
  selected_category:z.string().nullable(),
  preference_tags:z.array(z.string()).max(5),
  selection_priority:z.enum(["취향 적합성","실용성","개인적 의미"]).nullable(),
  final_ordinal:z.number().int().min(1).max(3).nullable(),
  clarification:z.string().max(180).nullable(),
});
export type MessageIntent=z.infer<typeof intentSchema>;

function client() {
  if(!process.env.ANTHROPIC_API_KEY)throw new Error("Claude API 환경변수 ANTHROPIC_API_KEY를 설정해 주세요.");
  return {api:new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY}),model:anthropicModel()};
}

export async function interpretMessage(input:{text:string;phase:string;condition:string;allowedCategories:string[];allowedTags:string[]}):Promise<MessageIntent>{
  const {api,model}=client();
  const response=await api.messages.create({
    model,max_tokens:350,...shortResponseOptions(model),
    system:"You classify a Korean gift-shopping utterance for a controlled experiment. Use only explicitly mentioned preferences; never infer demographics or alter scenario/budget. A standalone mention of 실용성, 취향 적합성, or 개인적 의미 is a criteria_update with that selection_priority, even if no product tag is available. final_choice requires an unambiguous ordinal 1-3. A request to compare is compare_request; a request to find/recommend candidates is search_request. If ambiguous, clarify. Return exactly one interpret_message tool call.",
    messages:[{role:"user",content:JSON.stringify(input)}],
    tools:[{name:"interpret_message",description:"Classify intent and explicit filters",input_schema:{type:"object",properties:{intent:{type:"string",enum:["criteria_update","search_request","compare_request","explain","final_choice","clarify"]},selected_category:{type:["string","null"]},preference_tags:{type:"array",items:{type:"string"}},selection_priority:{type:["string","null"],enum:["취향 적합성","실용성","개인적 의미",null]},final_ordinal:{type:["integer","null"]},clarification:{type:["string","null"]}},required:["intent","selected_category","preference_tags","selection_priority","final_ordinal","clarification"]}}],
    tool_choice:{type:"tool",name:"interpret_message"},
  });
  const block=response.content.find((part:any)=>part.type==="tool_use"&&part.name==="interpret_message") as any;
  const parsed=intentSchema.safeParse(block?.input);
  if(!parsed.success)throw new Error("Claude의 입력 해석 결과를 확인할 수 없습니다. 다시 표현해 주세요.");
  const result=parsed.data;
  if(result.selection_priority)result.preference_tags=result.preference_tags.filter(tag=>tag!==result.selection_priority);
  if(result.selected_category&&!input.allowedCategories.includes(result.selected_category))return {...result,intent:"clarify",selected_category:null,clarification:"이 시나리오에서 사용할 수 있는 상품 카테고리를 다시 선택해 주세요."};
  if(result.preference_tags.some(tag=>!input.allowedTags.includes(tag)))return {...result,intent:"clarify",preference_tags:[],clarification:"선택 가능한 특성을 다시 확인해 주세요."};
  return result;
}

const searchSchema=z.object({category:z.string().nullable(),tags:z.array(z.string()).max(5)});
const detailsSchema=z.object({source_product_ids:z.array(z.string()).min(1).max(3)});
const compareSchema=z.object({source_product_ids:z.array(z.string()).length(2).or(z.array(z.string()).length(3))});

/** Tool inputs are validated before any database call. Product fields are always read from DB. */
export async function explainWithCatalogTools(input:{db:any;trialId:string;profileCode:string;budget:number;question:string;state:any;candidateIds:string[]}):Promise<{text:string;toolCalls:string[];model:string}>{
  const {api,model}=client();
  const tools:any[]=[
    {name:"search_products",description:"Search eligible historical Walmart products inside this participant's profile and fixed budget",input_schema:{type:"object",properties:{category:{type:["string","null"]},tags:{type:"array",items:{type:"string"}}},required:["category","tags"]}},
    {name:"get_product_details",description:"Read current trial candidate records by source product ID",input_schema:{type:"object",properties:{source_product_ids:{type:"array",items:{type:"string"},minItems:1,maxItems:3}},required:["source_product_ids"]}},
    {name:"compare_products",description:"Read factual fields of two or three current candidates",input_schema:{type:"object",properties:{source_product_ids:{type:"array",items:{type:"string"},minItems:2,maxItems:3}},required:["source_product_ids"]}},
  ];
  const system=`You are a gift research assistant. You may explain only verified tool results. Do not invent products, prices, capabilities, sizes, availability or effects. CSV prices are August 2024 USD historical snapshots; experiment KRW is a fixed study conversion. Do not claim live sale availability. Never change the fixed budget or the actor's authority. Never include product names, prices or specifications in the free-text response; the server displays them from DB cards. Use neutral Korean and say 정보 없음 when needed. Allowed candidate source IDs: ${input.candidateIds.join(",")}.`;
  const messages:any[]=[{role:"user",content:input.question}];
  const toolCalls:string[]=[];
  for(let round=0;round<3;round++){
    const response:any=await api.messages.create({model,max_tokens:500,...shortResponseOptions(model),system,messages,tools,tool_choice:round===0?{type:"any"}:{type:"auto"}});
    const calls=response.content.filter((part:any)=>part.type==="tool_use");
    if(!calls.length){
      const raw=response.content.filter((part:any)=>part.type==="text").map((part:any)=>part.text).join(" ").trim();
      // Product facts in prose are unverified; facts are rendered from DB snapshots.
      const safe=raw && !/[₩$]|\d{2,}|\$/.test(raw)?raw:"표시된 상품 카드의 원본 정보와 고정 실험 가격을 확인해 주세요. 기록에 없는 특성은 정보 없음으로 다룹니다.";
      return {text:safe,toolCalls,model};
    }
    messages.push({role:"assistant",content:response.content});
    const results:any[]=[];
    for(const call of calls){
      let result:any;
      try {
        if(call.name==="search_products"){
          const v=searchSchema.parse(call.input);
          if(v.category&&v.category!==input.state.selected_category)throw new Error("CATEGORY_NOT_ALLOWED");
          if(v.tags.some(tag=>!input.state.preference_tags?.includes(tag)))throw new Error("TAG_NOT_ALLOWED");
          let query=input.db.from("product_catalog")
            .select("source_product_id,product_name_original,product_name_ko,category,price_experiment,currency_experiment,price_original,currency_original,specifications,description,image_url,search_tags_ko")
            .eq("dataset_version",EXPERIMENT.candidateVersion).eq("experiment_eligible",true).eq("is_active",true)
            .contains("profile_codes",[input.profileCode]).lte("price_experiment",input.budget);
          if(v.category)query=query.eq("category",v.category);
          if(v.tags.length)query=query.overlaps("search_tags_ko",v.tags);
          const stop=new Set(["want","need","gift","with","this","that","please","friend","product"]);
          const token=v.tags.length?null:String(input.state.query_text??"").replace(/[^A-Za-z0-9 ]/g," ").split(/\s+/).find(word=>word.length>=4&&!stop.has(word.toLowerCase()));
          if(token)query=query.or(`product_name_original.ilike.%${token}%,description.ilike.%${token}%`);
          const {data,error}=await query.order("source_product_id").limit(12);
          if(error)throw error;
          result=data??[];
        }else if(call.name==="get_product_details"||call.name==="compare_products"){
          const v=call.name==="get_product_details"?detailsSchema.parse(call.input):compareSchema.parse(call.input);
          if(v.source_product_ids.some(id=>!input.candidateIds.includes(id)))throw new Error("PRODUCT_NOT_IN_TRIAL");
          const {data,error}=await input.db.from("trial_candidates").select("product_snapshot")
            .eq("trial_id",input.trialId);
          if(error)throw error;
          result=(data??[]).map((x:any)=>x.product_snapshot).filter((x:any)=>v.source_product_ids.includes(x.source_product_id));
          if(result.length!==v.source_product_ids.length)throw new Error("PRODUCT_NOT_IN_TRIAL");
        }else throw new Error("UNKNOWN_TOOL");
      }catch(e){result={error:(e as Error).message};}
      toolCalls.push(call.name);
      results.push({type:"tool_result",tool_use_id:call.id,content:JSON.stringify(result)});
    }
    messages.push({role:"user",content:results});
  }
  return {text:"상품 카드에 표시된 기록 정보에 한해 설명할 수 있습니다.",toolCalls,model};
}

const presentationSchema=z.object({source_product_ids:z.array(z.string()).length(3),focus:z.enum(["관심사","실용성","예산"])});
export async function composeCandidateIntroduction(candidates:any[]):Promise<string>{
  const {api,model}=client();
  const facts=candidates.map(item=>({source_product_id:item.product_snapshot?.source_product_id,original_name:item.product_snapshot?.product_name_original,category:item.product_snapshot?.category,price_experiment:item.product_snapshot?.price,fit_reason:item.product_snapshot?.fit_reason}));
  const response=await api.messages.create({model,max_tokens:250,...shortResponseOptions(model),
    system:"Select all three provided product IDs in their exact order and select one focus. You must not add products or facts. The server renders names/prices/specs from its database.",
    messages:[{role:"user",content:JSON.stringify(facts)}],
    tools:[{name:"present_recommendation",description:"Choose only verified candidate IDs and a neutral comparison focus",input_schema:{type:"object",properties:{source_product_ids:{type:"array",items:{type:"string"},minItems:3,maxItems:3},focus:{type:"string",enum:["관심사","실용성","예산"]}},required:["source_product_ids","focus"]}}],
    tool_choice:{type:"tool",name:"present_recommendation"}});
  const block=response.content.find((part:any)=>part.type==="tool_use"&&part.name==="present_recommendation") as any;
  const parsed=presentationSchema.safeParse(block?.input);
  if(!parsed.success||parsed.data.source_product_ids.some((id,index)=>id!==facts[index].source_product_id))throw new Error("Claude가 현재 DB 후보 이외의 상품을 반환했습니다. 후보를 표시하지 않습니다.");
  return `기록된 상품 세 가지를 ${parsed.data.focus} 기준으로 살펴볼 수 있습니다. 상품명·가격·규격은 아래 DB 스냅샷을 확인해 주세요.`;
}

const finalChoiceSchema=z.object({source_product_id:z.string().min(1),reason_focus:z.enum(["관심사","실용성","예산"])});
/** AI may choose only one of the three persisted trial candidates. */
export async function chooseFinalProductWithClaude(candidates:any[]):Promise<{sourceProductId:string;reasonFocus:string;model:string}>{
  if(candidates.length!==3)throw new Error("CANDIDATES_NOT_READY");
  const {api,model}=client();
  const facts=candidates.map(item=>({source_product_id:item.product_snapshot?.source_product_id,category:item.product_snapshot?.category,price_experiment:item.product_snapshot?.price,fit_reason:item.product_snapshot?.fit_reason}));
  const response=await api.messages.create({model,max_tokens:200,...shortResponseOptions(model),
    system:"Choose exactly one of the three verified candidate source IDs for the gift. Use only the supplied facts, with neutral judgment. Never invent an ID or change the budget. Call choose_final_product once.",
    messages:[{role:"user",content:JSON.stringify(facts)}],
    tools:[{name:"choose_final_product",description:"Choose a final verified product",input_schema:{type:"object",properties:{source_product_id:{type:"string"},reason_focus:{type:"string",enum:["관심사","실용성","예산"]}},required:["source_product_id","reason_focus"]}}],
    tool_choice:{type:"tool",name:"choose_final_product"}});
  const block=response.content.find((part:any)=>part.type==="tool_use"&&part.name==="choose_final_product") as any;
  const parsed=finalChoiceSchema.safeParse(block?.input);
  if(!parsed.success||!facts.some(item=>item.source_product_id===parsed.data.source_product_id))throw new Error("AI_FINAL_PRODUCT_NOT_IN_TRIAL");
  return {sourceProductId:parsed.data.source_product_id,reasonFocus:parsed.data.reason_focus,model};
}
