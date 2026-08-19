"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { X } from "lucide-react";

type Job = {
  id: string; status: "running" | "done" | "error"; phase: string;
  done: number; total: number; created: number; updated: number; error: string | null;
};

/**
 * The site-wide answer to "connect and read it in the background".
 *
 * Any page can start a scan; this component, mounted once in the layout,
 * notices a running job (by event when this tab started it, by the newest-job
 * endpoint when another tab did), polls it, and when it finishes drops a
 * toast in the corner saying what the inbox produced, wherever the person
 * has wandered to by then.
 */
export function ScanNotifier() {
  const { status } = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [toast, setToast] = useState<Job | null>(null);
  const watching = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async (id?: string) => {
    try {
      const r = await fetch(`/api/inbox/scan${id ? `?job=${id}` : ""}`).then((x) => x.json());
      const j: Job | null = r?.job ?? null;
      if (!j) return;
      if (j.status === "running") {
        watching.current = j.id;
        setJob(j);
        timer.current = setTimeout(() => void poll(j.id), 4000);
      } else {
        // Only announce a finish this tab actually watched start-to-end;
        // surfacing last week's job as breaking news would be noise.
        if (watching.current === j.id) {
          setToast(j);
          watching.current = null;
        }
        setJob(null);
      }
    } catch { /* a lost poll is retried by the next event */ }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    void poll();
    const onStart = () => { if (timer.current) clearTimeout(timer.current); void poll(); };
    window.addEventListener("carpa-scan-started", onStart);
    return () => {
      window.removeEventListener("carpa-scan-started", onStart);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [status, poll]);

  if (toast) {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-white p-3 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">
            {toast.status === "error" ? "The inbox scan hit a wall" : "Your inbox scan finished"}
          </p>
          <button onClick={() => setToast(null)} aria-label="Dismiss"
                  className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {toast.status === "error" ? (
          <p className="mt-1 text-xs text-muted-foreground">{toast.error}</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              {toast.created} new application{toast.created === 1 ? "" : "s"}, {toast.updated} updated,
              every status carrying its proving sentence.
            </p>
            <Link href="/tracker" onClick={() => setToast(null)}
                  className="mt-2 inline-block rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background">
              Open the tracker
            </Link>
          </>
        )}
      </div>
    );
  }

  if (job) {
    const pct = job.total > 0 ? Math.min(100, Math.round((100 * job.done) / job.total)) : 0;
    const phase =
      job.phase === "connecting" ? "connecting to the mailbox" :
      job.phase === "triage" ? `sorting ${job.total.toLocaleString()} emails` :
      job.phase === "reading" ? `reading the ${job.total.toLocaleString()} that matter` :
      job.phase === "extracting" ? "extracting statuses with proof" : "working";
    return (
      <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-white p-3 shadow-lg">
        <p className="flex items-baseline justify-between gap-2 text-xs font-medium">
          <span>Reading your inbox: {phase}</span>
          <span className="tabular shrink-0 text-muted-foreground">{job.done.toLocaleString()}/{job.total.toLocaleString()} · {pct}%</span>
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
          <div className="h-full rounded-full bg-foreground transition-all duration-700" style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          You can keep using Carpa; this corner will say when it is done.
        </p>
      </div>
    );
  }

  return null;
}
