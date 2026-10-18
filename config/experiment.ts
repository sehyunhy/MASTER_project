import v5Stimuli from "./gift-stimuli-v5-neutral.json";

export const MINIMUM_EXPOSURE_MS = {
  practice: { giver: 15_000, recipient: 15_000 },
  experiment: { giver: 60_000, recipient: 60_000 },
} as const;
export const MAXIMUM_EXPOSURE_MS = 180_000;

export const EXPERIMENT = {
  version: "6.0.0",
  uiVersion: "6.0.0",
  profileVersion: "profiles-v3-neutral-v6",
  candidateVersion: "walmart-2024-08-curated-v2",
  promptVersion: "gift-agent-v4",
  sequenceVersion: "williams-v6",
  participantsPerRole: 30,
  enrollmentBlockSize: 5,
  minimumPhaseExposureMs: MINIMUM_EXPOSURE_MS.experiment.giver,
  maximumPhaseExposureMs: MAXIMUM_EXPOSURE_MS,
  heartbeatIntervalMs: 3_000,
  guidedAnalysisDurationMs: 5_000,
  autonomousAnalysisDurationMs: 5_000,
  sequences: {
    V6S1: ["C1", "C2", "C4", "C3"],
    V6S2: ["C2", "C3", "C1", "C4"],
    V6S3: ["C3", "C4", "C2", "C1"],
    V6S4: ["C4", "C1", "C3", "C2"],
  } as const,
  conditions: {
    C1: { label: "A · 순차 협업 후 사람 확정", screenLabel: "A", code: "human_human", candidateBuilder: "human", candidateMode: "human_sequential", autonomy: "human_guided", authority: "human" },
    C3: { label: "B · Agent 일괄 구성 후 사람 확정", screenLabel: "B", code: "agent_human", candidateBuilder: "agent", candidateMode: "agent_batch", autonomy: "agent_autonomous", authority: "human" },
    C2: { label: "C · 순차 협업 후 Agent 확정", screenLabel: "C", code: "human_agent", candidateBuilder: "human", candidateMode: "human_sequential", autonomy: "human_guided", authority: "agent" },
    C4: { label: "D · Agent 일괄 구성·확정", screenLabel: "D", code: "agent_agent", candidateBuilder: "agent", candidateMode: "agent_batch", autonomy: "agent_autonomous", authority: "agent" },
  } as const,
  questions: [
    { id: "priority", text: "이 선물 받는 사람에게 선물을 고를 때 가장 중요한 요소는 무엇이라고 생각합니까?", options: ["취향 적합성", "실용성", "감성적"] },
    { id: "context", text: "이 사람에게 선물이 가장 유용할 상황은 무엇이라고 생각합니까?", options: ["일상생활", "취미활동", "새로운 경험"] },
    { id: "trait", text: "당신이라면 어떤 특성을 우선하겠습니까?", options: ["편리함", "의미성", "재미"] },
  ],
} as const;

export const PROFILES = v5Stimuli.profiles;
