"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { KeyRound, Play, RefreshCw } from "lucide-react";

/**
 * The inbox controls, portable. The dashboard grew a state-aware card
 * (connected, judging, fresh) and the tracker page had nothing at all,
 * which meant the page most about the inbox was the one page you could
 * not scan from. Same three states, compact form, usable anywhere.
 */
type Status = { savedImap: string | null; gmailConnected: boolean; lastMode: string | null };

export function InboxActions({ onDone }: { onDone?: () => void }) {
  const { data: session } = useSession();
  const [st, setSt] = useState<Status | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [imapOpen, setImapOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");

  useEffect(() => {
    void fetch("/api/inbox/status").then((r) => r.json()).then((j) => { if (j.ok) setSt(j); }).catch(() => {});
  }, []);

  const gmailConnected = Boolean((session as { gmailConnected?: boolean } | null)?.gmailConnected) || Boolean(st?.gmailConnected);

  const run = async (mode: "gmail" | "imap" | "judge") => {
    setBusy(true); setNote("Starting the scan");
    const body: Record<string, unknown> = { mode };
    if (mode === "imap" && email && pass) { body.email = email; body.appPassword = pass; }
    const r = await fetch("/api/inbox/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: "The connection dropped." }));
    if (!r.ok) { setBusy(false); setNote(r.error ?? "That did not work."); return; }
    if (r.done) {
      setBusy(false);
      if (window.location.pathname !== "/tracker") { window.dispatchEvent(new Event("carpa-nav")); window.location.href = "/tracker"; return; }
      setNote(`The owner's tracker is in your view: ${r.total} applications.`);
      onDone?.();
      return;
    }
    window.dispatchEvent(new Event("carpa-scan-started"));
    const tick = async () => {
      const j = (await fetch(`/api/inbox/scan?job=${r.jobId}`).then((x) => x.json()).catch(() => null))?.job;
      if (!j) { setTimeout(() => void tick(), 3000); return; }
      if (j.status === "running") {
        const n = (x: number) => Number(x).toLocaleString();
        setNote(j.phase === "triage" ? `Sorting ${n(j.total)} emails: ${n(j.done)} done`
          : j.phase === "reading" ? `Reading the ${n(j.total)} that matter: ${n(j.done)} done`
          : j.phase === "extracting" ? `Extracting statuses: ${n(j.done)} of ${n(j.total)}`
          : "Connecting to the mailbox");
        setTimeout(() => void tick(), 3000);
        return;
      }
      setBusy(false);
      setNote(j.status === "done"
        ? `Read ${Number(j.total).toLocaleString()} new emails, ${j.created} new applications, ${j.updated} updated.`
        : j.error ?? "The scan failed.");
      onDone?.();
    };
    void tick();
  };

  const pill = "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs disabled:opacity-40";
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {st?.savedImap || gmailConnected ? (
          <>
            <button onClick={() => void run(st?.savedImap ? "imap" : "gmail")} disabled={busy} data-track="tracker_scan_now"
                    className={`${pill} bg-foreground font-medium text-background`}>
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Scan my inbox now
            </button>
            <button onClick={() => setImapOpen((v) => !v)} disabled={busy} data-track="tracker_update_pass"
                    className={`${pill} border border-border`}>
              <KeyRound className="h-3.5 w-3.5" /> {st?.savedImap ? "Update app password" : "Use an app password"}
            </button>
            <button onClick={() => void run("judge")} disabled={busy} data-track="tracker_scan_judge"
                    className={`${pill} border border-border text-muted-foreground`}
                    title="Adds the owner's rows to your view, so you can judge Carpa on real mail">
              <Play className="h-3.5 w-3.5" /> See the owner&rsquo;s tracker
            </button>
          </>
        ) : st?.lastMode === "judge" ? (
          <>
            <button onClick={() => setImapOpen((v) => !v)} disabled={busy} data-track="tracker_connect_own"
                    className={`${pill} bg-foreground font-medium text-background`}>
              <KeyRound className="h-3.5 w-3.5" /> Connect my own inbox
            </button>
            <button onClick={() => void run("judge")} disabled={busy} data-track="tracker_scan_judge"
                    className={`${pill} border border-border text-muted-foreground`}>
              <Play className="h-3.5 w-3.5" /> Reload the owner&rsquo;s tracker
            </button>
          </>
        ) : st ? (
          <>
            <button onClick={() => setImapOpen((v) => !v)} disabled={busy} data-track="tracker_imap_open"
                    className={`${pill} bg-foreground font-medium text-background`}>
              <KeyRound className="h-3.5 w-3.5" /> Connect with an app password
            </button>
            <button onClick={() => void run("judge")} disabled={busy} data-track="tracker_scan_judge"
                    className={`${pill} border border-border text-muted-foreground`}>
              <Play className="h-3.5 w-3.5" /> Judges&rsquo; inbox
            </button>
          </>
        ) : null}
      </div>
      {imapOpen && (
        <div className="mt-2 flex max-w-xl flex-wrap gap-1.5 rounded-lg bg-foreground/[0.03] p-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com"
                 className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-xs" inputMode="email" />
          <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="16 character app password"
                 className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-xs" type="password" />
          <button onClick={() => void run("imap")} disabled={busy || !email.includes("@") || pass.replace(/\s/g, "").length < 16}
                  data-track="tracker_imap_run"
                  className="rounded bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-40">
            Scan
          </button>
        </div>
      )}
      {note && <p className="mt-1.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}
