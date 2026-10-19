"use client";
import { useEffect, useRef, type RefObject } from "react";

/** Records visible, focused intervals. An interval is an opportunity to read, not proof of reading. */
export function useStudyExposure<T extends HTMLElement>(
  element: RefObject<T | null>, paused: boolean,
  onInterval: (durationMs: number, exposureId: string, segment: number) => void,
) {
  const exposureId = useRef<string | null>(null);
  const callback = useRef(onInterval);
  callback.current = onInterval;
  if (typeof window !== "undefined" && !exposureId.current) exposureId.current = crypto.randomUUID();
  useEffect(() => {
    const node = element.current;
    if (!node || paused) return;
    let intersecting = false;
    let enteredAt = 0;
    let segment = 0;
    const stop = () => {
      if (!enteredAt) return;
      const duration = Math.max(0, performance.now() - enteredAt);
      enteredAt = 0;
      if (duration >= 250) callback.current(duration, exposureId.current!, ++segment);
    };
    const update = () => {
      const active = intersecting && document.visibilityState === "visible" &&
        document.hasFocus() && navigator.onLine;
      if (active && !enteredAt) enteredAt = performance.now();
      if (!active) stop();
    };
    const observer = new IntersectionObserver(entries => {
      intersecting = entries[0]?.intersectionRatio >= 0.25;
      update();
    }, { threshold: [0, 0.25, 0.5, 1] });
    observer.observe(node);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update); window.addEventListener("blur", update);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => {
      stop(); observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update); window.removeEventListener("blur", update);
      window.removeEventListener("online", update); window.removeEventListener("offline", update);
    };
  }, [element, paused]);
}
