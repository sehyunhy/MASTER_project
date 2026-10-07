export type Role = "giver" | "recipient";
export type Intimacy = "high" | "low";
export type ConditionId = "C1" | "C2" | "C3" | "C4";
export type EventInput = { event_type: string; payload?: Record<string, unknown>; elapsed_ms?: number };
