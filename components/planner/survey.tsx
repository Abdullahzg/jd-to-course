"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Loader2, Search, X } from "lucide-react";
import type { StudentState } from "@/lib/types";
import { usePlanner, type PlannerState } from "./planner-store";
import { useBudget } from "@/components/budget/budget-provider";

type SchoolLite = {
  id: string; shortName: string; name: string; structureNote: string; courseCount: number;
  programs: { id: string; name: string; totalCredits: number; majorCredits: number; maxCreditsPerTerm: number; minCreditsPerTerm: number; bucketCount: number }[];
};

/**
 * One question per screen, and the screen never scrolls. A survey you have to
 * scroll is one where you cannot tell whether you have finished the question,
 * so every step is built to fit the viewport and only genuinely long lists get
 * their own scroll area inside it.
 */
export function Survey({
  jds, demos, schools,
}: {
  jds: { id: string; label: string; body: string }[];
  demos: Record<string, StudentState>;
  schools: SchoolLite[];
}) {
  const router = useRouter();
  const { state, setState, courses, solveWith } = usePlanner();
  const { refresh, noteSpend } = useBudget();

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<null | "skills" | "matching" | "reading" | "solve">(null);
  /**
   * What the run has done so far, in its own words.
   *
   * Reading a hundred and fifty course descriptions takes the better part of a
   * minute, and a spinner over that length of time reads as a hang. Every step
   * appends a line here with the real number it produced, so the wait is
   * evidence of work rather than an absence of it.
   */
  const [log, setLog] = useState<{ text: string; done: boolean }[]>([]);
  /** How many courses this run will actually read. The catalog holds more than one school. */
  const [poolSize, setPoolSize] = useState(0);
  /** Courses read so far, streamed back from the server as each wave lands. */
  const [readCount, setReadCount] = useState(0);
  /** How many courses the first pass thought were worth a proper read. */
  const [shortlisted, setShortlisted] = useState(0);
  /** The quick first pass over the whole catalog. */
  const [triage, setTriage] = useState({ read: 0, total: 0 });
  /** A running feed of what the catalog read is finding and throwing out. */
  const [feed, setFeed] = useState<{ kind: "found" | "rejected"; text: string; skill: string }[]>([]);
  const say = (text: string) => setLog((l) => [...l.map((x) => ({ ...x, done: true })), { text, done: false }]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const jdRef = useRef<HTMLTextAreaElement>(null);

  // Grow the posting box to fit what was pasted, up to half the screen.
  useEffect(() => {
    const el = jdRef.current;
    if (!el) return;
    // Grow with the paste, but never past the space the step actually has, so
    // the survey keeps its promise of not scrolling the page.
    el.style.height = "auto";
    const room = Math.max(224, el.parentElement?.clientHeight ?? 0);
    el.style.height = `${Math.min(el.scrollHeight + 2, room)}px`;
  }, [state.jd, step]);

  const school = schools.find((s) => s.id === state.schoolId) ?? schools[0];
  const program = school?.programs.find((p) => p.id === state.programId) ?? school?.programs[0];

  const schoolCourses = useMemo(
    () => [...courses.values()].filter((c) => c.id.startsWith(`${state.schoolId}:`)),
    [courses, state.schoolId],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "");
    const pool = schoolCourses.filter((c) => !state.student.completed.includes(c.id));
    if (!q) return pool.slice().sort((a, b) => a.code.localeCompare(b.code));
    return pool.filter(
      (c) => c.code.toLowerCase().replace(/\s+/g, "").includes(q) ||
             c.title.toLowerCase().includes(query.trim().toLowerCase()),
    );
  }, [query, schoolCourses, state.student.completed]);

  const fullTerms = Math.max(2, Math.min(8, Math.round((program?.totalCredits ?? 124) / 15.5)));
  const stages = [
    { label: "Not started yet", hint: "first semester ahead of you", frac: 0 },
    { label: "One year in", hint: "a couple of semesters done", frac: 0.25 },
    { label: "About halfway", hint: "roughly two years left", frac: 0.5 },
    { label: "Final year", hint: "the home stretch", frac: 0.75 },
  ].map((s) => ({
    ...s,
    credits: Math.round((program?.totalCredits ?? 124) * s.frac),
    terms: Math.max(1, Math.round(fullTerms * (1 - s.frac))),
  }));

  const run = async (jd: string, student: StudentState, schoolId: string, programId: string) => {
    setError(null);
    setLog([]);
    setFeed([]);
    setTriage({ read: 0, total: 0 });
    setBusy("skills");
    say("Reading the posting");
    const sk = await fetch("/api/skills", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jd }),
    }).then((r) => r.json()).catch(() => ({ ok: false }));
    noteSpend(sk.costUsd);
    const skills: string[] = sk.ok ? sk.skills : FALLBACK;
    // The parts of the work, which is what courses are actually matched against.
    const facets: { name: string; quote: string; weight: string; actor?: "own" | "around"; actorQuote?: string }[] = sk.ok ? (sk.facets ?? []) : [];
    if (!sk.ok) setError("Could not read that posting, so a standard skill list is being used. Everything else works the same.");

    if (sk.ok) {
      const ev = (sk.evidence ?? {}) as Record<string, { kind: string }>;
      const cred = Object.values(ev).filter((e) => e.kind === "credential").length;
      const exp = Object.values(ev).filter((e) => e.kind === "experience").length;
      say(`Found ${skills.length} things it asks for, each quoted from a line you pasted`
        + (cred ? `, ${cred} of them a credential no course issues` : "")
        + (exp ? `, ${exp} wanting the subject practised` : ""));
    }

    // The vocabulary aligner used to sit here, turning the posting's words into
    // the catalog's words. Nothing downstream reads its answer any more: courses
    // are now judged against the posting directly, so this was a paid call and
    // several seconds of a student's time spent on a result nobody looked at.

    setBusy("reading");

    // Kicked off here and never awaited on the critical path. Finding
    // graduates takes about as long as reading the catalog, and there is no
    // reason for one to wait on the other. Whichever finishes first fills in.
    const alumniPromise = fetch("/api/alumni", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        school: school?.name ?? school?.shortName ?? "",
        program: program?.name ?? "",
      }),
    }).then((r) => r.json()).catch(() => ({ ok: false }));

    const cat = await fetch("/api/catalog").then((r) => r.json()).catch(() => null);
    const pool: string[] = cat?.schools
      ?.find((sc: { id: string }) => sc.id === schoolId)
      ?.courses.filter((c: { id: string }) => !student.completed.includes(c.id))
      .map((c: { id: string }) => c.id) ?? [];

    setPoolSize(pool.length);
    say(`Reading ${pool.length} course descriptions against this posting, and quoting the sentence behind every match`);

    // Streamed rather than awaited in one lump, so the count on screen is the
    // real number of courses that have come back, not an animation timed to
    // look busy. A student staring at a minute of nothing deserves to know
    // something is actually happening, and a fake counter would be the one
    // dishonest thing on a page built entirely around checkable claims.
    setReadCount(0);
    let rl: {
      ok?: boolean;
      fits?: {
        courseId: string; aspects: string[]; courseQuote: string; jobQuote: string;
        why: string; aspectWhy?: Record<string, string>; rank?: number; strength: string; title: string; code: string;
      }[];
      aspects?: { key: string; label: string; courses: string[] }[];
      costUsd?: number; coursesRead?: number; coursesUnread?: number; unquotable?: number;
      shortlisted?: number; ruledOutEarly?: number; notFullyRead?: number; shortlistCodes?: string[];
      considerationAll?: { code: string; why: string }[];
    } = { ok: false };
    try {
      // The whole posting goes to every course, rather than a keyword distilled
      // out of it. See app/api/fit/route.ts for why that funnel had to go.
      const res = await fetch("/api/fit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd, schoolId, courseIds: pool, facets, stream: true }),
      });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no stream");
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === "progress" && ev.phase === "triage") {
            setTriage({ read: Number(ev.read) || 0, total: Number(ev.total) || 0 });
          } else if (ev.type === "progress" && typeof ev.read === "number") {
            setReadCount(Number(ev.read) || 0);
            if (ev.total) setShortlisted(Number(ev.total));
            const found = (ev.found ?? []) as { code: string; title: string; aspects: string[] }[];
            if (found.length) {
              setFeed((f) => [
                ...found.map((x: { title: string; aspects: string[] }) =>
                  ({ kind: "found" as const, text: x.title, skill: (x.aspects ?? []).join(", ") })),
                ...f,
              ].slice(0, 40));
            }
          } else if (ev.type === "done") rl = ev as typeof rl;
        }
      }
    } catch (e) {
      rl = { ok: false };
      setError(e instanceof Error ? e.message : "The catalog read did not finish, so no plan could be built. Nothing was lost; try again.");
    }
    noteSpend(rl.costUsd);
    void refresh();
    if (rl.ok) {
      const helpful = rl.fits?.length ?? 0;
      const parts = new Set((rl.fits ?? []).flatMap((f) => f.aspects ?? [])).size;
      if (rl.ruledOutEarly) {
        say(`Ruled out ${rl.ruledOutEarly} courses on a first look, then read the other ${rl.shortlisted} in full`);
      }
      say(`${helpful} of them would genuinely help with this job, across ${parts} of its parts`
        + ((rl.unquotable ?? 0) ? `, and ${rl.unquotable} judgements were thrown out for not quoting both sides` : ""));
      if (rl.coursesUnread) say(`${rl.coursesUnread} course${rl.coursesUnread === 1 ? "" : "s"} could not be reached this run`);
    }

    // The solver still thinks in terms of "this course covers that". What
    // changed is what "that" is: no longer a keyword lifted out of the posting,
    // but a named part of the work the posting describes.
    const relevance: Record<string, { skill: string; evidence: string; strength?: "central" | "useful" | "tangential"; why?: string; rank?: number }[]> = {};
    const fits = (rl.fits ?? []) as {
      courseId: string; aspects: string[]; courseQuote: string; jobQuote: string;
      why: string; aspectWhy?: Record<string, string>; rank?: number; strength: string; title: string; code: string;
    }[];
    for (const f of fits) {
      for (const a of f.aspects ?? []) {
        (relevance[f.courseId] ??= []).push({
          skill: a,
          evidence: f.courseQuote,
          strength: f.strength as "central" | "useful" | "tangential",
          why: f.aspectWhy?.[a],
          rank: f.rank,
        });
      }
    }

    setBusy("solve");
    say("Working out the timetable: prerequisites, terms offered, credit caps, every degree rule");
    const next = {
      ...state, schoolId, programId, jd,
      student: { ...student, program: programId },
      // A credential is a fact about paperwork, not about what you know. Handing
      // "publications at NeurIPS" to the solver as a skill let a machine
      // learning course claim to answer it, which is how a course ended up
      // ticking off a publication record. They stay on the page, they just stop
      // being something a timetable can win.
      // The plan is built against the parts of the work. The requirement list
      // still exists and is still shown, but it is no longer what decides which
      // courses get chosen.
      targetSkills: facets.length ? facets.map((f) => f.name) : skills.filter((k) => (sk.evidence?.[k]?.kind ?? "teachable") !== "credential"),
      facets,
      fits,
      skillMatches: {},
      relevance,
      // The consideration order. Even a course that proves no part of the
      // posting was weighed against it, and "weighed and placed 23rd" is a
      // metric where "spread across departments" was a shrug.
      shortlist: rl.shortlistCodes ?? [],
      considerationAll: rl.considerationAll ?? [],
      skillEvidence: sk.evidence ?? {},
      roleSummary: sk.roleSummary ?? "",
      customSkills: [],
      alumni: [] as PlannerState["alumni"],
      coursesUnread: rl.ok ? (rl.coursesUnread ?? 0) : 0,
    };

    // By now the search has almost certainly landed, but the plan never waits
    // on it: a missing alumni list is a missing panel, not a missing plan.
    const al = await Promise.race([
      alumniPromise,
      new Promise<{ ok: false }>((r) => setTimeout(() => r({ ok: false }), 4000)),
    ]);
    if ((al as { ok?: boolean })?.ok) {
      const people = ((al as { people?: PlannerState["alumni"] }).people ?? []);
      next.alumni = people;
      if (people.length) {
        say(`Found ${people.length} graduates of this degree you could ask about it`);
      }
    }
    setState(next);
    if (!rl.ok) {
      // Reading the catalog is what a plan is made of. Walking someone onto
      // /plan without it hands them a blank page and calls it a result.
      setBusy(null);
      return;
    }
    await solveWith(next);
    setBusy(null);
    router.push("/plan");
  };

  const steps = [
    {
      short: "School",
      title: "Where do you study?",
      sub: "Both catalogs are real. Every rule comes from the university's own pages.",
      body: (
        <div className="grid gap-4 sm:grid-cols-2">
          {schools.map((s) => {
            const on = s.id === state.schoolId;
            return (
              <button
                key={s.id}
                onClick={() => {
                  const p = s.programs[0];
                  setState({
                    schoolId: s.id, programId: p.id,
                    student: { ...state.student, program: p.id, completed: [], locked: [], excluded: [], completedCredits: 0 },
                  });
                }}
                data-on={on}
                className="card-field p-5 text-left transition-all"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-2xl font-semibold">{s.shortName}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-3">
                    <span className="text-sm text-white/70">{s.courseCount} courses</span>
                    {on && <Check className="h-5 w-5" />}
                  </span>
                </span>
                <span className="mt-2 block text-sm leading-relaxed text-white/65">{s.structureNote}</span>
              </button>
            );
          })}
        </div>
      ),
    },
    {
      short: "Degree",
      title: "Which degree are you doing?",
      sub: program
        ? `${program.totalCredits} credits in total, of which ${program.majorCredits} belong to the major. ${program.bucketCount} rules, all quoted from the bulletin.`
        : "",
      body: (
        <div className="flex flex-wrap gap-3">
          {school?.programs.map((p) => (
            <button
              key={p.id}
              onClick={() => setState({ programId: p.id, student: { ...state.student, program: p.id } })}
              data-on={p.id === state.programId}
              className="card-field px-6 py-4 text-left text-lg transition-all"
            >
              {p.name}
            </button>
          ))}
        </div>
      ),
    },
    {
      short: "Progress",
      title: "How far along are you?",
      sub: "Pick the closest. The two numbers underneath are yours to adjust.",
      body: (
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            {stages.map((s) => {
              const on = s.credits === state.student.completedCredits && s.terms === state.student.horizonTerms;
              return (
                <button
                  key={s.label}
                  onClick={() => setState({
                    student: {
                      ...state.student, completedCredits: s.credits, horizonTerms: s.terms,
                      ...(s.frac === 0 ? { completed: [], locked: [], excluded: [] } : {}),
                    },
                  })}
                  data-on={on}
                  className="card-field p-4 text-left transition-all"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-xl font-semibold">{s.label}</span>
                    {on && <Check className="h-5 w-5 shrink-0" />}
                  </span>
                  <span className="mt-1 block text-sm text-white/60">
                    {s.hint} · {s.credits} credits done, {s.terms} semester{s.terms === 1 ? "" : "s"} to go
                  </span>
                </button>
              );
            })}
          </div>

          {stages.some((s) => s.credits === state.student.completedCredits && s.terms === state.student.horizonTerms) ? (
            <p className="mt-6 border-t border-white/15 pt-5 text-white/60">
              That works out to {Math.max(0, (program?.totalCredits ?? 0) - state.student.completedCredits)} credits
              left across {state.student.horizonTerms} semester{state.student.horizonTerms === 1 ? "" : "s"},
              starting this {state.student.startTerm === "FA" ? "fall" : "spring"}. You can change any of
              it later on the plan.
            </p>
          ) : (
            <p className="mt-6 border-t border-white/15 pt-5 text-white/60">
              Pick whichever is closest. It sets how many semesters the plan has to work with, and you
              can change it later on the plan.
            </p>
          )}
        </div>
      ),
    },
    {
      short: "Done",
      title: "Which classes have you passed?",
      sub: "Search the real catalog. Skip this if you have not started.",
      body: (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-white/70" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="A code like COMS W3134, or a title like Data Structures"
              className="on-blue-field w-full py-4 pl-14 pr-5 text-lg" autoComplete="off"
            />
          </div>

          {!!state.student.completed.length && (
            <p className="mt-2 shrink-0 text-sm text-white/55">
              {state.student.completed.length} passed · {state.student.completed.reduce((s, id) => s + (courses.get(id)?.credits ?? 0), 0)} credits
            </p>
          )}
          {!!state.student.completed.length && (
            <ul className="mt-2 max-h-40 shrink-0 overflow-y-auto rounded-2xl flex flex-wrap gap-2 pr-1">
              {state.student.completed.map((id) => {
                const c = courses.get(id);
                return c ? (
                  <li key={id}>
                    <button
                      onClick={() => setState({ student: { ...state.student, completed: state.student.completed.filter((x) => x !== id) } })}
                      className="flex max-w-full items-center gap-2 rounded-full bg-white px-4 py-1.5 text-sm text-[var(--blue-deep)]"
                    >
                      <span className="truncate font-medium">{c.title}</span>
                      <span className="code shrink-0 text-xs opacity-60">{c.code}</span>
                      <X className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  </li>
                ) : null;
              })}
            </ul>
          )}

          <ul className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto rounded-3xl border border-white/20 bg-white/[0.06] p-2">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => {
                    const completed = [...new Set([...state.student.completed, c.id])];
                    const credits = completed.reduce((s, id) => s + (courses.get(id)?.credits ?? 0), 0);
                    setState({ student: { ...state.student, completed, completedCredits: Math.max(state.student.completedCredits, credits) } });
                  }}
                  className="flex w-full items-baseline gap-4 rounded-2xl px-4 py-2.5 text-left transition-colors hover:bg-white/15"
                >
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="code shrink-0 text-xs text-white/70">{c.code}</span>
                  <span className="tabular shrink-0 text-sm text-white/70">{c.credits} cr</span>
                </button>
              </li>
            ))}
            {!results.length && <li className="px-4 py-4 text-white/55">Nothing in this catalog matches that.</li>}
          </ul>
        </div>
      ),
    },
    {
      short: "The job",
      title: "What job do you want?",
      sub: "Paste the posting, or pick one. This is the only place a model reads free text.",
      body: (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex shrink-0 flex-wrap gap-2.5">
            {jds.map((j) => (
              <button
                key={j.id}
                onClick={() => setState({ jd: j.body, targetSkills: [], skillMatches: {}, relevance: {} })}
                className={`rounded-full border px-5 py-2.5 transition-all ${
                  state.jd === j.body
                    ? "border-white bg-white font-semibold text-[var(--blue-deep)]"
                    : "border-white/30 hover:border-white/65 hover:bg-white/10"
                }`}
              >
                {j.label}
              </button>
            ))}
          </div>
          <div className="relative min-h-0 flex-1">
            <textarea
              ref={jdRef}
              value={state.jd}
              onChange={(e) => {
                setState({ jd: e.target.value, targetSkills: [], skillMatches: {}, relevance: {}, skillEvidence: {}, roleSummary: "", customSkills: [] });
                // Show the top of what landed. Pasting scrolled the box to the
                // end, so the first thing anyone saw after pasting a posting
                // was its equal-opportunity footer, not its job title.
                requestAnimationFrame(() => { if (jdRef.current) jdRef.current.scrollTop = 0; });
              }}
              placeholder="Paste the whole posting. Responsibilities and qualifications both, not just the bullet list."
              spellCheck={false}
              className="on-blue-field jd-box h-full min-h-[14rem] w-full resize-none overflow-y-auto p-5 text-lg leading-relaxed"
            />
            {/* Live proof it is reading what you pasted, rather than a box that
                swallows text and says nothing until the very end. */}
            <div className="pointer-events-none absolute bottom-3 right-4 flex items-center gap-2">
              {state.jd.trim().length > 0 && (
                <span className={`tabular rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                  state.jd.trim().length < 200
                    ? "bg-white/15 text-white/60"
                    : "bg-white/90 font-medium text-[var(--blue-deep)]"
                }`}>
                  {(() => {
                    // Name the role back to them: the cheapest possible proof
                    // that the box holds the posting they meant to paste.
                    const first = state.jd.trim().split("\n").map((l) => l.trim()).find((l) => l.length > 3 && l.length < 90);
                    const words = state.jd.trim().split(/\s+/).length;
                    return first && state.jd.trim().length >= 200 ? `${first} · ${words} words` : `${words} words`;
                  })()}
                  {state.jd.trim().length < 200 && ", paste more of it"}
                </span>
              )}
            </div>
          </div>
        </div>
      ),
    },
  ];

  const current = steps[step];
  const last = step === steps.length - 1;
  const canGo = !last || state.jd.trim().length >= 40;

  return (
    <div className="survey-ground timetable-grid relative flex h-full flex-col overflow-hidden">
      {busy && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[var(--blue-deep)]/92 px-6 backdrop-blur-sm">
          <div className="w-full max-w-[640px]">
            <p className="label text-white/50">Working</p>
            <h2 className="mt-1.5 font-display text-[clamp(1.5rem,3vw,2.2rem)] font-semibold leading-tight text-white">
              {busy === "skills" ? "Reading your posting"
                : busy === "matching" ? "Lining up the wording"
                : busy === "reading" ? (
                    // Two passes, two counters, and they used to share one line,
                    // so the number climbed to 151, reset, and climbed again.
                    readCount === 0
                      ? "Looking over the whole catalog"
                      : <>Reading{" "}
                          <span className="tabular" style={{ color: "var(--blue-light)" }}>
                            {readCount}
                          </span>
                          <span className="text-white/70">/{shortlisted || poolSize}</span>{" "}
                          in full
                        </>
                  )
                : "Working out the timetable"}
            </h2>
            <p className="mt-1.5 text-white/55">
              This takes two to four minutes. Every claim it ends up making has to be quoted from a real
              page, so it reads every course rather than guessing from titles.
            </p>

            <ol className="mt-6 space-y-2.5">
              {log.map((l, i) => (
                <li key={i} className="rise-in flex items-start gap-3 text-white">
                  <span className="mt-0.5 shrink-0">
                    {l.done
                      ? <Check className="h-4 w-4" style={{ color: "var(--blue-light)" }} />
                      : <Loader2 className="h-4 w-4 animate-spin" />}
                  </span>
                  <span className={`text-[15px] leading-snug ${l.done ? "text-white/55" : "text-white"}`}>
                    {l.text}
                  </span>
                </li>
              ))}
            </ol>

            {/* During the long pass the bar tracks the real count, so it moves
                because work finished and not because time passed. */}
            <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{
                  width:
                    busy === "skills" ? "10%"
                      : busy === "reading" && readCount === 0 && triage.total
                        ? `${18 + Math.round((triage.read / triage.total) * 22)}%`
                      : busy === "reading" && (shortlisted || poolSize)
                        ? `${42 + Math.round((readCount / (shortlisted || poolSize)) * 50)}%`
                      : busy === "reading" ? "22%"
                      : "96%",
                  background: "var(--blue-light)",
                }}
              />
            </div>
            {busy === "reading" && feed.length > 0 && (
              <ul className="mt-4 space-y-1">
                {feed.slice(0, 6).map((f, i) => (
                  <li
                    key={`${f.kind}-${f.text}-${f.skill}-${i}`}
                    className="rise-in flex items-start gap-2 text-sm"
                    style={{ opacity: Math.max(0.3, 1 - i * 0.14) }}
                  >
                    {f.kind === "found" ? (
                      <>
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--blue-light)" }} />
                        <span className="min-w-0 flex-1 truncate text-white/85">
                          <span className="font-medium">{f.text}</span>
                          <span className="text-white/70"> answers {f.skill}</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/55" />
                        <span className="min-w-0 flex-1 truncate text-white/60">
                          threw out {f.text} for {f.skill}
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {busy === "reading" && (
              <p className="mt-3 text-sm text-white/70">
                {readCount === 0
                  ? `${triage.read || 0} of ${triage.total || poolSize} skimmed, finding the ones worth reading properly`
                  : `${Math.max(0, (shortlisted || poolSize) - readCount)} to go, out of ${shortlisted || poolSize} the first pass kept from ${poolSize}`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* header: wordmark + step rail */}
      <header className="flex shrink-0 items-center gap-6 px-6 py-5 lg:px-12">
        <Link href="/" className="font-display text-lg font-semibold tracking-tight">Carpa</Link>
        <ol className="ml-auto hidden items-center gap-1.5 md:flex">
          {steps.map((s, i) => (
            <li key={s.short}>
              <button
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                  i === step ? "bg-white font-semibold text-[var(--blue-deep)]"
                  : i < step ? "text-white/70 hover:bg-white/10" : "text-white/55"
                }`}
              >
                {s.short}
              </button>
            </li>
          ))}
        </ol>
      </header>

      {/* the question, sized to the viewport */}
      <div className="flex min-h-0 flex-1 flex-col px-6 lg:px-12">
        <div key={step} className="step-in mx-auto flex min-h-0 w-full max-w-[1000px] flex-1 flex-col justify-center py-4">
          <p className="stepno shrink-0 text-sm text-white/60">
            {String(step + 1).padStart(2, "0")}<span className="text-white/45">/{String(steps.length).padStart(2, "0")}</span>
          </p>
          <h1 className="mt-2 shrink-0 font-display text-[clamp(1.7rem,3.6vw,2.8rem)] font-semibold leading-[1.03] tracking-[-0.02em]">
            {current.title}
          </h1>
          <p className="mt-3 max-w-2xl shrink-0 text-base leading-relaxed text-white/65 lg:text-lg">
            {current.sub}
          </p>

          <div className="step-body mt-6 flex min-h-0 flex-1 flex-col overflow-hidden sm:mt-7">{current.body}</div>

          {error && (
            <p className="mt-3 shrink-0 rounded-2xl border border-white/25 bg-white/10 p-3 text-sm">{error}</p>
          )}
        </div>
      </div>

      {/* actions, always in the same place */}
      <footer className="shrink-0 border-t border-white/15 px-6 py-5 lg:px-12">
        <div className="mx-auto flex w-full max-w-[1000px] flex-wrap items-center gap-4">
          <button
            onClick={() => (step === 0 ? router.push("/") : setStep((s) => s - 1))}
            className="flex items-center gap-2 rounded-full border border-white/30 px-6 py-3.5 transition-colors hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" /> Back
          </button>

          {!last ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-lg font-semibold text-[var(--blue-deep)] transition-transform hover:scale-[1.03]"
            >
              Next <ArrowRight className="h-5 w-5" />
            </button>
          ) : (
            <button
              onClick={() => void run(state.jd, state.student, state.schoolId, state.programId)}
              disabled={!canGo || !!busy}
              className="flex items-center gap-3 rounded-full bg-white px-8 py-3.5 text-lg font-semibold text-[var(--blue-deep)] transition-transform hover:scale-[1.03] disabled:opacity-45 disabled:hover:scale-100"
            >
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}
              {busy === "skills" ? "Reading this posting"
                : busy === "matching" ? "Lining up the words"
                : busy === "reading" ? `Reading ${poolSize || courses.size} course descriptions`
                : busy === "solve" ? "Building your plan" : "Build my plan"}
              {!busy && <ArrowRight className="h-5 w-5" />}
            </button>
          )}

          {last && !canGo && <span className="text-white/55">Paste a posting, or pick one above.</span>}

          <button
            onClick={() => {
              const demo = demos[state.schoolId] ?? demos.COLUMBIA;
              void run(jds[0].body, demo, demo.program.split(":")[0], demo.program);
            }}
            disabled={!!busy}
            className="ml-auto text-white/60 underline underline-offset-4 transition-colors hover:text-white disabled:opacity-45"
          >
            Skip and show me an example
          </button>
        </div>
      </footer>
    </div>
  );
}

const FALLBACK = [
  "PyTorch", "Machine learning", "Deep learning", "Distributed systems", "Python",
  "Kubernetes", "SQL", "Linux", "Containers", "Model serving", "Data engineering",
  "3 years of production experience shipping ML systems",
];
