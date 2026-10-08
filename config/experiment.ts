export const EXPERIMENT = {
  version: "4.0.0",
  uiVersion: "4.0.0",
  profileVersion: "profiles-v2",
  candidateVersion: "walmart-2024-08-curated-v2",
  promptVersion: "gift-agent-v4",
  sequenceVersion: "williams-v1",
  participantsPerRole: 40,
  minimumPhaseExposureMs: 20_000,
  heartbeatIntervalMs: 3_000,
  guidedAnalysisDurationMs: 5_000,
  autonomousAnalysisDurationMs: 5_000,
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
    { id: "priority", text: "이 선물 받는 사람에게 선물을 고를 때 가장 중요한 요소는 무엇이라고 생각합니까?", options: ["취향 적합성", "실용성", "감성적"] },
    { id: "context", text: "이 사람에게 선물이 가장 유용할 상황은 무엇이라고 생각합니까?", options: ["일상생활", "취미활동", "새로운 경험"] },
    { id: "trait", text: "당신이라면 어떤 특성을 우선하겠습니까?", options: ["편리함", "의미성", "재미"] },
  ],
} as const;

export const PROFILES = [
  { id: "R1v2", name: "민서", age: 29, occupation: "서비스 기획자", hobbies: ["일상 관리", "스킨케어"] as string[], recent_interest: "집에서 쓰는 스킨케어와 세정 제품에 관심이 있습니다.", preference: "일상에서 부담 없이 사용할 수 있는 물건을 선호합니다.", dislike: "관리 과정이 복잡한 제품은 선호하지 않습니다.", lifestyle_context: "평일에는 도심에서 생활하고 집에서 일상 관리 시간을 보냅니다.", gift_budget: 50000, gift_occasion: "생일" },
  { id: "R2v2", name: "지훈", age: 31, occupation: "편집자", hobbies: ["독서", "집에서 쉬는 시간"] as string[], recent_interest: "집에서 책을 읽고 휴식을 취하는 공간에 관심이 있습니다.", preference: "집에서 자주 사용할 수 있는 패브릭 소품을 선호합니다.", dislike: "향이 지나치게 강한 제품은 선호하지 않습니다.", lifestyle_context: "집에서 보내는 시간이 많고 조용한 여가를 즐깁니다.", gift_budget: 50000, gift_occasion: "감사 선물" },
  { id: "R3v2", name: "서연", age: 27, occupation: "마케터", hobbies: ["사진 기록", "작은 공간 꾸미기"] as string[], recent_interest: "찍은 사진을 전시하고 집의 작은 공간을 꾸미는 데 관심이 있습니다.", preference: "공간에 어울리는 소품을 선호합니다.", dislike: "지나치게 큰 물건은 선호하지 않습니다.", lifestyle_context: "주말에 사진을 정리하고 집의 공간을 꾸밉니다.", gift_budget: 50000, gift_occasion: "생일" },
  { id: "R4v2", name: "도윤", age: 30, occupation: "연구원", hobbies: ["요리", "식탁 꾸미기"] as string[], recent_interest: "집에서 간단한 요리를 만들고 식탁을 꾸미는 데 관심이 있습니다.", preference: "실용적이면서 디자인이 단정한 물건을 선호합니다.", dislike: "보관과 세척이 번거로운 제품은 선호하지 않습니다.", lifestyle_context: "평일 저녁과 주말에 집에서 식사를 준비합니다.", gift_budget: 50000, gift_occasion: "감사 선물" },
];
