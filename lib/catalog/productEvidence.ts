import { productSummaryKo } from "@/lib/catalog/productSummaryKo";

/** Source-checked descriptions of the twelve eligible Walmart products. */
type EvidenceGuide = {
  interests: readonly string[];
  purpose: string;
  practicalUse: string;
  emotionalInterpretation: string;
  distinction: string;
  consideration: string;
  bestCriterion: "실용성" | "취향 적합성" | "감성적";
};

const guides: Record<string, EvidenceGuide> = {
  "3440558193": { interests:["스킨케어","일상 관리"], purpose:"세안 후 바르는 스킨케어", practicalUse:"세안 후 아침이나 저녁의 관리 과정에 사용할 수 있습니다.", emotionalInterpretation:"상대가 집에서 보내는 스킨케어 시간을 떠올려 고른 선물이라는 뜻을 전할 수 있습니다.", distinction:"1온스 비타민 C 세럼이며 원본에 향료를 넣지 않았다고 기재된 점", consideration:"개인의 피부에 맞는지는 상품 기록만으로 확인할 수 없습니다.", bestCriterion:"취향 적합성" },
  "46280772": { interests:["스킨케어","일상 관리"], purpose:"매일 쓰는 손 관리", practicalUse:"건조한 손에 바르는 일상용 제품으로 소개되어 있습니다.", emotionalInterpretation:"상대의 일상적인 손 관리에 관심을 기울였다는 뜻을 전할 수 있습니다.", distinction:"3온스 핸드크림으로 원본에 매일 쓰는 용도가 소개된 점", consideration:"개인의 피부에 맞는지는 상품 기록만으로 확인할 수 없습니다.", bestCriterion:"실용성" },
  "2010024322": { interests:["스킨케어","일상 관리","세정"], purpose:"집에서 하는 세정", practicalUse:"집에서 사용하는 바디워시로 살펴볼 수 있습니다.", emotionalInterpretation:"상대의 집에서의 일상 관리에 맞춰 고른 선물이라는 뜻을 전할 수 있습니다.", distinction:"20온스 바디워시이며 워터멜론·피오니 향이 표기된 점", consideration:"향이 있는 제품이므로 향 선호와 개인의 피부 적합성은 별도로 확인해야 합니다.", bestCriterion:"실용성" },
  "1093743201": { interests:["집에서 쉬는 시간","독서","휴식"], purpose:"집에서 쉬는 시간", practicalUse:"킹사이즈 침대용 담요로 사용할 수 있다고 소개되어 있습니다.", emotionalInterpretation:"상대의 집에서 쉬는 시간을 고려했다는 뜻을 전할 수 있습니다.", distinction:"킹사이즈 침대용이며 양면의 무늬와 촉감 구성이 소개된 점", consideration:"사용할 침대나 공간에 킹사이즈가 맞는지 확인해야 합니다.", bestCriterion:"실용성" },
  "1097677016": { interests:["집에서 쉬는 시간","독서","패브릭"], purpose:"집에서 쓰는 침구 소품", practicalUse:"20×30인치 베갯잇 두 장을 침구에 사용할 수 있습니다.", emotionalInterpretation:"상대가 집에서 보내는 시간을 떠올려 고른 침구 선물이라는 뜻을 전할 수 있습니다.", distinction:"면 100% 베갯잇 두 장으로 구성된 점", consideration:"사용 중인 베개와 20×30인치 크기가 맞는지 확인해야 합니다.", bestCriterion:"실용성" },
  "891036133": { interests:["집에서 쉬는 시간","독서","패브릭"], purpose:"집 안 패브릭 소품", practicalUse:"16×16인치 쿠션 커버로 집 안의 기존 쿠션에 사용할 수 있습니다.", emotionalInterpretation:"상대가 집에서 쉬는 공간을 떠올려 고른 소품이라는 뜻을 전할 수 있습니다.", distinction:"앞면의 터프팅 무늬와 술 장식이 있는 16×16인치 커버인 점", consideration:"기존 쿠션의 크기가 맞는지 확인해야 합니다. 커버 외 구성품은 원본 기록을 확인해 주세요.", bestCriterion:"취향 적합성" },
  "973604797": { interests:["사진 기록","사진","공간 꾸미기"], purpose:"찍은 사진 전시", practicalUse:"사진을 탁자에 놓거나 벽에 걸어 전시할 수 있습니다.", emotionalInterpretation:"상대가 기록한 사진을 눈에 보이는 곳에 두도록 돕는 선물이라는 뜻을 전할 수 있습니다.", distinction:"8×10인치 액자와 5×7인치 사진용 매트가 함께 안내된 점", consideration:"전시할 사진 크기와 놓을 공간이 맞는지 확인해야 합니다.", bestCriterion:"감성적" },
  "3511393855": { interests:["작은 공간 꾸미기","공간 꾸미기","집"], purpose:"집의 작은 공간 꾸미기", practicalUse:"2×3피트 크기의 러그를 놓을 공간을 정해 사용할 수 있습니다.", emotionalInterpretation:"상대가 꾸미고 싶어 하는 공간을 기억해 고른 선물이라는 뜻을 전할 수 있습니다.", distinction:"베이지색 추상무늬의 2×3피트 러그인 점", consideration:"놓을 공간의 크기와 원본에 적힌 관리 방법을 확인해야 합니다.", bestCriterion:"취향 적합성" },
  "1825469871": { interests:["작은 공간 꾸미기","공간 꾸미기","집"], purpose:"현관 공간 꾸미기", practicalUse:"17×30인치 매트를 현관에 놓는 용도로 소개되어 있습니다.", emotionalInterpretation:"상대가 집에 들어설 때 보는 공간을 고려했다는 뜻을 전할 수 있습니다.", distinction:"현관용 17×30인치 매트이며 고무 뒷면이 기재된 점", consideration:"현관의 실제 크기와 사용 환경에 맞는지 확인해야 합니다.", bestCriterion:"실용성" },
  "10308385": { interests:["요리","식탁"], purpose:"집에서 하는 요리", practicalUse:"해산물과 채소 등에 시즈닝을 사용하는 예가 소개되어 있습니다.", emotionalInterpretation:"상대가 요리를 즐기는 시간을 기억해 고른 선물이라는 뜻을 전할 수 있습니다.", distinction:"6온스 캔의 혼합 시즈닝으로 해산물·채소 사용 예가 있는 점", consideration:"향신료 종류와 맛에 대한 개인의 선호는 원본 기록만으로 확인할 수 없습니다.", bestCriterion:"취향 적합성" },
  "36995775": { interests:["요리","식탁"], purpose:"집에서 하는 요리", practicalUse:"고기·채소·소스에 곁들이는 무염 시즈닝으로 소개되어 있습니다.", emotionalInterpretation:"상대가 여러 요리를 해 보는 관심사를 떠올려 고른 선물이라는 뜻을 전할 수 있습니다.", distinction:"21온스 병의 무염 혼합 시즈닝이며 고기·채소·소스 사용 예가 있는 점", consideration:"무염 맛이나 향신료 조합을 선호하는지는 확인해야 합니다.", bestCriterion:"취향 적합성" },
  "864008591": { interests:["식탁 꾸미기","식탁","홈 라이프"], purpose:"집에서 식탁 꾸미기", practicalUse:"식탁 위에 접시나 장식품을 놓는 상황에 사용할 수 있습니다.", emotionalInterpretation:"상대가 식탁을 꾸미는 시간을 떠올려 고른 선물이라는 뜻을 전할 수 있습니다.", distinction:"14×72인치 네이비 블루 테이블 러너인 점", consideration:"식탁의 크기와 디자인 취향에 맞는지 확인해야 합니다.", bestCriterion:"감성적" },
};

