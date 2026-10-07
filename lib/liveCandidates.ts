import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createHash } from "node:crypto";
import { candidateSystemPrompt, candidatePromptVersion } from "@/lib/prompts/candidateGeneration";

const schema = z.object({ candidates: z.array(z.object({ product_name:z.string(),category:z.string(),price:z.number().int(),description:z.string(),fit_reason:z.string(),preference_score:z.number().min(1).max(5),practicality_score:z.number().min(1).max(5),budget_score:z.number().min(1).max(5),overall_score:z.number().min(1).max(5) })).length(3) });
export async function generateLiveCandidates(profile: any) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("라이브 데모 모드에는 서버 환경변수 ANTHROPIC_API_KEY가 필요합니다.");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 25_000, maxRetries: 0 });
  let lastError: unknown;const started=Date.now();let attempts=0;
  for (let attempt=1; attempt<=2; attempt++) {
    attempts=attempt;
    try {
      const msg = await client.messages.create({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5", max_tokens: 1600, system: `${candidateSystemPrompt} Prompt version: ${candidatePromptVersion}. Output only JSON.`, messages:[{role:"user",content:JSON.stringify({recipient:profile,budget:profile.gift_budget,required:{candidate_count:3,fields:["product_name","category","price","description","fit_reason","preference_score","practicality_score","budget_score","overall_score"]}})}] });
      const raw = msg.content.find(c=>c.type==="text")?.text ?? "";
      const parsed = schema.parse(JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim()));
      const promptHash=createHash("sha256").update(candidateSystemPrompt+JSON.stringify({recipient:profile,budget:profile.gift_budget})).digest("hex");
      return {candidates:parsed.candidates.map(c=>({...c,image_url:null})),metadata:{model:msg.model,response_id:msg.id,latency_ms:Date.now()-started,prompt_version:candidatePromptVersion,prompt_hash:promptHash,attempts,temperature:null}};
    } catch(e) { lastError=e; }
  }
  throw new Error(`Live candidate generation failed after 2 attempts: ${lastError instanceof Error ? lastError.message : "invalid response"}`);
}
