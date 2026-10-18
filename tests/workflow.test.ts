import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { conditionRoles, exposureDeltaMs, MIN_PHASE_EXPOSURE_MS, nextPhase, phaseRemainingMs, taskActorAllowed, decisionActorAllowed } from "../lib/experiment/workflow";

describe("factorial workflow mapping", () => {
  it("maps the four builder-by-decision conditions", () => {
    assert.deepEqual(conditionRoles("C1"), { candidateBuilder: "human", candidateMode:"human_sequential", decisionAuthority: "human", label:"A · 순차 협업 후 사람 확정" });
    assert.deepEqual(conditionRoles("C2"), { candidateBuilder: "human", candidateMode:"human_sequential", decisionAuthority: "agent", label:"C · 순차 협업 후 Agent 확정" });
    assert.deepEqual(conditionRoles("C3"), { candidateBuilder: "agent", candidateMode:"agent_batch", decisionAuthority: "human", label:"B · Agent 일괄 구성 후 사람 확정" });
    assert.deepEqual(conditionRoles("C4"), { candidateBuilder: "agent", candidateMode:"agent_batch", decisionAuthority: "agent", label:"D · Agent 일괄 구성·확정" });
  });

  it("rejects under-exposure and never credits hidden or stale intervals", () => {
    assert.equal(phaseRemainingMs(0), MIN_PHASE_EXPOSURE_MS);
    assert.equal(phaseRemainingMs(59_999), 1);
    assert.equal(phaseRemainingMs(60_000), 0);
    assert.equal(exposureDeltaMs(1_000, 4_000, true), 3_000);
    assert.equal(exposureDeltaMs(1_000, 9_000, true), 0);
    assert.equal(exposureDeltaMs(1_000, 4_000, false), 0);
    assert.equal(exposureDeltaMs(4_000, 1_000, true), 0);
  });

  it("does not expose condition authority to the wrong actor", () => {
    assert.equal(taskActorAllowed("C1", "participant", false), true);
    assert.equal(taskActorAllowed("C3", "participant", false), false);
    assert.equal(decisionActorAllowed("C2", "participant", false), false);
    assert.equal(decisionActorAllowed("C3", "participant", false), true);
    assert.equal(taskActorAllowed("C1", "simulated_giver", true), true);
  });

  it("keeps the server phase sequence explicit", () => {
    assert.equal(nextPhase("criteria"), "candidates");
    assert.equal(nextPhase("candidates"), "comparison");
    assert.equal(nextPhase("comparison"), "decision");
    assert.equal(nextPhase("completed"), null);
  });
});
