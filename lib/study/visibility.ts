export type PlaybackMessage = {
  trial_id: string;
  phase: string;
  kind: string;
  payload?: { offset_ms?: number; product?: { source_product_id?: string };
    candidates?: { source_product_id?: string }[] };
};

export type PlaybackTrial = {
  id: string;
  phase: string;
  timeout_phase?: string | null;
  phase_effective_ms: number;
  candidate_snapshots: { source_product_id: string }[];
};

/** Only return observations already reached by the server exposure clock. */
export function visibleRecipientMessages<T extends PlaybackMessage>(messages: T[], trial: PlaybackTrial): T[] {
  return messages.filter(message => {
    if (message.trial_id !== trial.id) return true;
    if (trial.phase === "locked") return false;
    if (["survey", "complete"].includes(trial.phase)) return true;
    const phase = trial.phase === "timeout" ? trial.timeout_phase : trial.phase;
    if (phase === "candidates" && message.phase !== "candidates") return false;
    if (phase !== "decision" && phase !== "candidates") return false;
    if (message.phase !== "candidates" && message.phase !== "decision") return false;
    if (message.phase === "candidates" && phase === "decision") return true;
    return Number(message.payload?.offset_ms ?? 0) <= trial.phase_effective_ms;
  });
}

/** Candidate snapshots for sequential scripts become available as cards appear. */
export function visibleRecipientTrial<T extends PlaybackTrial>(trial: T, messages: PlaybackMessage[]): T {
  if (trial.phase !== "candidates" && !(trial.phase === "timeout" && trial.timeout_phase === "candidates")) return trial;
  const visibleIds = new Set<string>();
  for (const message of messages) {
    if (message.trial_id !== trial.id) continue;
    if (message.kind === "candidate_proposal" && message.payload?.product?.source_product_id)
      visibleIds.add(message.payload.product.source_product_id);
    if (message.kind === "candidate_batch")
      for (const product of message.payload?.candidates ?? []) {
        if (product.source_product_id) visibleIds.add(product.source_product_id);
      }
  }
  return { ...trial, candidate_snapshots: trial.candidate_snapshots.filter(product =>
    visibleIds.has(product.source_product_id)), final_product_id: null, final_reason: null } as T;
}
