"use client";
import type { ClientStudyEvent } from "./telemetry-types";

const STORAGE_KEY = "study-telemetry-outbox-v2";
const TAB_KEY = "study-tab-id";
const SEQUENCE_KEY = "study-telemetry-sequence-v2";
let visitId: string | null = null;
let queue: ClientStudyEvent[] | null = null;
let sending = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function readQueue(): ClientStudyEvent[] {
  if (queue) return queue;
  try { queue = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { queue = []; }
  if (!Array.isArray(queue)) queue = [];
  return queue;
}
function saveQueue() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(readQueue())); }
  catch { /* network delivery still works when session storage is unavailable */ }
}
function schedule(delay = 0) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void flushStudyTelemetry(); }, delay);
}
export function studyTabId() {
  let value: string | null = null;
  try { value = sessionStorage.getItem(TAB_KEY); } catch {}
  if (!value) {
    value = crypto.randomUUID();
    try { sessionStorage.setItem(TAB_KEY, value); } catch {}
  }
  return value;
}
export function captureStudyEvent(input: Pick<ClientStudyEvent,"role"|"trialId"|"phaseAtCapture"|"eventType"|"payload"> &
  Partial<Pick<ClientStudyEvent,"target"|"uiSurface"|"operationId">>) {
  if (!visitId) visitId = crypto.randomUUID();
  let sequence = 0;
  try { sequence = Number(sessionStorage.getItem(SEQUENCE_KEY) || "0"); } catch {}
  sequence += 1;
  try { sessionStorage.setItem(SEQUENCE_KEY, String(sequence)); } catch {}
  const item: ClientStudyEvent = {
    ...input, key: crypto.randomUUID(), clientAt: new Date().toISOString(),
    visitId, tabId: studyTabId(), clientSequence: sequence,
    clientElapsedMs: Math.round(performance.now()),
  };
  readQueue().push(item);
  saveQueue();
  // Batch rapid typing without discarding individual input operations.
  schedule(750);
  return item.key;
}
export async function flushStudyTelemetry() {
  if (sending || !readQueue().length) return;
  sending = true;
  try {
    while (readQueue().length) {
      const first = readQueue()[0];
      const batch = readQueue().filter(item => item.trialId === first.trialId).slice(0, 20);
      const response = await fetch("/api/experiment/telemetry", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }), credentials: "same-origin", keepalive: true,
      });
      if (!response.ok) {
        // A stale tab may retain events belonging to a different participant.
        if (response.status === 403 || response.status === 400) {
          queue = readQueue().filter(item => !batch.some(sent => sent.key === item.key));
          saveQueue();
          continue;
        }
        break;
      }
      queue = readQueue().filter(item => !batch.some(sent => sent.key === item.key));
      saveQueue();
    }
  } catch { /* keep the same event keys for a later retry */ }
  finally { sending = false; if (readQueue().length) schedule(5000); }
}
export function beaconStudyTelemetry() {
  const pending = readQueue();
  const trials = [...new Set(pending.map(item => item.trialId))];
  let sent = 0;
  for (const trialId of trials) {
    const items = pending.filter(item => item.trialId === trialId);
    for (let offset = 0; offset < items.length && sent < 5; offset += 20) {
      const batch = items.slice(offset, offset + 20);
      try {
        navigator.sendBeacon("/api/experiment/telemetry",
          new Blob([JSON.stringify({ events: batch })], { type: "application/json" }));
      } catch {}
      sent++;
    }
  }
  // Beacon has no acknowledgement. Keep events in the outbox for a later retry.
}
