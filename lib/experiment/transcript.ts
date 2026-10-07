export async function storeTranscriptMessage(db: any, input: {
  trialId: string; phase: string; actorType: "participant"|"agent"|"system"|"simulated_giver";
  messageType: "text"|"product_cards"|"comparison"|"task_request"|"decision";
  content: string; payload?: Record<string,unknown>; idempotencyKey: string; simulatedActorEvent?: boolean;
  eventOrigin?: "participant"|"scripted"|"recorded"|"system"; transcriptId?:string; stimulusVersion?:number;
}) {
  const { data, error } = await db.from("trial_messages").upsert({
    trial_id:input.trialId, phase:input.phase, actor_type:input.actorType, message_type:input.messageType,
    content:input.content, payload:input.payload??{}, idempotency_key:input.idempotencyKey,
    simulated_actor_event:input.simulatedActorEvent??false,
    event_origin:input.eventOrigin??(input.simulatedActorEvent?"scripted":input.actorType==="agent"||input.actorType==="system"?"system":"participant"),
    transcript_id:input.transcriptId??null,stimulus_version:input.stimulusVersion??null,
  },{onConflict:"trial_id,idempotency_key"}).select("id,trial_id,phase,actor_type,message_type,content,payload,idempotency_key,rendered_at,simulated_actor_event,created_at").single();
  if (error) throw error;
  return data;
}

export function buildComparison(candidates: any[]) {
  const ordered=[...candidates].sort((a,b)=>a.display_order-b.display_order);
  return ordered.map(candidate=>{
    const p=candidate.product_snapshot??candidate.gift_candidates?.product_snapshot??{};
    return {
      label:String.fromCharCode(64+candidate.display_order),
      product_name:p.product_name??candidate.gift_candidates?.product_name,
      price:p.price??candidate.gift_candidates?.price,
      currency:p.currency??"KRW",
      configuration:Array.isArray(p.specifications)?p.specifications.slice(0,3).map((item:any)=>`${item.name}: ${item.value}`).join(" · ")||"정보 없음":p.specifications?.configuration_label??"정보 없음",
      use_case:Array.isArray(p.use_cases)?p.use_cases.join(" · "):"정보 없음",
      strengths:Array.isArray(p.strengths)?p.strengths.join(" · "):"정보 없음",
      limitations:Array.isArray(p.limitations)?p.limitations.join(" · "):"정보 없음",
      care_requirements:p.care_requirements??"정보 없음",
    };
  });
}

export function comparisonSummary(rows: ReturnType<typeof buildComparison>) {
  if (rows.length !== 3) throw new Error("Comparison requires exactly three displayed candidates.");
  const prices=rows.map(row=>Number(row.price));
  const low=rows[prices.indexOf(Math.min(...prices))];
  const high=rows[prices.indexOf(Math.max(...prices))];
  return `${low.label}번은 ${low.product_name}으로 ${Number(low.price).toLocaleString()}원이며, ${low.strengths}. ${high.label}번은 ${high.product_name}으로 ${Number(high.price).toLocaleString()}원이며, ${high.limitations}. 세 후보의 사용 상황·규격·관리 방식은 아래 표에서 같은 기준으로 비교할 수 있습니다.`;
}
