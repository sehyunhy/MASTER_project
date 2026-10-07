import type { ConditionId } from "@/lib/types";

export type ExperimentPhase = "criteria" | "candidates" | "comparison" | "decision" | "awaiting_survey" | "completed";
export type TaskActor = "participant" | "agent" | "simulated_giver";
export const MIN_PHASE_EXPOSURE_MS = 30_000;
export const PHASE_ORDER: readonly ExperimentPhase[] = ["criteria", "candidates", "comparison", "decision", "awaiting_survey", "completed"];

export function conditionRoles(condition: ConditionId) {
  return {
    taskActor: condition === "C1" || condition === "C2" ? "participant" as const : "agent" as const,
    decisionActor: condition === "C1" || condition === "C3" ? "participant" as const : "agent" as const,
  };
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
  return Math.max(0, MIN_PHASE_EXPOSURE_MS - accumulatedMs);
}

export function taskActorAllowed(condition: ConditionId, actor: TaskActor, observerRole: boolean): boolean {
  if (observerRole) return actor === "simulated_giver" || actor === "agent";
  return conditionRoles(condition).taskActor === actor;
}

export function decisionActorAllowed(condition: ConditionId, actor: TaskActor, observerRole: boolean): boolean {
  if (observerRole) return actor === "simulated_giver" || actor === "agent";
  return conditionRoles(condition).decisionActor === actor;
}
