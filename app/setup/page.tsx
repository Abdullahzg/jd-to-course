"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, KeyRound, Loader2, Mail, Play, X } from "lucide-react";

/**
 * The first three minutes, walked rather than explained.
 *
 * A new account lands here once: what Carpa is, then the inbox, connected the
 * way that suits them, with the judges' shared inbox offered openly as one of
 * the ways. The connection step narrates what it is doing while it does it,
 * because sixty silent seconds against someone's private mail reads as broken
 * or worse.
 */

type Verbose = { line: string; done: boolean };

export default function Setup() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [log, setLog] = useState<Verbose[]>([]);
  const [result, setResult] = useState<{ created: number; updated: number; emailsRead: number; alreadyKnown?: number; mode?: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imapEmail, setImapEmail] = useState("");
  const [imapPass, setImapPass] = useState("");
  const [judgePopup, setJudgePopup] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/home");
  }, [status, router]);

  const gmailConnected = Boolean((session as { gmailConnected?: boolean } | null)?.gmailConnected);

  const narrate = (lines: string[]) => {
    setLog([{ line: lines[0], done: false }]);
    lines.slice(1).forEach((l, i) => {
      timers.current.push(window.setTimeout(() => {
        setLog((xs) => [...xs.map((x) => ({ ...x, done: true })), { line: l, done: false }]);
      }, 1400 * (i + 1)));
    });
  };

  const scan = async (mode: "imap" | "gmail" | "demo" | "judge") => {
    setBusy(true); setError(""); setResult(null);
    setLog([{ line: mode === "imap" || mode === "judge"
      ? `Connecting to imap.gmail.com as ${mode === "judge" ? "the judges' inbox" : imapEmail.trim() || "you"}, read only`
      : mode === "gmail" ? "Asking Google for the mailbox, read only"
      : "Opening the demo inbox: twenty two realistic emails", done: false }]);

    const body: Record<string, unknown> = { mode };
    if (mode === "imap") { body.email = imapEmail; body.appPassword = imapPass; }
    const r = await fetch("/api/inbox/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "The connection dropped before the scan could start. Run it again." }));
    if (!r.ok) { setBusy(false); setError(r.error ?? "That did not work, and it is not your fault. Try another route below."); return; }
    if (r.done) {
      // The owner's tracker arrives with the response itself.
      setLog((xs) => xs.map((x) => ({ ...x, done: true })));
      setBusy(false);
      setResult({ created: r.created, updated: 0, emailsRead: 0, mode });
      setStep(2);
      return;
    }
    window.dispatchEvent(new Event("carpa-scan-started"));

    // The log below is the job's real progress, not a scripted animation:
    // the numbers are what the runner has actually done, polled live.
    let lastPhase = "";
    const phaseLine = (j: { phase: string; done: number; total: number; alreadyKnown?: number }) => {
      const n = (x: number) => x.toLocaleString();
      if (j.phase === "connecting") return "Connected. Listing every email in the window";
      if (j.phase === "triage") return `Sorting ${n(j.total)} emails by their headers${j.alreadyKnown ? ` (${n(j.alreadyKnown)} remembered from earlier scans and skipped)` : ""}: ${n(j.done)} of ${n(j.total)}`;
      if (j.phase === "reading") return `Downloading the ${n(j.total)} emails that matter: ${n(j.done)} done`;
      if (j.phase === "extracting") return `Extracting statuses with their proving sentences: ${n(j.done)} of ${n(j.total)}`;
      return "Working";
    };
    const tick = async () => {
      const jr = await fetch(`/api/inbox/scan?job=${r.jobId}`).then((x) => x.json()).catch(() => null);
      const j = jr?.job as { status: string; phase: string; done: number; total: number; created: number; updated: number; alreadyKnown: number; error: string | null } | null;
      if (!j) { timers.current.push(window.setTimeout(() => void tick(), 3000)); return; }
      const line = phaseLine(j);
      setLog((xs) => {
        if (j.phase !== lastPhase) {
          lastPhase = j.phase;
          return [...xs.map((x) => ({ ...x, done: true })), { line, done: false }];
        }
        return [...xs.slice(0, -1), { line, done: false }];
      });
      if (j.status === "running") { timers.current.push(window.setTimeout(() => void tick(), 2500)); return; }
      setLog((xs) => xs.map((x) => ({ ...x, done: true })));
      setBusy(false);
      if (j.status === "done") {
        setResult({ created: j.created, updated: j.updated, emailsRead: j.total, alreadyKnown: j.alreadyKnown, mode });
        setStep(2);
      } else {
        setError(j.error ?? "That did not work, and it is not your fault. Try another route below.");
      }
    };
    void tick();
  };

  if (status !== "authenticated") {
    return <main className="flex min-h-[70vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></main>;
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* progress dots */}
      <div className="flex items-center gap-2">
        {["What Carpa is", "Connect an inbox", "Done"].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${i <= step ? "bg-foreground text-background" : "bg-foreground/10 text-muted-foreground"}`}>
              {i < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={`text-xs ${i === step ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
            {i < 2 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <>
        <section className="mt-6 rounded-2xl bg-foreground p-5 text-background">
          <p className="text-[11px] uppercase tracking-[0.2em] opacity-70">Judging Carpa?</p>
          <h1 className="mt-1 font-display text-2xl font-semibold leading-tight">
            One click and the tracker is full: use the owner&rsquo;s inbox.
          </h1>
          <p className="mt-2 text-sm leading-relaxed opacity-80">
            So judges can see Carpa working on real mail: load the tracker of
            <strong> Abdullah Zubair Ghouri</strong>, who built it, without connecting anything of
            yours.
          </p>
          <button onClick={() => { setStep(1); setJudgePopup(true); }} data-track="setup_judge_banner"
                  className="mt-3 rounded-full bg-background px-6 py-2.5 text-sm font-semibold text-foreground transition-transform hover:scale-[1.02]">
            Use the owner&rsquo;s inbox
          </button>
        </section>
        <section className="mt-3 rounded-2xl border border-border bg-white p-5">
          <h1 className="font-display text-lg font-semibold">Welcome to Carpa, {session.user?.name?.split(" ")[0]}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Carpa does two jobs, and both run on receipts.
          </p>
          <ol className="mt-3 space-y-2.5 text-sm">
            <li className="rounded-lg bg-foreground/[0.03] p-3">
              <strong>Plan a degree from a job posting.</strong>{" "}
              <span className="text-muted-foreground">Paste any posting and every course in the catalog is read
              against it. What comes back is a semester by semester plan where each pick quotes the catalog
              line that earned it.</span>
            </li>
            <li className="rounded-lg bg-foreground/[0.03] p-3">
              <strong>Track every application from your inbox.</strong>{" "}
              <span className="text-muted-foreground">Connect email once and the tracker builds and maintains
              itself: confirmations, assessments, interviews, offers and rejections, grouped, each carrying
              the sentence from the email that proved it. Nothing is ever written to your mailbox.</span>
            </li>
          </ol>
          <button onClick={() => setStep(1)} data-track="setup_next"
                  className="mt-4 w-full rounded-full bg-foreground py-2.5 text-sm font-medium text-background shadow-lg shadow-foreground/20 transition-transform hover:scale-[1.01]">
            Set up my inbox
          </button>
          <Link href="/home" className="mt-2 block text-center text-xs text-muted-foreground underline underline-offset-2">
            skip for now
          </Link>
        </section>
        </>
      )}

      {step === 1 && (
        <section className="mt-6 space-y-3">
          <div>
            <h1 className="font-display text-lg font-semibold">Whose inbox should the tracker read?</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              The owner&rsquo;s is already read and takes one click. Your own takes a minute to connect
              and then maintains itself.
            </p>
          </div>

          {/* the owner's inbox: prebuilt, instant, first on purpose */}
          <div className="card-lift rounded-2xl border-2 border-foreground/20 bg-white p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600/10"><Play className="h-3.5 w-3.5 text-violet-700" /></span> Use the owner&rsquo;s inbox
              <span className="ml-1 rounded-full bg-violet-600/10 px-2 py-0.5 text-[10px] font-medium text-violet-700">instant, for judges</span>
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              See how Carpa works on real mail: the tracker of <strong>Abdullah Zubair Ghouri</strong>,
              who built it, opens in your view. Nothing of yours is touched.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button onClick={() => setJudgePopup(true)} disabled={busy} data-track="setup_judge"
                      className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-40">
                Use the owner&rsquo;s inbox
              </button>
            </div>
          </div>

          <p className="pt-1 text-center text-[11px] uppercase tracking-widest text-muted-foreground">or set up your own</p>

          {/* app password: the route that works for everyone, tutorial included */}
          <div className="card-lift rounded-2xl border border-border bg-white p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600/10"><KeyRound className="h-3.5 w-3.5 text-emerald-700" /></span> App password
              <span className="ml-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700">works for any Google account</span>
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
              <li>Open <a className="underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a> (needs 2 Step Verification on).</li>
              <li>Name it anything, press Create, and copy the 16 characters it shows.</li>
              <li>Paste them here. Carpa gets read only mail access you can revoke on that same page any time.</li>
            </ol>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <input value={imapEmail} onChange={(e) => setImapEmail(e.target.value)} placeholder="you@gmail.com"
                     className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-1.5 text-sm" inputMode="email" />
              <input value={imapPass} onChange={(e) => setImapPass(e.target.value)} placeholder="16 character app password"
                     className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-1.5 text-sm" type="password" />
              <button onClick={() => void scan("imap")} disabled={busy || !imapEmail.includes("@") || imapPass.replace(/\s/g, "").length < 16}
                      data-track="setup_scan_imap"
                      className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-40">
                Connect and scan
              </button>
            </div>
          </div>

          {/* google oauth */}
          <div className="card-lift rounded-2xl border border-border bg-white p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-600/10"><Mail className="h-3.5 w-3.5 text-sky-700" /></span> Google sign in</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              One authorize tab, read only scope, no password handling at all.
            </p>
            <button
              onClick={() => (gmailConnected ? void scan("gmail") : void signIn("google", { callbackUrl: "/setup" }, { scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly", access_type: "offline", prompt: "consent" }))}
              disabled={busy} data-track="setup_scan_gmail"
              className="mt-2 rounded-full border border-border px-4 py-1.5 text-sm disabled:opacity-40">
              {gmailConnected ? "Scan my Gmail" : "Authorize Gmail access"}
            </button>
          </div>

          

          {(busy || log.length > 0) && (
            <div className="rounded-2xl border border-border bg-white p-4">
              <ul className="space-y-1.5">
                {log.map((l, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    {l.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    <span className={l.done ? "text-muted-foreground" : ""}>{l.line}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && (
            <div className="rounded-2xl border p-3 text-xs leading-relaxed" style={{ borderColor: "color-mix(in oklab, var(--amber) 45%, transparent)" }}>
              <p className="font-medium" style={{ color: "var(--amber)" }}>That did not go through</p>
              <p className="mt-0.5 text-muted-foreground">{error}</p>
            </div>
          )}
        </section>
      )}

      {step === 2 && result && (
        <section className="mt-6 rounded-2xl border border-border bg-white p-5 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
          <h2 className="mt-2 font-display text-lg font-semibold">Your tracker is alive</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.mode === "judge"
              ? `The owner's tracker is in your view: ${result.created} real applications, every status carrying the sentence that proved it.`
              : `Read ${result.emailsRead} new emails${result.alreadyKnown ? ` (${result.alreadyKnown} already remembered from earlier scans)` : ""}, found ${result.created} applications and updated ${result.updated}. Every status carries the sentence that proved it.`}
          </p>
          <div className="mt-4 grid gap-2 text-left sm:grid-cols-2">
            <Link href="/start" data-track="setup_done_planner"
                  className="card-lift rounded-xl border-2 border-foreground/20 bg-white p-3">
              <p className="text-sm font-semibold">Plan a degree from a posting</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The other half of Carpa: paste any job posting and get the exact courses that answer
                it, inside your degree&rsquo;s real rules, every pick quoting the catalog.
              </p>
            </Link>
            <Link href="/tracker" data-track="setup_done_tracker2"
                  className="card-lift rounded-xl border border-border bg-white p-3">
              <p className="text-sm font-semibold">Your application tracker</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The spreadsheet that maintains itself: edit any cell, expand any row for receipts,
                export to Excel whenever.
              </p>
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/tracker" data-track="setup_done_tracker"
                  className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background">
              Open the tracker
            </Link>
            <Link href="/home" data-track="setup_done_home"
                  className="rounded-full border border-border px-5 py-2 text-sm">
              Go to my dashboard
            </Link>
          </div>
        </section>
      )}

      {/* the judges' popup, exactly as asked: what this is, whose mail it reads */}
      {judgePopup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setJudgePopup(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-border bg-white p-5" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="flex items-start justify-between">
              <h3 className="font-display text-base font-semibold">For judges</h3>
              <button onClick={() => setJudgePopup(false)} aria-label="Close"><X className="h-4 w-4 text-muted-foreground" /></button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              So judges can see Carpa working on real mail: this opens the tracker of
              <strong className="text-foreground"> Abdullah Zubair Ghouri</strong>, who built it, in
              your own view. Nothing of yours is touched or granted.
            </p>
            <button
              onClick={() => { setJudgePopup(false); void scan("judge"); }}
              data-track="setup_judge_confirm"
              className="mt-3 w-full rounded-full bg-foreground py-2 text-sm font-medium text-background">
              Understood, scan it
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
