import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MINIMUM_EXPOSURE_MS } from "../config/experiment";
import { validPracticeExposureMs, type PracticeExposureEvent } from "../lib/experiment/practiceExposure";

const base = Date.parse("2026-10-09T00:00:00.000Z");
const event = (event_type: string, offsetMs: number, active?: boolean, effectiveExposureMs: number | null = null): PracticeExposureEvent => ({
  event_type,
  created_at: new Date(base + offsetMs).toISOString(),
  effective_exposure_ms: effectiveExposureMs,
  payload_json: active === undefined ? null : { active },
});

describe("role-specific practice exposure", () => {
  it("uses 15 seconds in both practice roles while retaining 20 seconds in the experiment", () => {
    assert.deepEqual(MINIMUM_EXPOSURE_MS.practice, { giver: 15_000, recipient: 15_000 });
    assert.deepEqual(MINIMUM_EXPOSURE_MS.experiment, { giver: 20_000, recipient: 20_000 });
  });

  it("counts a continuous visible 15 seconds", () => {
    const events = [event("practice_phase_started", 0)];
    for (let second = 2; second <= 14; second += 2) events.push(event("practice_phase_heartbeat", second * 1000, true));
    assert.equal(validPracticeExposureMs(events, base + 15_000), 15_000);
  });

  it("stops counting while the page is hidden", () => {
    const events = [
      event("practice_phase_started", 0),
      event("practice_phase_heartbeat", 2_000, true),
      event("practice_phase_heartbeat", 4_000, false),
      event("practice_phase_heartbeat", 20_000, true),
      event("practice_phase_heartbeat", 22_000, true),
    ];
    assert.equal(validPracticeExposureMs(events, base + 23_000), 7_000);
  });

  it("drops a stale heartbeat gap and keeps the actual completed duration", () => {
    const events = [
      event("practice_phase_started", 0),
      event("practice_phase_heartbeat", 2_000, true),
      event("practice_phase_heartbeat", 10_000, true),
    ];
    assert.equal(validPracticeExposureMs(events, base + 12_000), 4_000);
    assert.equal(validPracticeExposureMs([...events, event("practice_phase_completed", 21_450, undefined, 21_450)], base + 30_000), 21_450);
  });
});
