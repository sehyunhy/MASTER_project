import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropicModel, shortResponseOptions } from "@/lib/agent/model";

export type StudyProduct = {
  source_product_id: string; name_ko: string; name_original: string;
  description_original: string; category: string; price_krw: number;
};
export type StudyProfile = {
  name: string; age: number; hobbies: string[]; recent_interest: string;
  preference: string; dislike: string; gift_budget: number;
};

function api() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY_MISSING");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function structured<T extends z.ZodTypeAny>(name: string, schema: T, input: {
  instructions: string; context: unknown; fields: Record<string, unknown>;
}): Promise<{ value: z.infer<T>; model: string; responseId: string; latencyMs: number }> {
  const model = anthropicModel();
  const began = performance.now();
  const response = await api().messages.create({
    model, max_tokens: 650, ...shortResponseOptions(model),
    system: input.instructions,
    messages: [{ role: "user", content: JSON.stringify({ context: input.context, ...input.fields }) }],
    tools: [{ name, description: "Return only the structured, source-grounded study decision", input_schema: {
      type: "object", properties: schemaToToolProperties(name), required: Object.keys(schemaToToolProperties(name)),
    } }],
    tool_choice: { type: "tool", name },
  });
  const block = response.content.find(part => part.type === "tool_use" && part.name === name);
  const value = schema.parse(block?.type === "tool_use" ? block.input : null);
  return { value, model, responseId: response.id, latencyMs: Math.round(performance.now() - began) };
}

function schemaToToolProperties(name: string): Record<string, unknown> {
  if (name === "propose_one") return {
    valid_request: { type: "boolean" }, clarification: { type: "string" },
    product_id: { type: "string" }, evidence_quote: { type: "string" },
  };
  if (name === "propose_three") return {
    product_ids: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
    evidence_quotes: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
  };
  return { product_id: { type: "string" }, evidence_quote: { type: "string" } };
}

const oneSchema = z.object({ valid_request: z.boolean(), clarification: z.string(), product_id: z.string(), evidence_quote: z.string() });
const batchSchema = z.object({ product_ids: z.array(z.string()).length(3), evidence_quotes: z.array(z.string()).length(3) });
const finalSchema = z.object({ product_id: z.string(), evidence_quote: z.string() });

export function verifiedEvidence(product: StudyProduct, quote: string) {
  const normalized=quote.trim();
  if (normalized.length<8 || normalized.length>160 ||
    !(product.name_original.includes(normalized)||product.description_original.includes(normalized)))
    throw new Error("AGENT_EVIDENCE_NOT_IN_SOURCE");
  return normalized;
}

export function groundedReason(profile: StudyProfile, product: StudyProduct, quote: string) {
  const evidence = verifiedEvidence(product,quote);
  return `${profile.name}님의 종이 프로필과 대조해 검토했습니다. 상품 기록에서 확인한 근거는 “${evidence}”입니다. 종류는 ${product.category}, 연구용 가격은 ${product.price_krw.toLocaleString()}원입니다.`;
}

export function isBroadDelegation(text: string) {
  const normalized = text.trim();
  return /^(선물|후보|상품)?\s*(추천|골라|찾아)\s*(해줘|해주세요|줘)?[.!?\s]*$/.test(normalized)
    || /^(그냥|알아서|네가|너가|아무거나).*(골라|추천|찾아|해)/.test(normalized)
    || /(?:3\s*개|세\s*개|여러\s*개|한\s*번에\s*다).*(?:추천|골라|찾아)/.test(normalized);
}

export function preflightHumanRequest(text: string, _profile: StudyProfile) {
  const normalized = text.trim();
  if (!normalized || isBroadDelegation(normalized))
    return "찾고 싶은 상품이나 사용 상황을 직접 적어 주세요. 모든 후보를 Agent에게 맡기는 요청은 사용할 수 없습니다.";
  return null;
}

const common = (profile: StudyProfile, condition: string, products: StudyProduct[], existing: StudyProduct[]) => ({
  condition, profile, budget_krw: profile.gift_budget, approved_product_pool: products,
  already_confirmed: existing.map(product => product.source_product_id),
  authority: condition === "A" || condition === "B" ? "human_final" : "agent_final",
});

export async function proposeOne(input: { profile: StudyProfile; condition: string; products: StudyProduct[]; existing: StudyProduct[]; request: string }) {
  const result = await structured("propose_one", oneSchema, {
    instructions: "You assist a Korean gift-choice study. The participant may freely explore product directions, including ones different from the supplied recipient profile. Do not reject a specific request just because its category or interest differs from that profile. Choose exactly ONE product ID from the supplied approved pool, excluding confirmed IDs, only if a product reasonably matches the requested direction. If no product reasonably matches, set valid_request=false and briefly tell the participant in Korean that a matching product is not currently available and they may revise the request. Do not disclose internal pool, approval, or product IDs in the clarification. Do not substitute an unrelated product or invent one. evidence_quote must be an exact 8-160 character substring of the chosen product's source name or description when valid_request=true. Never invent product facts. The server validates the ID and quote.",
    context: common(input.profile, input.condition, input.products, input.existing), fields: { participant_request: input.request },
  });
  if (result.value.valid_request && !input.products.some(product => product.source_product_id === result.value.product_id))
    throw new Error("AGENT_PRODUCT_OUTSIDE_POOL");
  if(result.value.valid_request)
    verifiedEvidence(input.products.find(product=>product.source_product_id===result.value.product_id)!,result.value.evidence_quote);
  return result;
}

export async function proposeThree(input: { profile: StudyProfile; condition: string; products: StudyProduct[] }) {
  const result = await structured("propose_three", batchSchema, {
    instructions: "You assist a Korean gift-choice study. Choose exactly three distinct product IDs from the supplied approved pool. For each in matching order provide evidence_quotes: an exact 8-160 character substring of that product's source name or source description. Do not ask the participant for criteria: this condition delegates candidate construction to you. The server validates IDs and quotes and displays product facts from the database.",
    context: common(input.profile, input.condition, input.products, []), fields: {},
  });
  if (new Set(result.value.product_ids).size !== 3 || result.value.product_ids.some(id => !input.products.some(product => product.source_product_id === id)))
    throw new Error("AGENT_PRODUCTS_OUTSIDE_POOL");
  result.value.product_ids.forEach((id,index)=>verifiedEvidence(input.products.find(product=>product.source_product_id===id)!,result.value.evidence_quotes[index]));
  return result;
}

export async function chooseFinal(input: { profile: StudyProfile; condition: string; products: StudyProduct[] }) {
  const result = await structured("choose_final", finalSchema, {
    instructions: "You are the final decision maker in this Korean gift-choice study condition. Select exactly one product ID from the three confirmed trial candidates. Provide evidence_quote as an exact 8-160 character substring of that product's source name or source description. Never invent features or prices. The server checks the choice and evidence.",
    context: common(input.profile, input.condition, input.products, input.products), fields: {},
  });
  if (!input.products.some(product => product.source_product_id === result.value.product_id))
    throw new Error("AGENT_FINAL_OUTSIDE_CANDIDATES");
  verifiedEvidence(input.products.find(product=>product.source_product_id===result.value.product_id)!,result.value.evidence_quote);
  return result;
}
