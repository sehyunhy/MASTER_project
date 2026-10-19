import { verifiedEvidence } from "@/lib/study/agent";
import type { LiveStudyProduct } from "@/lib/study/live-shopping";
import { RECIPIENT_STIMULUS_VERSION, RECIPIENT_STORY } from "@/lib/study/recipient-context";

const profiles = ["R1", "R2", "R3", "R4"] as const;
const conditions = ["A", "B", "C", "D"] as const;

type Preparation = {
  products: LiveStudyProduct[];
  finalId: string;
  evidenceQuotes: string[];
  searchModel: string;
  searchResponseId: string;
  candidateModel: string;
  candidateResponseId: string;
  finalModel: string;
  finalResponseId: string;
};

export function recipientStimulusRows(input: Preparation) {
  if (input.products.length !== 3 || new Set(input.products.map(item => item.source_product_id)).size !== 3 ||
    !input.products.some(item => item.source_product_id === input.finalId))
    throw new Error("RECIPIENT_STIMULUS_PRODUCTS_INVALID");

  const snapshots = input.products.map((product, index) => ({
    ...product,
    evidence_quote: verifiedEvidence(product, input.evidenceQuotes[index]),
    reason: `확인된 상품 설명: “${verifiedEvidence(product, input.evidenceQuotes[index])}”`,
  }));
  const selected = snapshots.find(item => item.source_product_id === input.finalId)!;
  const finalReason = `${selected.name_ko}을(를) 최종 선물로 정했습니다. 확인된 상품 설명: “${selected.evidence_quote}”`;
  const metadata = {
    search_model: input.searchModel, search_response_id: input.searchResponseId,
    candidate_model: input.candidateModel, candidate_response_id: input.candidateResponseId,
    final_model: input.finalModel, final_response_id: input.finalResponseId,
  };
  const message = (phase: string, speaker: "giver"|"agent", kind: string,
    content: string, offset_ms: number, payload: Record<string, unknown> = {}) =>
    ({phase,speaker,kind,content,offset_ms,payload});

  return profiles.flatMap(profile_code => conditions.map(condition => {
    const transcript: ReturnType<typeof message>[] = [
      message("candidates","agent","text",RECIPIENT_STORY,0,{preparation:metadata}),
    ];
    if (condition === "A" || condition === "C") {
      snapshots.forEach((product, index) => {
        const base = [1_000,9_000,17_000][index];
        transcript.push(
          message("candidates","giver","candidate_request",
            `친구 A의 생일 선물로 ${product.category} 종류에서 후보 한 개를 찾아줘.`,base),
          message("candidates","agent","candidate_proposal",
            `확인한 상품 정보에서 후보 ${index+1}을(를) 제시합니다.`,base+3_000,{product}),
          message("candidates","giver","candidate_confirmed",
            `${product.name_ko}을(를) 후보 ${index+1}에 담겠습니다.`,base+6_000,{product}),
        );
      });
    } else {
      transcript.push(message("candidates","agent","candidate_batch",
        "친구 A를 위한 생일 선물 후보 세 개를 한 번에 보여드립니다.",4_000,{candidates:snapshots}));
    }
    const finalSpeaker = condition === "A" || condition === "B" ? "giver" : "agent";
    transcript.push(
      message("decision",finalSpeaker,"text","세 후보의 확인된 상품 정보를 비교했습니다.",0),
      message("decision",finalSpeaker,"final_selection",finalReason,5_000,
        {source_product_id:input.finalId,preparation:metadata}),
    );
    return {
      profile_code,condition,stimulus_version:RECIPIENT_STIMULUS_VERSION,
      origin:"scripted",transcript,candidate_snapshots:snapshots,
      final_product_id:input.finalId,approved_at:null,approved_by:null,
    };
  }));
}
