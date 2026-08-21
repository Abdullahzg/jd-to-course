"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ScanJob = {
  id: string; status: "running" | "done" | "error"; phase: string;
  done: number; total: number; created: number; updated: number; error: string | null;
};

export type ScanStep = { label: string; done: boolean; active: boolean };

const PHASE_ORDER = ["connecting", "triage", "reading", "extracting"];

const phaseLabel = (phase: string, total: number, done: number) => {
  const n = (x: number) => x.toLocaleString();
  if (phase === "connecting") return "Connected. Listing every email in the window";
  if (phase === "triage") return `Sorting ${n(total)} emails by their headers: ${n(done)} of ${n(total)}`;
  if (phase === "reading") return `Downloading the ${n(total)} emails that matter: ${n(done)} done`;
  if (phase === "extracting") return `Extracting statuses with their proving sentences: ${n(done)} of ${n(total)}`;
  return "Working";
};

/**
 * Shared hook: polls the latest scan job and builds a step-by-step log
 * based on phase transitions (not email count).
 */
export function useScanJob() {
  const [job, setJob] = useState<ScanJob | null>(null);
  const [steps, setSteps] = useState<ScanStep[]>([]);
  const lastPhase = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watching = useRef<string | null>(null);

  const poll = useCallback(async (id?: string) => {
    try {
      const r = await fetch(`/api/inbox/scan${id ? `?job=${id}` : ""}`).then((x) => x.json());
      const j: ScanJob | null = r?.job ?? null;
      if (!j) return;
      if (j.status === "running") {
        watching.current = j.id;
        setJob(j);
        // Build step log from phase transitions
        setSteps((prev) => {
          const phaseIdx = PHASE_ORDER.indexOf(j.phase);
          if (phaseIdx < 0) return prev;
          const next: ScanStep[] = PHASE_ORDER.slice(0, phaseIdx + 1).map((p, i) => ({
            label: phaseLabel(p, j.total, j.done),
            done: i < phaseIdx,
            active: i === phaseIdx,
          }));
          return next;
        });
        lastPhase.current = j.phase;
        timer.current = setTimeout(() => void poll(j.id), 3000);
      } else {
        // Mark all steps done
        setSteps((prev) => prev.map((s) => ({ ...s, done: true, active: false })));
        setJob(j);
        timer.current = setTimeout(() => {
          setJob(null);
          setSteps([]);
          watching.current = null;
        }, 4000);
      }
    } catch { /* retry on next event */ }
  }, []);

  useEffect(() => {
    const onStart = () => { if (timer.current) clearTimeout(timer.current); void poll(); };
    window.addEventListener("carpa-scan-started", onStart);
    // Also check on mount
    void poll();
    return () => {
      window.removeEventListener("carpa-scan-started", onStart);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  const isRunning = job?.status === "running";
  const isError = job?.status === "error";

  return { job, steps, isRunning, isError };
}
