export type StudyCondition = "A" | "B" | "C" | "D";

// Four balanced Williams orders. Every five enrollments contain all four
// orders; the extra position rotates across consecutive five-person blocks.
export const STUDY_ORDERS: readonly (readonly StudyCondition[])[] = [
  ["A", "C", "D", "B"],
  ["C", "B", "A", "D"],
  ["B", "D", "C", "A"],
  ["D", "A", "B", "C"],
];

export function orderForEnrollment(enrollmentNumber: number) {
  if (!Number.isSafeInteger(enrollmentNumber) || enrollmentNumber < 1)
    throw new Error("Enrollment number must be positive.");
  const blockIndex = Math.floor((enrollmentNumber - 1) / 5);
  const withinBlock = (enrollmentNumber - 1) % 5;
  const orderIndex = (blockIndex + (withinBlock === 4 ? 0 : withinBlock)) % 4;
  return { block: blockIndex + 1, orderIndex, conditions: STUDY_ORDERS[orderIndex] };
}

export const STUDY_RIGHTS = {
  A: { builder: "human", decider: "human", candidateMode: "sequential" },
  B: { builder: "agent", decider: "human", candidateMode: "batch" },
  C: { builder: "human", decider: "agent", candidateMode: "sequential" },
  D: { builder: "agent", decider: "agent", candidateMode: "batch" },
} as const;
