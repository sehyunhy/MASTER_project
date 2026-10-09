export type PracticeExposureEvent = {
  event_type: string;
  created_at: string;
  effective_exposure_ms: number | null;
  payload_json: { active?: boolean } | null;
};

/** Count only short, continuous visible intervals between server timestamps. */
export function validPracticeExposureMs(events: PracticeExposureEvent[], now: number): number {
  const completed = events.find(event => event.event_type === "practice_phase_completed");
  if (completed) return Number(completed.effective_exposure_ms ?? 0);
  const start = events.find(event => event.event_type === "practice_phase_started");
  if (!start) return 0;
  let lastTime = Date.parse(start.created_at);
  let lastActive = true;
  let elapsed = 0;
  for (const event of events) {
    if (event.event_type !== "practice_phase_heartbeat") continue;
    const time = Date.parse(event.created_at);
    const active = event.payload_json?.active === true;
    const gap = time - lastTime;
    if (lastActive && gap >= 0 && gap <= 3_000) elapsed += gap;
    lastTime = time;
    lastActive = active;
  }
  const finalGap = now - lastTime;
  if (lastActive && finalGap >= 0 && finalGap <= 3_000) elapsed += finalGap;
  return Math.floor(elapsed);
}
