"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2, CalendarRange, Inbox, LayoutGrid, ArrowRight } from "lucide-react";

/**
 * The new account door, reduced to four beats:
 *
 *   sign in → "use the owner's inbox?" → a loader → a three-door dashboard.
 *
 * The ask is one screen and one question. "Use my own" is a small, quiet
 * button — the options it opens are for the few who want them, and the
 * owner-inbox path never reads them. A loader sits between every choice and
 * the dashboard, so a fast clone does not look like the page skipped a
 * step. The dashboard is three doors with what each of them is, nothing else.
 */

type Verbose = { line: string; done: boolean };
type ScanResult = { created: number; updated: number; emailsRead: number; alreadyKnown?: number; mode?: string } | null;

function hold(ms: number) {
  return new Promise((r) => window.setTimeout(r, ms));
}

export default function Setup() {
  const { data: session, status } = useSession();
  const router = useRouter();
  // 0 ask · 1 own inbox · 2 loading · 3 dashboard
  const [step, setStep] = useState(0);
  const [log, setLog] = useState<Verbose[]>([]);
  const [result, setResult] = useState<ScanResult>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [validated, setValidated] = useState(false);
  const [imapEmail, setImapEmail] = useState("");
  const [imapPass, setImapPass] = useState("");
  const [loaderNote, setLoaderNote] = useState("Loading");
  const [loaderSub, setLoaderSub] = useState("");
  const [trackerCount, setTrackerCount] = useState<number | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/home");
  }, [status, router]);
  useEffect(() => {
    if (step !== 3) return;
    void fetch("/api/tracker").then((r) => r.json()).then((j) => { if (j.ok) setTrackerCount((j.items as unknown[]).length); }).catch(() => {});
  }, [step]);

  const showLoader = (note: string, sub: string) => {
    setLoaderNote(note);
    setLoaderSub(sub);
    setStep(2);
  };

  const narrate = (lines: string[]) => {
    setLog([{ line: lines[0], done: false }]);
    lines.slice(1).forEach((l, i) => {
      timers.current.push(window.setTimeout(() => {
        setLog((xs) => [...xs.map((x) => ({ ...x, done: true })), { line: l, done: false }]);
      }, 1400 * (i + 1)));
    });
  };

  /** Lightweight check: is the app password accepted by Gmail? */
  const validate = async () => {
    setBusy(true); setError(""); setValidated(false);
    setLog([{ line: `Checking the password for ${imapEmail.trim()}`, done: false }]);
    const r = await fetch("/api/inbox/scan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "imap", email: imapEmail, appPassword: imapPass, validate: true }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: "The connection dropped." }));
    setLog((xs) => xs.map((x) => ({ ...x, done: true })));
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "That password was rejected."); return; }
    setValidated(true);
  };

  /** Start the real scan in the background and route to the dashboard. */
  const continueAfterValidation = async () => {
    setBusy(true); setError("");
    setLog([{ line: `Connecting to imap.gmail.com as ${imapEmail.trim()}, read only`, done: false }]);
    const body: Record<string, unknown> = { mode: "imap", email: imapEmail, appPassword: imapPass };
    const r = await fetch("/api/inbox/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: "The connection dropped." }));
    if (!r.ok) { setBusy(false); setError(r.error ?? "That did not work."); return; }
    if (r.done) {
      setLog((xs) => xs.map((x) => ({ ...x, done: true })));
      setResult({ created: r.created, updated: 0, emailsRead: 0, mode: "imap" });
      setBusy(false);
      await hold(800);
      setStep(3);
      return;
    }
    window.dispatchEvent(new Event("carpa-scan-started"));
    setBusy(false);
    setStep(3);
  };

  const scan = async (mode: "imap" | "gmail" | "demo" | "judge") => {
    setBusy(true); setError(""); setResult(null);
    if (mode === "judge") {
      showLoader("Loading the owner's tracker",
        "The owner's real season of applications is being copied into your view. Nothing of yours is touched.");
    } else {
      setLog([{ line: mode === "imap"
        ? `Connecting to imap.gmail.com as ${imapEmail.trim() || "you"}, read only`
        : mode === "gmail" ? "Asking Google for the mailbox, read only"
        : "Opening the demo inbox: twenty two realistic emails", done: false }]);
    }

    const body: Record<string, unknown> = { mode };
    if (mode === "imap") { body.email = imapEmail; body.appPassword = imapPass; }
    const r = await fetch("/api/inbox/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "The connection dropped before the scan could start. Run it again." }));
    if (!r.ok) {
      setBusy(false);
      setError(r.error ?? "That did not work, and it is not your fault. Try another route below.");
      if (mode === "judge") setStep(0);
      return;
    }
    if (r.done) {
      setLog((xs) => xs.map((x) => ({ ...x, done: true })));
      setBusy(false);
      setResult({ created: r.created, updated: 0, emailsRead: 0, mode });
      await hold(1600);
      showLoader(mode === "judge" ? "Loading the owner's tracker" : "Opening your dashboard",
        mode === "judge" ? "The real season is in. One moment." : "Your tracker is built. One moment.");
      await hold(1200);
      setStep(3);
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
        showLoader("Opening your dashboard", "Your tracker is built. One moment.");
        await hold(1200);
        setStep(3);
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

      {/* ── 0 · the ask: one question, one big answer, one small one ─────── */}
      {step === 0 && (
        <section className="mx-auto mt-10 max-w-xl sm:mt-16">
          <div className="rounded-2xl bg-foreground p-6 text-background sm:p-8">
            <p className="text-[11px] uppercase tracking-[0.2em] opacity-70">Judging Carpa?</p>
            <h1 className="mt-1 font-display text-2xl font-semibold leading-tight">
              One click and the tracker is full: use the owner&rsquo;s inbox.
            </h1>
            <p className="mt-2 text-sm leading-relaxed opacity-80">
              So judges can see Carpa working on real mail without connecting anything
              of theirs: the tracker built from the owner&rsquo;s real season of
              applications, every status proven by the email that announced it.
            </p>
            <button onClick={() => void scan("judge")} disabled={busy} data-track="setup_judge"
                    className="mt-4 w-full rounded-full bg-background px-6 py-2.5 text-sm font-semibold text-foreground transition-transform hover:scale-[1.02] disabled:opacity-50">
              Use the owner&rsquo;s inbox
            </button>
            <p className="mt-3.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-background/60">
              <button onClick={() => setStep(1)} disabled={busy} data-track="setup_own"
                      className="underline underline-offset-2 transition-colors hover:text-background">
                use my own
              </button>
              <span>·</span>
              <span>≈ 5 min setup</span>
              <span>·</span>
              <Link href="/home" data-track="setup_skip"
                    className="underline underline-offset-2 transition-colors hover:text-background">
                skip for now
              </Link>
            </p>
          </div>
          {error && (
            <div className="mt-4 rounded-2xl border p-3 text-xs leading-relaxed" style={{ borderColor: "color-mix(in oklab, var(--amber) 45%, transparent)" }}>
              <p className="font-medium" style={{ color: "var(--amber)" }}>That did not go through</p>
              <p className="mt-0.5 text-muted-foreground">{error}</p>
            </div>
          )}
        </section>
      )}

      {/* ── 1 · the quiet door: connect your own inbox ────────────────────── */}
      {step === 1 && (
        <section className="mt-6 space-y-3">
          <div>
            <h1 className="font-display text-lg font-semibold">Connect your inbox</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              One app password from Google. The first scan reads your whole mailbox back to the
              beginning, then the tracker maintains itself. Nothing is ever written to it.
            </p>
          </div>

          {/* app password: the route that works for everyone, tutorial included */}
          <div className="card-lift rounded-2xl border border-border bg-white p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600/10"><KeyRound className="h-3.5 w-3.5 text-emerald-700" /></span> App password
              <span className="ml-1 rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700">works for any Google account</span>
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
              <li>Turn on <strong>2 Step Verification</strong> first: Google account, Security, 2 Step
                Verification. Google only offers app passwords once it is on.</li>
              <li>Then open <a className="underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>.</li>
              <li>Name it <strong>Carpa</strong>, press Create, and copy the 16 characters it shows.</li>
              <li>Paste them here. Carpa gets read only mail access you can revoke on that same page any time.</li>
            </ol>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <input value={imapEmail} onChange={(e) => setImapEmail(e.target.value)} placeholder="you@gmail.com"
                     className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-1.5 text-sm" inputMode="email" />
              <input value={imapPass} onChange={(e) => { setImapPass(e.target.value); setValidated(false); }} placeholder="16 character app password"
                     className="min-w-0 flex-1 rounded-lg border border-border px-2.5 py-1.5 text-sm" type="password" />
              <button onClick={() => void validate()} disabled={busy || !imapEmail.includes("@") || imapPass.replace(/\s/g, "").length < 12}
                      data-track="setup_check_pass"
                      title={!imapEmail.includes("@") ? "Type the Gmail address first" : imapPass.replace(/\s/g, "").length < 12 ? "Paste the full app password" : "Check the password"}
                      className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-40">
                {busy ? "Checking" : "Check password"}
              </button>
            </div>
            {validated && (
              <div className="mt-3 flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Password accepted
                </span>
                <button onClick={() => void continueAfterValidation()} disabled={busy} data-track="setup_continue"
                        className="rounded-full bg-foreground px-5 py-1.5 text-sm font-medium text-background transition-transform hover:scale-[1.02] disabled:opacity-50">
                  Continue
                </button>
              </div>
            )}
          </div>

{/* google oauth removed: the app-password route is the one that works
              everywhere, so it is the only route offered. */}

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
          <button onClick={() => setStep(0)} disabled={busy}
                  className="block text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground">
            back
          </button>
        </section>
      )}

      {/* ── 2 · the loader between choice and dashboard ───────────────────── */}
      {step === 2 && (
        <section className="flex min-h-[60vh] flex-col items-center justify-center text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground" />
          <p className="mt-4 text-sm font-medium">{loaderNote}</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">{loaderSub}</p>
        </section>
      )}

      {/* ── 3 · the dashboard: three doors, each saying what it is ────────── */}
      {step === 3 && (
        <section className="mx-auto mt-8 max-w-3xl sm:mt-10">
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600" />
            <h1 className="mt-2 font-display text-2xl font-semibold">You&rsquo;re in</h1>
            {result && (
              <p className="mt-1 text-xs text-muted-foreground">
                {result.mode === "judge"
                  ? `The owner's tracker is in your view: ${result.created} real applications.`
                  : `Read ${result.emailsRead.toLocaleString()} emails, found ${result.created} applications.`}
              </p>
            )}
          </div>

          <div className="mt-6 space-y-4">
            {/* the planner: the featured door, on the dark */}
            <Link href="/start" data-track="setup_done_planner"
                  className="card-lift group block overflow-hidden rounded-2xl bg-foreground text-background">
              <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
                <div className="min-w-0 flex-1">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/10">
                    <CalendarRange className="h-4 w-4" />
                  </span>
                  <p className="mt-3 font-display text-lg font-semibold">Planner</p>
                  <p className="mt-1 max-w-sm text-xs leading-relaxed opacity-75">
                    Paste a job posting and get the degree that answers it: semesters,
                    prerequisites, every pick quoting the catalog line that earned it.
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium">
                    Open the planner
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
                <div className="shrink-0 sm:w-60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/shots/planner.png" alt="A semester by semester plan built from a job posting"
                       className="w-full rounded-xl border border-white/15 shadow-lg" loading="lazy" />
                </div>
              </div>
            </Link>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* the tracker, with its own screenshot */}
              <Link href="/tracker" data-track="setup_done_tracker"
                    className="card-lift group block overflow-hidden rounded-2xl border border-border bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/shots/s3.png" alt="The application tracker built from an inbox"
                     className="aspect-[16/10] w-full border-b border-border object-cover object-top" loading="lazy" />
                <div className="p-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600/10">
                    <Inbox className="h-4 w-4 text-sky-700" />
                  </span>
                  <p className="mt-2.5 text-sm font-semibold">
                    Tracker
                    {trackerCount !== null && (
                      <span className="ml-2 rounded-full bg-sky-600/10 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                        {trackerCount} application{trackerCount === 1 ? "" : "s"} found
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Your applications, maintained from your inbox: every status proven by the
                    email that announced it.
                  </p>
                  <span className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    Open the tracker
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>

              {/* the dashboard, drawn rather than captured */}
              <Link href="/home" data-track="setup_done_home"
                    className="card-lift group block overflow-hidden rounded-2xl border border-border bg-white">
                <div className="flex aspect-[16/10] w-full items-end gap-2 border-b border-border bg-foreground/[0.03] p-4">
                  <div className="flex-1 space-y-1.5">
                    <div className="h-2 w-2/3 rounded-full bg-foreground/15" />
                    <div className="h-2 w-1/2 rounded-full bg-foreground/10" />
                    <div className="h-2 w-3/5 rounded-full bg-foreground/10" />
                  </div>
                  <div className="flex flex-1 items-end gap-1">
                    {[55, 80, 45, 95, 70].map((h, i) => (
                      <span key={i} className="w-full rounded-t"
                            style={{ height: `${h * 0.5}px`, background: i === 3 ? "var(--blue)" : "color-mix(in oklab, var(--blue) 25%, transparent)" }} />
                    ))}
                  </div>
                </div>
                <div className="p-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600/10">
                    <LayoutGrid className="h-4 w-4 text-violet-700" />
                  </span>
                  <p className="mt-2.5 text-sm font-semibold">Dashboard</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Everything in one place: your saved plans and the tracker summary,
                    one click into either.
                  </p>
                  <span className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    Go to my dashboard
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}