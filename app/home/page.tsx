"use client";

import { useCallback, useEffect, useState } from "react";
import { signIn, signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlanner } from "@/components/planner/planner-store";
import { Inbox, KeyRound, Loader2, LogOut, Mail, Play, RefreshCw, Search } from "lucide-react";
import { SemesterChart } from "@/components/planner/semester-chart";
import { semesterNames } from "@/components/planner/plan-screen";
import { termKindsFor } from "@/lib/verify";
import { fillOpenCredits, type FilledTerm } from "@/lib/solver";
import type { Course, Plan, Term } from "@/lib/types";

/**
 * The signed in front room: your past searches on one side, your inbox
 * tracker on the other, because these are the two things a student comes
 * back for. Everything else is one link away.
 */

type SearchRow = { id: string; title: string; coursesPicked: number | null; partsAnswered: number | null; createdAt: number };
type TrackerRow = {
  id: string; company: string; role: string | null; kind: string; status: string;
  quote: string | null; deadline: string | null; updatedAt: number;
};

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { restoreSnapshot } = usePlanner();
  const [searches, setSearches] = useState<SearchRow[] | null>(null);
  const [allSearches, setAllSearches] = useState(false);
  const [tracker, setTracker] = useState<TrackerRow[] | null>(null);
  const [scan, setScan] = useState<{ busy: boolean; note: string }>({ busy: false, note: "" });
  const [imapOpen, setImapOpen] = useState(false);
  const [imapEmail, setImapEmail] = useState("");
  const [imapPass, setImapPass] = useState("");

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([
      fetch("/api/searches").then((r) => r.json()).catch(() => null),
      fetch("/api/tracker").then((r) => r.json()).catch(() => null),
    ]);
    if (s?.ok) setSearches(s.searches);
    if (t?.ok) setTracker(t.items);
  }, []);
  useEffect(() => { if (status === "authenticated") void load(); }, [status, load]);

  const gmailConnected = Boolean((session as { gmailConnected?: boolean } | null)?.gmailConnected);
  const connectGmail = () =>
    // The incremental ask: same provider, wider scope, explicit consent. Only
    // people who choose this route ever see Google's Gmail permission screen.
    signIn("google", { callbackUrl: "/home" }, {
      scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
      access_type: "offline",
      prompt: "consent",
    });

  const runScan = async (mode: "gmail" | "imap" | "demo" | "judge") => {
    setScan({ busy: true, note: "Starting the scan" });
    const body: Record<string, unknown> = { mode };
    if (mode === "imap") { body.email = imapEmail; body.appPassword = imapPass; }
    const r = await fetch("/api/inbox/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch((e) => ({ ok: false, error: String(e) }));
    if (r.ok) {
      window.dispatchEvent(new Event("carpa-scan-started"));
      const tick = async () => {
        const j = (await fetch(`/api/inbox/scan?job=${r.jobId}`).then((x) => x.json()).catch(() => null))?.job;
        if (!j) { setTimeout(() => void tick(), 3000); return; }
        if (j.status === "running") {
          const n = (x: number) => Number(x).toLocaleString();
          const line =
            j.phase === "triage" ? `Sorting ${n(j.total)} emails by headers: ${n(j.done)} done` :
            j.phase === "reading" ? `Reading the ${n(j.total)} that matter: ${n(j.done)} done` :
            j.phase === "extracting" ? `Extracting statuses: ${n(j.done)} of ${n(j.total)}` :
            "Connecting to the mailbox";
          setScan({ busy: true, note: `${line}. Runs in the background; feel free to keep working.` });
          setTimeout(() => void tick(), 3000);
          return;
        }
        if (j.status === "done") {
          setScan({ busy: false, note: `Read ${Number(j.total).toLocaleString()} new emails${j.alreadyKnown ? ` (${Number(j.alreadyKnown).toLocaleString()} already remembered)` : ""}, ${j.created} new applications, ${j.updated} updated.` });
        } else {
          setScan({ busy: false, note: j.error ?? "The scan failed." });
        }
        void load();
      };
      void tick();
    } else {
      setScan({ busy: false, note: r.error ?? "The scan failed." });
    }
  };

  if (status === "loading") {
    return <Centered><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></Centered>;
  }

  if (status !== "authenticated") return <SignIn />;

  const openSearch = async (id: string) => {
    window.dispatchEvent(new Event("carpa-nav"));
    const r = await fetch(`/api/searches?id=${id}`).then((x) => x.json());
    if (!r.ok) return;
    // Into the LIVE store, not just storage: the provider hydrates once at
    // mount, so a storage write alone is invisible until a full reload.
    const snap = r.search.snapshot as { storageKey: string; payload: Parameters<typeof restoreSnapshot>[0] };
    restoreSnapshot(snap.payload);
    try { sessionStorage.setItem(snap.storageKey, JSON.stringify(snap.payload)); } catch { /* full */ }
    router.push("/plan");
  };

  const funnel = countBy(tracker ?? [], (t) => t.status);
  const kinds = countBy(tracker ?? [], (t) => t.kind);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">Hello, {session.user?.name?.split(" ")[0] ?? "you"}</h1>
          <p className="text-xs text-muted-foreground">{session.user?.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/start" data-track="home_new_search"
                className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background">
            <Search className="h-3.5 w-3.5" /> New course search
          </Link>
          <Link href="/tracker" data-track="home_open_tracker"
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs">
            <Inbox className="h-3.5 w-3.5" /> Tracker
          </Link>
          <button onClick={() => signOut({ callbackUrl: "/" })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </div>

      <LatestPlan searches={searches} openSearch={openSearch} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* ── saved searches ─────────────────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold">Your course searches</h2>
          <p className="text-xs text-muted-foreground">Every posting you planned against, with its full result. Click one to reopen it exactly as it was.</p>
          <div className="mt-3 space-y-2">
            {searches === null && <Skeleton n={3} />}
            {searches?.length === 0 && (
              <Empty text="No searches yet. Paste a posting and the result lands here on its own." cta={{ href: "/start", label: "Plan against a posting" }} />
            )}
            {searches?.slice(0, allSearches ? undefined : 4).map((s) => (
              <button key={s.id} onClick={() => openSearch(s.id)} data-track="home_open_search"
                      className="w-full rounded-xl border border-border bg-white p-3 text-left transition-all hover:border-[var(--blue)] hover:bg-[var(--blue-soft)]">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {s.coursesPicked ?? 0} courses picked for it · answers {s.partsAnswered ?? 0} parts · {ago(s.createdAt)}
                </p>
              </button>
            ))}
            {(searches?.length ?? 0) > 4 && (
              <button onClick={() => setAllSearches((v) => !v)} data-track="home_see_more_searches"
                      className="w-full rounded-xl border border-dashed border-border py-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
                {allSearches ? "See fewer" : `See all ${searches?.length}`}
              </button>
            )}
          </div>
        </section>

        {/* ── tracker summary + connect ──────────────────────────────────── */}
        <section>
          <h2 className="text-sm font-semibold">Application tracker</h2>
          <p className="text-xs text-muted-foreground">Built from your own email, every status backed by the sentence that announced it.</p>

          {(tracker?.length ?? 0) > 0 && (
            <>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(funnel).map(([k, n]) => (
                  <span key={k} className="rounded-full bg-foreground/5 px-2.5 py-1 text-[11px]">
                    <strong>{n}</strong> {k}
                  </span>
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {Object.entries(kinds).map(([k, n]) => (
                  <span key={k} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                    {n} {k}
                  </span>
                ))}
              </div>
              <div className="mt-3 space-y-1.5">
                {(tracker ?? []).slice(0, 5).map((t) => (
                  <Link key={t.id} href="/tracker" className="block rounded-lg border border-border bg-white px-3 py-2 text-xs hover:border-[var(--blue)]">
                    <span className="font-medium">{t.company}</span>
                    {t.role ? <span className="text-muted-foreground"> · {t.role}</span> : null}
                    <StatusPill status={t.status} />
                  </Link>
                ))}
                {(tracker?.length ?? 0) > 5 && (
                  <Link href="/tracker" data-track="home_see_more_tracker"
                        className="block rounded-lg border border-dashed border-border py-2 text-center text-xs text-muted-foreground transition-colors hover:text-foreground">
                    See all {tracker?.length} in the tracker
                  </Link>
                )}
              </div>
            </>
          )}

          <div className="mt-4 rounded-xl border border-border bg-white p-3">
            <p className="text-xs font-medium">Connect your inbox</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              The first scan reads back a year and builds the tracker by itself: what you applied to,
              where each one stands, grouped by kind. Nothing is written to your mailbox, ever.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button onClick={() => (gmailConnected ? void runScan("gmail") : void connectGmail())}
                      disabled={scan.busy} data-track="scan_gmail"
                      className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-medium text-background disabled:opacity-40">
                <Mail className="h-3.5 w-3.5" /> {gmailConnected ? "Scan Gmail" : "Connect Gmail"}
              </button>
              <button onClick={() => setImapOpen((v) => !v)} disabled={scan.busy} data-track="scan_imap_open"
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs disabled:opacity-40">
                <KeyRound className="h-3.5 w-3.5" /> App password
              </button>
              <button onClick={() => runScan("judge")} disabled={scan.busy} data-track="scan_judge"
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs disabled:opacity-40">
                <Play className="h-3.5 w-3.5" /> Judges&rsquo; inbox
              </button>
              <button onClick={() => runScan("demo")} disabled={scan.busy} data-track="scan_demo"
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-xs text-muted-foreground disabled:opacity-40">
                <Play className="h-3.5 w-3.5" /> Try the demo inbox
              </button>
              {(tracker?.length ?? 0) > 0 && (
                <button onClick={() => void load()} className="ml-auto text-muted-foreground" title="Refresh">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {imapOpen && (
              <div className="mt-2.5 space-y-1.5 rounded-lg bg-foreground/[0.03] p-2.5">
                <p className="text-[11px] text-muted-foreground">
                  Works for ANY Google account today, no approval lists. Google account &rarr;
                  Security &rarr; 2 Step Verification &rarr; App passwords, sixteen characters, read
                  only from here, revocable there any time.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <input value={imapEmail} onChange={(e) => setImapEmail(e.target.value)} placeholder="you@gmail.com"
                         className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-xs" inputMode="email" />
                  <input value={imapPass} onChange={(e) => setImapPass(e.target.value)} placeholder="app password"
                         className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-xs" type="password" />
                  <button onClick={() => runScan("imap")} disabled={scan.busy || !imapEmail || !imapPass} data-track="scan_imap_run"
                          className="rounded bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-40">
                    Scan
                  </button>
                </div>
              </div>
            )}
            {(scan.busy || scan.note) && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {scan.busy && <Loader2 className="h-3 w-3 animate-spin" />} {scan.note}
              </p>
            )}
          </div>
        </section>
      </div>

      {/* ── the two artifacts, visible without leaving home ─────────────── */}
      {(tracker?.length ?? 0) > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">The spreadsheet, live</h2>
            <Link href="/tracker" className="text-xs underline underline-offset-2 text-muted-foreground">open and edit</Link>
          </div>
          <div className="mt-2 overflow-x-auto rounded-xl border border-border bg-white">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-foreground/[0.03] text-muted-foreground">
                <tr>{["Company", "Role", "Kind", "Status", "Updated"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {(tracker ?? []).slice(0, 6).map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-3 py-1.5 font-medium">{t.company}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{t.role ?? ""}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{t.kind}</td>
                    <td className="px-3 py-1.5"><StatusPill status={t.status} /></td>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{new Date(t.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(tracker?.length ?? 0) > 6 && (
              <Link href="/tracker" data-track="home_see_more_sheet"
                    className="block border-t border-border py-2 text-center text-xs text-muted-foreground transition-colors hover:text-foreground">
                See all {tracker?.length} rows
              </Link>
            )}
          </div>
        </section>
      )}

    </main>
  );
}

/**
 * The most recent degree plan, on the dashboard, as the same board the
 * planner page draws: prerequisite arrows, what-is-it popovers, filler
 * courses, the lot. A snippet table looked related to the plan; this IS the
 * plan, reconstructed from the saved snapshot, and clicking through opens it
 * in full.
 */
function LatestPlan({ searches, openSearch }: {
  searches: SearchRow[] | null;
  openSearch: (id: string) => void;
}) {
  const [data, setData] = useState<{
    plan: Plan; names: string[]; courses: Map<string, Course>;
    fill: Map<number, FilledTerm>; completed: string[];
  } | null>(null);
  const latest = searches?.[0];
  useEffect(() => {
    if (!latest) return;
    let alive = true;
    void (async () => {
      try {
        const [r, cat] = await Promise.all([
          fetch(`/api/searches?id=${latest.id}`).then((x) => x.json()),
          fetch("/api/catalog").then((x) => x.json()),
        ]);
        if (!alive || !r.ok) return;
        const payload = r.search.snapshot.payload as {
          result?: { plans?: Plan[] };
          state?: {
            activePlan?: number;
            student?: { startTerm?: string; completed?: string[]; excluded?: string[] };
            relevance?: Record<string, { skill: string; evidence: string; strength?: "central" | "useful" | "tangential"; why?: string; rank?: number }[]>;
            targetSkills?: string[];
            shortlist?: string[];
            considerationAll?: { code: string; why: string }[];
          };
        };
        const st = payload.state ?? {};
        const plan = payload.result?.plans?.[st.activePlan ?? 0] ?? payload.result?.plans?.[0];
        if (!plan) return;
        const placed = new Set(plan.placements.map((pl) => pl.courseId));
        type CatSchool = { courses?: Course[] };
        const schools: CatSchool[] = cat?.schools ?? [];
        const school = schools.find((sc) => (sc.courses ?? []).some((c) => placed.has(c.id))) ?? schools[0];
        const catalog = school?.courses ?? [];
        const courses = new Map(catalog.map((c) => [c.id, c]));
        const startTerm = (st.student?.startTerm ?? "fall") as Term;
        const names = semesterNames(startTerm, plan.termCredits.length);
        const termKinds = termKindsFor(startTerm, plan.termCredits.length);
        const codeToId = new Map(catalog.map((c) => [c.code, c.id]));
        const order = st.considerationAll?.length
          ? st.considerationAll.map((x) => x.code)
          : st.shortlist ?? [];
        const shortlistRank = Object.fromEntries(
          order.map((code, i) => [codeToId.get(code), i] as const).filter(([id]) => id),
        ) as Record<string, number>;
        const fill = new Map(fillOpenCredits({
          catalog, plan,
          completed: st.student?.completed ?? [],
          excluded: st.student?.excluded,
          termKinds,
          relevance: st.relevance,
          targetSkills: st.targetSkills,
          shortlistRank,
          shortlistCount: (st.shortlist ?? []).length,
        }).map((f) => [f.term, f]));
        setData({ plan, names, courses, fill, completed: st.student?.completed ?? [] });
      } catch { /* the board simply does not render */ }
    })();
    return () => { alive = false; };
  }, [latest]);

  if (!latest || !data) return null;
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Latest plan: {latest.title.slice(0, 70)}</h2>
        <button onClick={() => openSearch(latest.id)} data-track="home_open_latest_plan"
                className="text-xs underline underline-offset-2 text-muted-foreground">
          open the full plan
        </button>
      </div>
      <div className="mt-2 rounded-xl border border-border bg-white p-3">
        <SemesterChart
          names={data.names}
          plan={data.plan}
          courses={data.courses}
          fill={data.fill}
          completed={data.completed}
          onJump={() => openSearch(latest.id)}
        />
      </div>
    </section>
  );
}

function SignIn() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  // What can actually sign someone in on THIS deployment. Rendering a Google
  // button that 404s because the env is empty is worse than saying so.
  const [providers, setProviders] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    void fetch("/api/auth/providers").then((r) => r.json()).then(setProviders).catch(() => setProviders({}));
  }, []);
  const hasGoogle = Boolean(providers && "google" in providers);
  // The demo door is for local testing and judging tables, off by default:
  // the owner asked for Google only, so Google only is what ships. Flip it on
  // with NEXT_PUBLIC_ALLOW_DEMO=1 or by visiting /home?demo.
  const allowDemo =
    process.env.NEXT_PUBLIC_ALLOW_DEMO === "1" ||
    (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo"));
  return (
    <Centered>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-white p-5 shadow-sm">
        <h1 className="font-display text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Google keeps your searches and connects your inbox for the tracker in the same step.
        </p>
        {providers === null ? (
          <div className="mt-3 h-9 animate-pulse rounded-full bg-foreground/5" />
        ) : hasGoogle ? (
          <button
            onClick={() => { setBusy(true); void signIn("google", { callbackUrl: "/setup" }); }}
            disabled={busy} data-track="signin_google"
            className="mt-3 w-full rounded-full bg-foreground py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            Continue with Google
          </button>
        ) : (
          <p className="mt-3 rounded-lg border border-border bg-foreground/[0.03] p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            Google sign in is not configured on this deployment yet. Set AUTH_GOOGLE_ID and
            AUTH_GOOGLE_SECRET in the environment and it appears here.
          </p>
        )}
        {allowDemo && (<>
        <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or just look around <span className="h-px flex-1 bg-border" />
        </div>
        <div className="space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
                 className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.edu"
                 className="w-full rounded-lg border border-border px-3 py-2 text-sm" inputMode="email" />
          <button
            onClick={async () => { setBusy(true); await signIn("demo", { name, email, callbackUrl: "/setup" }); setBusy(false); }}
            disabled={busy || !name || !email.includes("@")} data-track="signin_demo"
            className="w-full rounded-full border border-border py-2 text-sm disabled:opacity-40"
          >
            Enter with a demo account
          </button>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            The demo account saves your searches and lets you run the demo inbox. Google unlocks
            scanning your own mail.
          </p>
        </div>
        </>)}
      </div>
    </Centered>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "rejected" ? "background: color-mix(in oklab, #b91c1c 12%, transparent); color: #b91c1c" :
    status === "offer" || status === "accepted" ? "background: color-mix(in oklab, #15803d 14%, transparent); color: #15803d" :
    status === "interview" || status === "assessment" ? "background: color-mix(in oklab, var(--blue) 14%, transparent); color: var(--blue-deep, var(--blue))" :
    status === "action needed" ? "background: color-mix(in oklab, var(--amber) 18%, transparent); color: var(--amber)" :
    "background: var(--foreground)/0.05; color: var(--muted-foreground, #666)";
  return (
    <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={Object.fromEntries(tone.split(";").map((x) => x.split(":").map((y) => y.trim())).map(([k, v]) => [k === "background" ? "background" : "color", v]))}>
      {status}
    </span>
  );
}

function countBy<T>(xs: T[], f: (x: T) => string) {
  const out: Record<string, number> = {};
  for (const x of xs) out[f(x)] = (out[f(x)] ?? 0) + 1;
  return out;
}
function ago(t: number) {
  const d = Math.round((Date.now() - t) / 86400000);
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-[70vh] items-center justify-center px-4">{children}</main>;
}
function Skeleton({ n }: { n: number }) {
  return <>{Array.from({ length: n }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-foreground/5" />)}</>;
}
function Empty({ text, cta }: { text: string; cta?: { href: string; label: string } }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-4 text-center">
      <p className="text-xs text-muted-foreground">{text}</p>
      {cta && <Link href={cta.href} className="mt-2 inline-block rounded-full border border-border px-3 py-1 text-xs">{cta.label}</Link>}
    </div>
  );
}