export type ProductEvidenceContext = {
  profile?: { name?: string; hobbies?: string[]; recent_interest?: string; preference?: string; dislike?: string; profile_code?: string };
  priorities?: string[];
  budget?: number;
  intimacyCondition?: "high" | "low" | null;
};

export type ProductRecommendation = {
  headline: string;
  recipientConnection: string;
  productEvidence: string;
  comparativeStrength: string;
  consideration: string;
};

type CandidateLike = {
  display_order?: number;
  product_snapshot?: Record<string, unknown>;
  gift_candidates?: Record<string, unknown>;
};

function productOf(candidate: CandidateLike): Record<string, unknown> {
  return candidate.product_snapshot && Object.keys(candidate.product_snapshot).length
    ? candidate.product_snapshot : candidate.gift_candidates ?? candidate as Record<string, unknown>;
}

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function asStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map(item => item.trim()) : []; }
function priceOf(candidate: CandidateLike): number | null {
  const raw = productOf(candidate).price;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
function labelOf(candidate: CandidateLike, index: number): string {
  const order = Number(candidate.display_order ?? index + 1);
  return Number.isInteger(order) && order >= 1 && order <= 26 ? String.fromCharCode(64 + order) : String(index + 1);
}
function recordFacts(product: Record<string, unknown>): string[] {
  const id = text(product.source_product_id);
  if (Object.prototype.hasOwnProperty.call(guides, id)) return [...productSummaryKo(id)];
  const facts: string[] = [];
  const name = text(product.product_name_original) || text(product.product_name);
  if (name) facts.push(`원본 상품명: ${name}`);
  const category = text(product.category);
  if (category) facts.push(`상품 분류: ${category}`);
  const specs = product.specifications;
  const entries = Array.isArray(specs) ? specs : specs && typeof specs === "object" ? Object.entries(specs).map(([key,value]) => ({name:key,value})) : [];
  for (const spec of entries.slice(0, 2)) {
    if (!spec || typeof spec !== "object") continue;
    const item = spec as {name?: unknown; value?: unknown};
    const key = text(item.name), value = text(item.value);
    if (key && value) facts.push(`${key}: ${value}`);
  }
  if (facts.length < 3) {
    const description = (text(product.description_original) || text(product.description))
      .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (description && description !== name) facts.push(`원본 설명 발췌: ${description.slice(0, 160)}${description.length > 160 ? "…" : ""}`);
  }
  return facts.length ? facts : ["원본 상품 정보에 확인 가능한 상세 항목이 없습니다."];
}

function profileInterest(guide: EvidenceGuide, profile: ProductEvidenceContext["profile"]): string | null {
  if (!profile) return null;
  const combined = [...asStrings(profile.hobbies), text(profile.recent_interest), text(profile.preference)].join(" ");
  return guide.interests.find(interest => combined.includes(interest)) ?? null;
}

function comparisonPoint(candidate: CandidateLike, allCandidates: CandidateLike[], guide: EvidenceGuide | undefined): string {
  const index = allCandidates.findIndex(item => item === candidate || (item.display_order === candidate.display_order && text(productOf(item).source_product_id) === text(productOf(candidate).source_product_id)));
  const price = priceOf(candidate);
  const others = allCandidates.map((item, otherIndex) => ({item, label:labelOf(item,otherIndex)})).filter((_, otherIndex) => otherIndex !== index);
  const otherPrices = others.map(({item}) => priceOf(item));
  if (price !== null && otherPrices.length === 2 && otherPrices.every(other => other !== null && price < other)) {
    return `세 후보 중 연구용 가격이 가장 낮아 고정 예산의 남는 금액이 가장 큽니다. ${guide ? `상품 구별점: ${guide.distinction}.` : ""}`.trim();
  }
  if (guide) {
    const otherUses = others.map(({item,label}) => `${label} 후보: ${guides[text(productOf(item).source_product_id)]?.purpose ?? (text(productOf(item).category) || "용도 정보 없음")}`);
    return `이 후보의 구별점은 ${guide.distinction}입니다. 다른 후보의 용도는 ${otherUses.join(" · ")}입니다.`;
  }
  if (price !== null && otherPrices.every(other => other !== null)) {
    return `연구용 가격은 ${price.toLocaleString()}원입니다. 다른 후보와의 가격·규격 차이를 확인해 주세요.`;
  }
  return "다른 후보와 비교할 수 있는 가격·구성 정보가 충분하지 않습니다.";
}

/** A display-only explanation. Never mutates frozen recipient product snapshots. */
export function buildProductRecommendation(candidate: CandidateLike, allCandidates: CandidateLike[], context: ProductEvidenceContext = {}): ProductRecommendation {
  const product = productOf(candidate);
  const guide = guides[text(product.source_product_id)];
  const facts = recordFacts(product);
  const interest = guide ? profileInterest(guide, context.profile) : null;
  const name = text(context.profile?.name) || "선물 받는 사람";
  const firstFact = facts[0] ?? "원본 상품 정보가 부족합니다.";
  const recordedUse = asStrings(product.use_cases)[0] || text(product.fit_reason);
  const connection = guide && interest
    ? `해석: ${name}님의 ${interest} 관심사와 연결됩니다. ${guide.practicalUse}`
    : recordedUse ? `연구용 상품 기록의 연결 설명: ${recordedUse}` : "현재 제공된 관심사와 이 상품의 직접적인 연결은 확인되지 않습니다.";
  return {
    headline: guide ? `${guide.bestCriterion} 기준 · ${firstFact}` : "원본 상품 정보를 확인한 뒤 적합성을 판단할 후보",
    recipientConnection: connection,
    productEvidence: `원본 정보: ${facts.slice(0, 2).join(" ")}`,
    comparativeStrength: comparisonPoint(candidate, allCandidates, guide),
    consideration: guide?.consideration ?? "원본 기록에 없는 사용 조건과 개인의 선호 적합성은 확인이 필요합니다.",
  };
}

export function buildProductComparisonEvidence(candidate: CandidateLike, allCandidates: CandidateLike[], context: ProductEvidenceContext = {}) {
  const product = productOf(candidate);
  const guide = guides[text(product.source_product_id)];
  const recommendation = buildProductRecommendation(candidate, allCandidates, context);
  const price = priceOf(candidate);
  const budget = Number(context.budget);
  const budgetFit = price !== null && Number.isFinite(budget) && budget >= 0
    ? price <= budget ? `고정 예산 ${budget.toLocaleString()}원 이내 · ${Math.max(0,budget-price).toLocaleString()}원 남음` : `고정 예산 ${budget.toLocaleString()}원 초과`
    : "예산 또는 가격 정보 없음";
  const interest = guide ? profileInterest(guide, context.profile) : null;
  const chosenPriorities = asStrings(context.priorities).map(value => value === "개인적 의미" ? "감성적" : value);
  const bestFor = guide
    ? `우선 기준: ${guide.bestCriterion}${chosenPriorities.includes(guide.bestCriterion) ? " (현재 선택됨)" : ""}. ${guide.purpose} 용도를 원할 때 살펴볼 수 있습니다.`
    : "원본 상품 정보와 선택 기준을 대조해 주세요.";
  return {
    budget_fit: budgetFit,
    core_features: recordFacts(product).join(" · "),
    recipient_fit: recommendation.recipientConnection,
    practicality: guide ? `활용 해석: ${guide.practicalUse}` : asStrings(product.use_cases)[0] ? `연구용 상품 기록: ${asStrings(product.use_cases)[0]}` : "사용 목적을 판단할 수 있는 검토된 한국어 정보가 없습니다.",
    emotional_meaning: guide && interest ? `의미 해석: ${guide.emotionalInterpretation} 이는 ${context.profile?.name ?? "선물 받는 사람"}님의 ${interest} 관심사를 바탕으로 한 해석이며, 실제 반응은 확인되지 않았습니다.` : "상대에게 전달될 의미는 현재 상품 기록과 관심사만으로 단정할 수 없습니다.",
    comparative_strength: recommendation.comparativeStrength,
    consideration: recommendation.consideration,
    best_for: bestFor,
  };
}
