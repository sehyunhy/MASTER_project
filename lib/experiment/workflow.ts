import type { ConditionId } from "@/lib/types";

export type ExperimentPhase = "criteria" | "candidates" | "comparison" | "decision" | "awaiting_survey" | "completed";
export type TaskActor = "participant" | "agent" | "simulated_giver";
export const MIN_PHASE_EXPOSURE_MS = 60_000;
export const PHASE_ORDER: readonly ExperimentPhase[] = ["criteria", "candidates", "comparison", "decision", "awaiting_survey", "completed"];

export const CONDITION_RIGHTS = {
  C1: { candidateBuilder: "human", candidateMode: "human_sequential", decisionAuthority: "human", label: "A · 순차 협업 후 사람 확정" },
  C3: { candidateBuilder: "agent", candidateMode: "agent_batch", decisionAuthority: "human", label: "B · Agent 일괄 구성 후 사람 확정" },
  C2: { candidateBuilder: "human", candidateMode: "human_sequential", decisionAuthority: "agent", label: "C · 순차 협업 후 Agent 확정" },
  C4: { candidateBuilder: "agent", candidateMode: "agent_batch", decisionAuthority: "agent", label: "D · Agent 일괄 구성·확정" },
} as const;

export function conditionRoles(condition: ConditionId) { return CONDITION_RIGHTS[condition]; }
// There are exactly two timed experimental phases. Comparison and final decision
// share the second clock; surveys and code entry are outside experimental time.
export const EXPERIMENT_PHASES = ["candidates", "decision"] as const;
export type TimedExperimentPhase = typeof EXPERIMENT_PHASES[number];
export const MIN_EXPERIMENT_PHASE_MS = 60_000;
export const MAX_EXPERIMENT_PHASE_MS = 180_000;
export const TRANSITION_SEQUENCE_INDEXES = [1, 2, 3, 4] as const;

export function exposureMinutesPerRole() { return { min: 8, max: 24, surveys: 8 }; }

export function expectedTransitionPosition(nextTrialNumber: number) {
  return Number.isInteger(nextTrialNumber) && nextTrialNumber >= 1 && nextTrialNumber <= 4 ? nextTrialNumber : null;
}

export function nextPhase(phase: ExperimentPhase): ExperimentPhase | null {
  const index = PHASE_ORDER.indexOf(phase);
  return index >= 0 && index < PHASE_ORDER.length - 1 ? PHASE_ORDER[index + 1] : null;
}

export function exposureDeltaMs(lastHeartbeatMs: number | null, nowMs: number, active: boolean, maxGapMs = 5_000): number {
  if (!active || lastHeartbeatMs === null || nowMs < lastHeartbeatMs) return 0;
  const delta = nowMs - lastHeartbeatMs;
  return delta <= maxGapMs ? delta : 0;
}

export function phaseRemainingMs(accumulatedMs: number): number {
  return Math.max(0, MIN_EXPERIMENT_PHASE_MS - accumulatedMs);
}

export function taskActorAllowed(condition: ConditionId, actor: TaskActor, observerRole: boolean): boolean {
  if (observerRole) return actor === "simulated_giver" || actor === "agent";
  const owner = conditionRoles(condition).candidateBuilder === "human" ? "participant" : "agent";
  return owner === actor;
}

export function decisionActorAllowed(condition: ConditionId, actor: TaskActor, observerRole: boolean): boolean {
  if (observerRole) return actor === "simulated_giver" || actor === "agent";
  const owner = conditionRoles(condition).decisionAuthority === "human" ? "participant" : "agent";
  return owner === actor;
}
