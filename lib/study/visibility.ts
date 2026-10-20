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
  candidate_builder?: "human" | "agent";
  candidates_visible_at?: string | null;
  phase_started_at?: string | null;
  timeout_phase?: string | null;
  phase_effective_ms: number;
  candidate_snapshots: { source_product_id: string }[];
};

/** Reveal the batch after server preparation time; all later messages use effective exposure time. */
export function visibleRecipientMessages<T extends PlaybackMessage>(messages: T[], trial: PlaybackTrial,
  nowMs = Date.now()): T[] {
  return messages.filter(message => {
    if (message.trial_id !== trial.id) return true;
    if (trial.phase === "locked") return false;
    if (["survey", "complete"].includes(trial.phase)) return true;
    const phase = ["timeout", "skipped"].includes(trial.phase) ? trial.timeout_phase : trial.phase;
    if (phase === "candidates" && message.phase !== "candidates") return false;
    if (phase !== "decision" && phase !== "candidates") return false;
    if (message.phase !== "candidates" && message.phase !== "decision") return false;
    if (message.phase === "candidates" && phase === "decision") return true;
    if (trial.phase === "candidates" && trial.candidate_builder === "agent" &&
      message.phase === "candidates" && message.kind === "candidate_batch") {
      if (trial.candidates_visible_at) return true;
      const startedAt = trial.phase_started_at ? Date.parse(trial.phase_started_at) : NaN;
      return Number.isFinite(startedAt) && nowMs - startedAt >= Number(message.payload?.offset_ms ?? 0);
    }
    return Number(message.payload?.offset_ms ?? 0) <= trial.phase_effective_ms;
  });
}

/** Candidate snapshots for sequential scripts become available as cards appear. */
export function visibleRecipientTrial<T extends PlaybackTrial>(trial: T, messages: PlaybackMessage[]): T {
  if (trial.phase !== "candidates" && !(["timeout", "skipped"].includes(trial.phase) && trial.timeout_phase === "candidates")) return trial;
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
