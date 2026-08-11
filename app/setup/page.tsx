"use client";

import { useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronRight, KeyRound, Loader2, Mail, Play, ShieldQuestion, X } from "lucide-react";

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
  const [result, setResult] = useState<{ created: number; updated: number; emailsRead: number } | null>(null);
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
    narrate(
      mode === "imap" || mode === "judge"
        ? [
            `Connecting to imap.gmail.com as ${mode === "judge" ? "the judges' inbox" : imapEmail.trim() || "you"}`,
            "Signed in read only. Listing the last year of mail",
            "Reading headers first: sorting applications from newsletters",
            "Reading the bodies that matter, extracting statuses with their proving sentences",
            "Checking every quote against the email it claims to come from",
            "Building your tracker rows",
          ]
        : mode === "gmail"
          ? [
              "Asking Google for the last year of messages",
              "Reading headers first: sorting applications from newsletters",
              "Reading the bodies that matter, extracting statuses with their proving sentences",
              "Checking every quote against the email it claims to come from",
              "Building your tracker rows",
            ]
          : [
              "Opening the demo inbox: twenty two realistic emails",
              "Reading headers, then bodies, extracting statuses with proof",
              "Building your tracker rows",
            ],
    );
    const body: Record<string, unknown> = { mode };
    if (mode === "imap") { body.email = imapEmail; body.appPassword = imapPass; }
    const r = await fetch("/api/inbox/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "The connection dropped mid scan. Nothing was lost; run it again." }));
    timers.current.forEach((t) => window.clearTimeout(t));
    setLog((xs) => xs.map((x) => ({ ...x, done: true })));
    setBusy(false);
    if (r.ok) {
      setResult(r);
      setStep(2);
    } else {
      setError(r.error ?? "That did not work, and it is not your fault. Try another route below.");
    }
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
        <section className="mt-6 rounded-2xl border border-border bg-white p-5">
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
          <p className="mt-3 rounded-lg border border-border p-2.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldQuestion className="mr-1 inline h-3.5 w-3.5" />
            Judging Carpa rather than using it? The next step includes the judges&rsquo; option: scan the
            owner&rsquo;s real, connected inbox instead of your own, so you can watch the tracker work on
            genuine mail without granting anything.
          </p>
          <button onClick={() => setStep(1)} data-track="setup_next"
                  className="mt-4 w-full rounded-full bg-foreground py-2.5 text-sm font-medium text-background">
            Set up my inbox
          </button>
          <Link href="/home" className="mt-2 block text-center text-xs text-muted-foreground underline underline-offset-2">
            skip for now
          </Link>
        </section>
      )}

      {step === 1 && (
        <section className="mt-6 space-y-3">
          {/* app password: the route that works for everyone, tutorial included */}
          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><KeyRound className="h-4 w-4" /> App password
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
          <div className="rounded-2xl border border-border bg-white p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Mail className="h-4 w-4" /> Google sign in</p>
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

          {/* the judges' inbox */}
          <div className="rounded-2xl border-2 border-dashed border-border bg-white p-4">
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Play className="h-4 w-4" /> Judging Carpa?</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Scan the owner&rsquo;s real inbox instead, or the scripted demo inbox. Both show the whole
              flow without touching your own mail.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button onClick={() => setJudgePopup(true)} disabled={busy} data-track="setup_judge"
                      className="rounded-full border border-border px-4 py-1.5 text-sm disabled:opacity-40">
                Use the judges&rsquo; inbox
              </button>
              <button onClick={() => void scan("demo")} disabled={busy} data-track="setup_demo"
                      className="rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground disabled:opacity-40">
                Demo inbox
              </button>
            </div>
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
            Read {result.emailsRead} emails, found {result.created} applications and updated {result.updated}.
            Every status carries the sentence that proved it.
          </p>
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
              This button scans the <strong className="text-foreground">owner&rsquo;s real Gmail</strong>, connected by them
              through a read only app password, so you can watch Carpa build a tracker from genuine mail
              without granting access to anything of yours. The results land in your own view and touch
              nothing else.
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
