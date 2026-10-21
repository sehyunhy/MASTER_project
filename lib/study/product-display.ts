type DisplayProduct = {
  source_product_id: string;
  category: string;
  description_original: string;
  reason?: string;
};

// These summaries restate the nine reviewed rows in study-prepared-nine.sql.
// Keep source text in the product snapshot; do not infer extra benefits here.
const preparedFacts: Record<string, { category: string; spec: string; info: string }> = {
  "walmart-csv:3440558193": { category: "얼굴용 세럼", spec: "1oz", info: "비타민 C 유도체와 아젤라산이 들어간 얼굴용 세럼입니다. 무향 제품으로 소개되어 있습니다." },
  "walmart-csv:2010024322": { category: "바디워시", spec: "20oz", info: "워터멜론·피오니 향의 바디워시입니다. 히알루론산과 나이아신아마이드 등이 성분으로 소개됩니다." },
  "walmart-csv:1093743201": { category: "담요", spec: "90×104인치", info: "짙은 회색의 와플 무늬 플리스 담요입니다. 마이크로파이버 폴리에스터 소재입니다." },
  "walmart-csv:1097677016": { category: "베개커버", spec: "2개 · 각 20×30인치", info: "면 100% 소재이며 다마스크 줄무늬 새틴 직조로 소개됩니다." },
  "walmart-csv:973604797": { category: "사진 액자", spec: "8×10인치 · 5×7인치 사진용", info: "검은색 사진 액자입니다. 사진용 매트가 있으며 탁상이나 벽에 놓을 수 있습니다." },
  "walmart-csv:3511393855": { category: "러그", spec: "2×3피트", info: "베이지색 러그입니다. 폴리프로필렌 소재와 얼룩 방지 특성이 상품 설명에 기재되어 있습니다." },
  "walmart-csv:10308385": { category: "시즈닝", spec: "6oz", info: "18가지 허브와 향신료를 섞었습니다. 해산물 외 다양한 음식에도 사용할 수 있다고 소개됩니다." },
  "walmart-csv:36995775": { category: "시즈닝", spec: "21oz", info: "소금을 넣지 않은 시즈닝입니다. 카옌페퍼·커민·바질·마늘 등 14가지 이상의 향신료가 들어갑니다." },
  "walmart-csv:14123516": { category: "파스타 소스", spec: "24oz", info: "토마토·양파·셀러리·당근·주키니·피망이 들어간 파스타 소스입니다." },
};

const fixedSpecs: Record<string,string> = {
  "study-fixed:cup": "세라믹 머그 2개",
  "study-fixed:notebook": "노트 2권·펜 1개",
  "study-fixed:blanket": "단색 담요 1개",
};

// P02의 세 상품은 가상 자극물이다. 확인된 구성·용도·가격만으로 쓴 추천 이유를
// 고정하여 네 조건에서 같은 내용을 보여준다.
const fixedRecommendationReasons: Record<string, readonly [string,string,string]> = {
  "study-fixed:cup": [
    "세라믹 머그 2개 세트라 함께 음료를 마시는 장면을 떠올릴 수 있습니다.",
    "일상에서 사용하는 컵이어서 생일 이후에도 쓰임이 분명합니다.",
    "32,000원으로 제시된 50,000원 예산 안에서 고를 수 있습니다.",
  ],
  "study-fixed:notebook": [
    "노트 2권과 펜 1개가 한 세트라 바로 기록을 시작할 수 있습니다.",
    "하루의 생각이나 할 일을 적는 용도로 활용할 수 있습니다.",
    "28,000원으로 세 후보 중 가격이 가장 낮습니다.",
  ],
  "study-fixed:blanket": [
    "실내에서 무릎에 덮어 쓰는 용도가 분명한 선물입니다.",
    "단색 담요라 강한 무늬 없이 생활 공간에 둘 수 있습니다.",
    "42,000원으로 제시된 50,000원 예산에 맞습니다.",
  ],
};

export function productRecommendationReasonsKo(product: DisplayProduct): string[] {
  const reason = productReasonKo(product);
  return reason.split(/\n+/).map(line => line.replace(/^[•\-]\s*/, "").trim()).filter(Boolean);
}

export function productCategoryKo(product: DisplayProduct): string {
  return preparedFacts[product.source_product_id]?.category ?? product.category;
}

export function productSpecKo(product: DisplayProduct): string {
  return preparedFacts[product.source_product_id]?.spec ?? fixedSpecs[product.source_product_id] ?? "정보 없음";
}

export function productInfoKo(product: DisplayProduct): string {
  const prepared = preparedFacts[product.source_product_id];
  if (prepared) return prepared.info;
  const info = product.description_original
    .split("연구용 예시 후기")[0]
    .replace(/^연구용 가상 상품입니다\.\s*상품 정보:\s*/, "")
    .trim();
  return /[가-힣]/.test(info) ? info : "상품의 원문 정보는 상세 보기에서 확인할 수 있습니다.";
}

export function productReasonKo(product: DisplayProduct): string {
  const reason = product.reason?.trim() ?? "";
  const fixedReasons = fixedRecommendationReasons[product.source_product_id];
  if (fixedReasons && (!reason || reason === "연구용 가상 상품입니다. 상품 정보와 예시 후기를 확인해 주세요."))
    return fixedReasons.map(item => `• ${item}`).join("\n");
  // Older snapshots quote the English CSV description. Show its reviewed Korean
  // facts instead, while preserving the full recorded reason in the database.
  if (!reason || preparedFacts[product.source_product_id] && /[A-Za-z]{4,}/.test(reason))
    return `종이 프로필과 상품 종류·가격을 비교해 제시한 후보입니다.`;
  return reason;
}

export function productExampleReviewKo(product: DisplayProduct): string | null {
  return product.description_original.split("연구용 예시 후기(실제 구매 후기 아님):")[1]?.trim() ?? null;
}
