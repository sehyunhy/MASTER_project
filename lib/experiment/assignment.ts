import { EXPERIMENT } from "@/config/experiment";
import type { ConditionId } from "@/lib/types";

export function sequenceForIndex(index: number) {
  return (["S1", "S2", "S3", "S4"] as const)[index % 4];
}

export function conditionAt(sequenceId: keyof typeof EXPERIMENT.sequences, trialNumber: number): ConditionId {
  return EXPERIMENT.sequences[sequenceId][trialNumber - 1] as ConditionId;
}

export function profileAt(trialNumber: number, sequenceIndex: number): string {
  return `R${((trialNumber - 1 + sequenceIndex) % 4) + 1}`;
}

export function validateWilliamsSequences() {
  const sequences = Object.values(EXPERIMENT.sequences) as readonly string[][];
  const positions = new Map<string, number>();
  const pairs = new Map<string, number>();
  for (const seq of sequences) {
    if (new Set(seq).size !== 4) throw new Error("A sequence repeats a condition.");
    seq.forEach((condition, i) => positions.set(`${i}:${condition}`, (positions.get(`${i}:${condition}`) ?? 0) + 1));
    for (let i = 0; i < 3; i++) {
      const pair = `${seq[i]}>${seq[i + 1]}`;
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    }
  }
  if ([...positions.values()].some((n) => n !== 1)) throw new Error("Condition positions are not balanced.");
  if ([...pairs.values()].some((n) => n !== 1) || pairs.size !== 12) throw new Error("Williams carryover pairs are not balanced.");
  return { sequences, positionCounts: Object.fromEntries(positions), adjacentPairCounts: Object.fromEntries(pairs) };
}
