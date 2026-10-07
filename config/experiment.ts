export const EXPERIMENT = {
  version: "1.0.0",
  uiVersion: "1.0.0",
  profileVersion: "profiles-v1",
  candidateVersion: "candidates-v1",
  promptVersion: "gift-prompt-v1",
  sequenceVersion: "williams-v1",
  participantsPerRole: 40,
  recipientPlaybackDurationMs: 90_000,
  guidedAnalysisDurationMs: 18_000,
  autonomousAnalysisDurationMs: 18_000,
  sequences: {
    S1: ["C1", "C2", "C4", "C3"],
    S2: ["C2", "C3", "C1", "C4"],
    S3: ["C3", "C4", "C2", "C1"],
    S4: ["C4", "C1", "C3", "C2"],
  } as const,
  conditions: {
    C1: { code: "guided_human", autonomy: "human_guided", authority: "human" },
    C2: { code: "guided_agent", autonomy: "human_guided", authority: "agent" },
    C3: { code: "autonomous_human", autonomy: "agent_autonomous", authority: "human" },
    C4: { code: "autonomous_agent", autonomy: "agent_autonomous", authority: "agent" },
  } as const,
  questions: [
    { id: "priority", text: "이 수혜자에게 선물을 고를 때 가장 중요한 요소는 무엇이라고 생각합니까?", options: ["취향 적합성", "실용성", "개인적 의미"] },
    { id: "context", text: "이 사람에게 선물이 가장 유용할 상황은 무엇이라고 생각합니까?", options: ["일상생활", "취미활동", "새로운 경험"] },
    { id: "trait", text: "당신이라면 어떤 특성을 우선하겠습니까?", options: ["편리함", "의미성", "재미"] },
  ],
} as const;

export const PROFILES = [
  { id: "R1", name: "민서", age: 29, occupation: "서비스 기획자", hobbies: ["러닝", "웰니스"] as string[], recent_interest: "운동 기록 관리와 꾸준한 활동 루틴에 관심이 있습니다.", preference: "일상에서 부담 없이 사용할 수 있는 물건을 선호합니다.", dislike: "관리 과정이 복잡한 제품은 선호하지 않습니다.", lifestyle_context: "평일에는 도심에서 생활하고 주말에는 야외 활동을 즐깁니다.", gift_budget: 50000, gift_occasion: "생일" },
  { id: "R2", name: "지훈", age: 31, occupation: "편집자", hobbies: ["커피", "독서"] as string[], recent_interest: "집에서 커피를 즐기는 방법과 새로운 책에 관심이 있습니다.", preference: "공간을 많이 차지하지 않고 오래 쓸 수 있는 물건을 선호합니다.", dislike: "향이 지나치게 강한 제품은 선호하지 않습니다.", lifestyle_context: "집에서 보내는 시간이 많고 조용한 여가를 즐깁니다.", gift_budget: 50000, gift_occasion: "감사 선물" },
  { id: "R3", name: "서연", age: 27, occupation: "마케터", hobbies: ["여행", "사진"] as string[], recent_interest: "가까운 곳을 천천히 둘러보며 사진으로 기록하는 데 관심이 있습니다.", preference: "휴대하기 쉽고 여러 상황에서 활용할 수 있는 물건을 선호합니다.", dislike: "무게가 많이 나가는 물건은 선호하지 않습니다.", lifestyle_context: "주말마다 근교를 방문하고 새로운 장소를 기록합니다.", gift_budget: 50000, gift_occasion: "생일" },
  { id: "R4", name: "도윤", age: 30, occupation: "연구원", hobbies: ["요리", "홈 라이프"] as string[], recent_interest: "집에서 간단한 요리를 만들고 식탁을 꾸미는 데 관심이 있습니다.", preference: "실용적이면서 디자인이 단정한 물건을 선호합니다.", dislike: "보관과 세척이 번거로운 제품은 선호하지 않습니다.", lifestyle_context: "평일 저녁과 주말에 집에서 식사를 준비합니다.", gift_budget: 50000, gift_occasion: "감사 선물" },
];

const BASE_CANDIDATES = [
  { product_name: "일상 기록 키트", category: "라이프스타일", price: 39000, description: "관심 있는 활동을 꾸준히 기록하고 정리할 수 있는 간결한 구성입니다.", preference_score: 4.4, practicality_score: 4.2, budget_score: 4.8, overall_score: 4.5 },
  { product_name: "컴팩트 데일리 세트", category: "생활용품", price: 45000, description: "자주 사용하는 상황에 맞춰 활용할 수 있는 실용적인 구성입니다.", preference_score: 4.2, practicality_score: 4.6, budget_score: 4.4, overall_score: 4.4 },
  { product_name: "취미 경험 바우처", category: "경험", price: 50000, description: "관심사를 새로운 방식으로 경험할 수 있도록 구성한 선택지입니다.", preference_score: 4.5, practicality_score: 4.0, budget_score: 4.0, overall_score: 4.2 },
];
const POOL_VARIANTS = [
  ["활동 기록 다이어리","문구",32000,4.2,4.1,4.9,4.3],
  ["취미 정리 파우치","생활용품",42000,4.1,4.5,4.6,4.4],
  ["주말 체험 클래스권","경험",48000,4.5,4.0,4.2,4.3],
  ["맞춤형 소품 세트","라이프스타일",36000,4.3,4.3,4.9,4.4],
  ["간편 휴대 액세서리","생활용품",29000,4.0,4.5,5.0,4.3],
  ["취향 탐색 키트","경험",46000,4.6,4.0,4.4,4.4],
  ["데일리 활용 텀블러","생활용품",35000,4.1,4.6,4.9,4.4],
];
export const CANDIDATES = Object.fromEntries(PROFILES.map((p) => [p.id, [
  ...BASE_CANDIDATES.map((c,i)=>({...c,code:`${p.id}-${String.fromCharCode(65+i)}`,fit_reason:`${p.hobbies[0]}과 관련된 관심을 일상에서 이어가는 데 도움이 됩니다.`})),
  ...POOL_VARIANTS.map((v,i)=>({code:`${p.id}-${String.fromCharCode(68+i)}`,product_name:v[0] as string,category:v[1] as string,price:v[2] as number,description:`${p.recent_interest}와 생활 맥락을 고려한 선택지입니다.`,fit_reason:`${p.hobbies[i%2]} 관심과 일상 선호를 함께 고려했습니다.`,preference_score:v[3] as number,practicality_score:v[4] as number,budget_score:v[5] as number,overall_score:v[6] as number})),
]]));
