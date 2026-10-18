import assert from "node:assert/strict";
import test from "node:test";
import { visibleRecipientMessages, visibleRecipientTrial } from "../lib/study/visibility";

const trial = { id: "trial-1", phase: "candidates", phase_effective_ms: 19_000,
  candidate_snapshots: ["p1", "p2", "p3"].map(source_product_id => ({ source_product_id })),
  final_product_id: "p1", final_reason: "future result" };
const messages = [
  { trial_id: "trial-1", phase: "candidates", kind: "candidate_proposal", payload: { offset_ms: 10_000, product: { source_product_id: "p1" } } },
  { trial_id: "trial-1", phase: "candidates", kind: "candidate_proposal", payload: { offset_ms: 26_000, product: { source_product_id: "p2" } } },
  { trial_id: "trial-1", phase: "decision", kind: "final_selection", payload: { offset_ms: 5_000 } },
];

test("recipient API hides unreached script messages and candidate snapshots", () => {
  const shown = visibleRecipientMessages(messages, trial);
  assert.equal(shown.length, 1);
  const safe = visibleRecipientTrial(trial, shown);
  assert.deepEqual(safe.candidate_snapshots.map(product => product.source_product_id), ["p1"]);
  assert.equal(safe.final_product_id, null);
});

test("recipient final scene waits for its decision offset", () => {
  const decision = { ...trial, phase: "decision", phase_effective_ms: 4_999 };
  assert.equal(visibleRecipientMessages(messages, decision).some(message => message.kind === "final_selection"), false);
  decision.phase_effective_ms = 5_000;
  assert.equal(visibleRecipientMessages(messages, decision).some(message => message.kind === "final_selection"), true);
});
