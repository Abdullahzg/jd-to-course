"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { useScanJob } from "@/hooks/use-scan-job";

/**
 * The site-wide answer to "connect and read it in the background".
 *
 * Any page can start a scan; this component, mounted once in the layout,
 * notices a running job, polls it, and when it finishes drops a toast in
 * the corner saying what the inbox produced, wherever the person has
 * wandered to by then.
 */
export function ScanNotifier() {
  const { status } = useSession();
  const { job, steps, isRunning, isError } = useScanJob();
  const [dismissed, setDismissed] = useState(false);

  // Reset dismiss when scan finishes
  useEffect(() => { if (!isRunning) setDismissed(false); }, [isRunning]);

  if (status !== "authenticated") return null;

  // Finished toast (after scan completes)
  if (!isRunning && job && !dismissed && job.status !== "running") {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-white p-3 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">
            {job.status === "error" ? "The inbox scan hit a wall" : "Your inbox scan finished"}
          </p>
          <button onClick={() => setDismissed(true)} aria-label="Dismiss"
                  className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {job.status === "error" ? (
          <p className="mt-1 text-xs text-muted-foreground">{job.error}</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              {job.created} new application{job.created === 1 ? "" : "s"}, {job.updated} updated,
              every status carrying its proving sentence.
            </p>
            <Link href="/tracker" onClick={() => setDismissed(true)}
                  className="mt-2 inline-block rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background">
              Open the tracker
            </Link>
          </>
        )}
      </div>
    );
  }

  // Running: step-by-step verbose log
  if (isRunning && steps.length > 0) {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-white p-3 shadow-lg">
        <p className="text-xs font-medium text-muted-foreground">Reading your inbox</p>
        <ul className="mt-2 space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              {s.done ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : s.active ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-foreground/20" />
              )}
              <span className={s.done ? "text-muted-foreground" : s.active ? "" : "text-muted-foreground/50"}>
                {s.label}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          You can keep using Carpa; this corner will say when it is done.
        </p>
      </div>
    );
  }

  return null;
}
