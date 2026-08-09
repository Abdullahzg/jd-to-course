"use client";

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import type { Course, Plan, School, SolveResponse, StudentState, Term } from "@/lib/types";
import { prereqSatisfied } from "@/lib/solver/core";
import { termKindsFor } from "@/lib/verify";

/**
 * Every change the student makes gets recorded with what they did, why the
 * solver had to move things, and what actually came out. A board that silently
 * rearranges itself is a board you stop trusting.
 */
export type ChangeRecord = {
  id: number;
  action: string;
  reason: string;
  effects: string[];
  state: PlannerState;
  result: SolveResponse | null;
};

type Catalog = { schools: School[] };

export type PlannerState = {
  schoolId: string;
  programId: string;
  student: StudentState;
  targetSkills: string[];
  /** targetSkill -> catalog wording, from /api/match */
  skillMatches: Record<string, string[]>;
  /** courseId -> what it teaches for THIS job, with the catalog's own sentence */
  relevance: Record<string, { skill: string; evidence: string; strength?: "central" | "useful" | "tangential" }[]>;
  /**
   * skill -> the sentence in the posting that asked for it, and whether a class
   * can actually supply it. This is what makes the requirement list checkable
   * instead of something you have to take on faith.
   */
  skillEvidence: Record<string, { quote: string; kind: string }>;
  /** One line saying what the job is, taken from the posting. */
  roleSummary: string;
  /** Skills the student typed in themselves. Kept apart so they are never confused with the posting's. */
  customSkills: string[];
  /**
   * Graduates of this degree, found by public web search while the plan is
   * being worked out. Held in state rather than fetched on demand so the panel
   * is populated the moment the page appears, not a click and a wait later.
   */
  alumni: { name: string; classOf: string; studied: string; nowAt: string; url: string; initials: string }[];
  /** Courses the last relevance pass could not read. A missed course is not a course that teaches nothing. */
  coursesUnread: number;
  /** The parts of the work this posting describes, each quoted from it. */
  facets: { name: string; quote: string; weight: string }[];
  /** Every course judged to help, with why and both quotes. */
  fits: { courseId: string; aspects: string[]; courseQuote: string; jobQuote: string; why: string; strength: string; title: string; code: string }[];
  jd: string;
  activePlan: number;
  selectedCourse: string | null;
};

/**
 * Bumped whenever the solver or the shape of a plan changes.
 *
 * A saved session written by an older build can describe a world that no longer
 * exists, and restoring it silently is worse than losing it: a user sat looking
 * at "No plan fits in 8 terms" through three separate fixes, because the
 * failure had been frozen into their session and every reload replayed it.
 */
const STORAGE = "slack.planner.v3";

/** "Fall 2026", "Spring 2027", and so on from a start term. */
function semesterLabels(startTerm: Term, n: number): string[] {
  const out: string[] = [];
  let t = startTerm;
  let y = new Date().getFullYear() + (startTerm === "FA" ? 0 : 1);
  for (let i = 0; i < n; i++) {
    out.push(`${t === "FA" ? "Fall" : "Spring"} ${y}`);
    if (t === "FA") { t = "SP"; y += 1; } else { t = "FA"; }
  }
  return out;
}

const INITIAL: PlannerState = {
  schoolId: "COLUMBIA",
  programId: "COLUMBIA:CS_BA",
  student: {
    program: "COLUMBIA:CS_BA",
    completed: [],
    startTerm: "FA",
    horizonTerms: 4,
    locked: [],
    excluded: [],
    completedCredits: 0,
  },
  targetSkills: [],
  skillMatches: {},
  relevance: {},
  skillEvidence: {},
  roleSummary: "",
  customSkills: [],
  alumni: [],
  coursesUnread: 0,
  facets: [],
  fits: [],
  jd: "",
  activePlan: 0,
  selectedCourse: null,
};

type Ctx = {
  state: PlannerState;
  setState: (patch: Partial<PlannerState>) => void;
  catalog: Catalog | null;
  courses: Map<string, Course>;
  school: School | null;
  program: School["programs"][number] | null;

  result: SolveResponse | null;
  solving: boolean;
  /** true while a re-solve is in flight, so the board can play the reflow */
  reflowing: boolean;
  /** course ids that moved or appeared on the last solve — these get the pulse */
  changed: Set<string>;
  error: string | null;

  history: ChangeRecord[];
  historyIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  lastChange: ChangeRecord | null;
  summary: string | null;
  summaryBusy: boolean;
  solveWith: (next: PlannerState, preferCourse?: string, change?: { action: string; reason: string }) => Promise<void>;
  runSolve: (overrides?: Partial<PlannerState>) => Promise<void>;
  toggleLock: (courseId: string, term: number, label?: string) => void;
  exclude: (courseId: string, label?: string) => void;
  unexclude: (courseId: string, label?: string) => void;
  chooseSlot: (bucketId: string, replace: string, withCourse: string, replaceLabel?: string, withLabel?: string) => void;
  keepInPlan: (courseId: string, label?: string) => void;
  reset: () => void;
};

/**
 * Which semester to pin a course to when the student asks for it by name.
 *
 * `StudentState.locked` demands a term, and the wrong term is not a nudge, it is
 * a plan that does not exist. Pinning COMS W4113 to semester 3 returns nothing
 * at all, because that course is taught in Fall only and semester 3 of a Fall
 * start is a Spring. So the term is picked the way the scheduler itself would:
 * the first semester whose season the course is actually taught in, whose
 * prerequisites are behind it, and which still has room under the credit cap.
 *
 * Exported so a solver harness can check the choice against the real solver
 * rather than against a copy of this rule that can drift away from it.
 */
export function pickTermForKeep(
  course: Course | undefined,
  plan: Plan | null,
  student: StudentState,
  maxCreditsPerTerm: number,
): number {
  if (!course) return 0;
  // Already on the board: pinning it anywhere else would move it for no reason.
  const already = plan?.placements.find((p) => p.courseId === course.id);
  if (already) return already.term;

  const kinds = termKindsFor(student.startTerm as Term, student.horizonTerms);
  const inSeason: number[] = [];
  for (let t = 0; t < kinds.length; t++) {
    if (course.termsOffered.includes(kinds[t])) inSeason.push(t);
  }
  if (!inSeason.length) return 0;

  const placements = plan?.placements ?? [];
  const ready = (t: number) => {
    const have = new Set<string>(student.completed);
    for (const p of placements) if (p.term < t) have.add(p.courseId);
    return prereqSatisfied(course.prereq, have);
  };
  const room = (t: number) => (plan?.termCredits[t] ?? 0) + course.credits <= maxCreditsPerTerm;

  return (
    inSeason.find((t) => ready(t) && room(t))
    // Nothing satisfies both. The cap is the softer of the two: the solver may
    // move any unpinned course out of the semester it is told to use, while a
    // prerequisite that has not happened yet is a flat no.
    ?? inSeason.find((t) => ready(t))
    // No semester has the prerequisites behind it either, so give them as much
    // room as the horizon has and let the solver say whether that works.
    ?? inSeason[inSeason.length - 1]
  );
}

const PlannerCtx = createContext<Ctx | null>(null);

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const [state, setStateRaw] = useState<PlannerState>(INITIAL);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [result, setResult] = useState<SolveResponse | null>(null);
  /**
   * The written summary, fetched here rather than on the plan page.
   *
   * The page used to mount, show "writing it out", and sit there for several
   * seconds after a minute of loading the student had already waited through.
   * The plan exists the moment the solve returns, which is while the loader is
   * still on screen, so that is when the summary starts. By the time the page
   * appears it is usually already written.
   */
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const summaryFor = useRef<string>("");
  /** A plan restored without its write-up, so one can be requested once mounted. */
  const restoreNeedsSummary = useRef<{ res: SolveResponse; st: PlannerState } | null>(null);
  const [solving, setSolving] = useState(false);
  const [reflowing, setReflowing] = useState(false);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChangeRecord[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const changeId = useRef(0);

  // The action handlers below fire from inside a setState updater, before the
  // next render exists. Reading current values through refs keeps every one of
  // them stable-by-identity without ever reading a stale plan — which would
  // otherwise mark every card as "changed" and pulse the whole board.
  const resultRef = useRef<SolveResponse | null>(null);
  const stateRef = useRef<PlannerState>(INITIAL);
  const hydrated = useRef(false);
  const pulseTimer = useRef<number | null>(null);
  const historyIndexRef = useRef(-1);
  /** solveWith is stable-by-identity, so it must read the catalog through a
   *  ref; the closure copy is the empty map from before the fetch landed, and
   *  that is why the change log printed raw ids instead of course codes. */
  const coursesRef = useRef<Map<string, Course>>(new Map());
  /** same reason: the credit cap lives on the program, and keepInPlan needs it
   *  from inside a stable callback that cannot see the memo above. */
  const programRef = useRef<School["programs"][number] | null>(null);
  /** the plan as first solved, so undo can walk all the way back to it */
  const baseline = useRef<{ state: PlannerState; result: SolveResponse | null } | null>(null);

  useEffect(() => { resultRef.current = result; }, [result]);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Restore across the Setup → Board → Coverage hop.
  useEffect(() => {
    try {
      // Sweep the keys older builds used, so a stale plan cannot linger in a
      // tab that was open across a deploy.
      for (const old of ["slack.planner.v1", "slack.planner.v2"]) {
        try { sessionStorage.removeItem(old); } catch { /* fine */ }
      }
      const raw = sessionStorage.getItem(STORAGE);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.state) {
          const restored = { ...INITIAL, ...saved.state };
          setStateRaw(restored);
          stateRef.current = restored;
        }
        // A failure is a moment, not a plan.
        //
        // Restoring one means a transient timeout, or a bug since fixed,
        // outlives the thing that caused it. The successful plans are worth
        // keeping across a page hop; a failure is worth re-testing, because the
        // answer may simply be different now.
        if (saved.result?.ok) {
          setResult(saved.result);
          resultRef.current = saved.result;

          // The write-up was component state, so a reload restored the plan and
          // dropped the paragraphs explaining it. It is derived from this exact
          // plan, so it is stored with the key of the plan it describes and
          // only restored if the two still match.
          const plan = saved.result.plans?.[0];
          const key = plan
            ? plan.placements.map((p: { courseId: string; term: number }) => `${p.courseId}@${p.term}`).sort().join("|")
            : "";
          if (saved.summary && saved.summaryFor && saved.summaryFor === key) {
            setSummary(saved.summary);
            summaryFor.current = key;
          } else if (plan) {
            // No stored write-up for this plan, so write one rather than
            // leaving an empty panel where the explanation used to be.
            restoreNeedsSummary.current = { res: saved.result, st: { ...INITIAL, ...saved.state } };
          }
        }
      }
    } catch { /* a corrupt session is not worth a crash */ }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      // Same reason: never write a failure to storage in the first place.
      sessionStorage.setItem(
        STORAGE,
        JSON.stringify({
          state,
          result: result?.ok ? result : null,
          summary: result?.ok ? summary : null,
          summaryFor: result?.ok ? summaryFor.current : null,
        }),
      );
    } catch { /* quota — the app still works, it just won't survive a reload */ }
  }, [state, result, summary]);

  useEffect(() => {
    let alive = true;
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((c) => { if (alive) setCatalog(c); })
      .catch(() => { if (alive) setError("Couldn't load the catalog."); });
    return () => { alive = false; };
  }, []);

  useEffect(() => () => { if (pulseTimer.current) window.clearTimeout(pulseTimer.current); }, []);

  const setState = useCallback((patch: Partial<PlannerState>) => {
    setStateRaw((s) => {
      const next = { ...s, ...patch };
      stateRef.current = next;
      return next;
    });
  }, []);

  const courses = useMemo(() => {
    const m = new Map<string, Course>();
    for (const s of catalog?.schools ?? []) for (const c of s.courses) m.set(c.id, c);
    return m;
  }, [catalog]);

  useEffect(() => { coursesRef.current = courses; }, [courses]);

  const school = useMemo(
    () => catalog?.schools.find((s) => s.id === state.schoolId) ?? null,
    [catalog, state.schoolId],
  );
  const program = useMemo(
    () => school?.programs.find((p) => p.id === state.programId) ?? null,
    [school, state.programId],
  );

  useEffect(() => { programRef.current = program; }, [program]);

  const solveWith = useCallback(async (
    next: PlannerState,
    preferCourse?: string,
    change?: { action: string; reason: string },
  ) => {
    const previousPlan = resultRef.current?.plans?.[0] ?? null;
    const before = new Map<string, number>(
      previousPlan?.placements.map((p) => [p.courseId, p.term] as const) ?? [],
    );
    const hadPlan = !!resultRef.current?.ok;

    setError(null);
    setSolving(true);
    // §9.1 step 1 — affected cards fade to 40% and lift while the solver runs.
    if (hadPlan) setReflowing(true);

    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId: next.schoolId,
          programId: next.programId,
          student: { ...next.student, program: next.programId },
          targetSkills: next.targetSkills,
          skillMatches: next.skillMatches,
          relevance: next.relevance,
          centrality: Object.fromEntries((next.facets ?? []).map((f) => [f.name, f.weight])),
          k: 3,
        }),
      });
      const json: SolveResponse = await res.json();

      // §9.1 step 4 — only what genuinely moved earns the amber pulse.
      const moved = new Set<string>();
      for (const p of json.plans?.[0]?.placements ?? []) {
        const prev = before.get(p.courseId);
        if (prev === undefined || prev !== p.term) moved.add(p.courseId);
      }
      if (preferCourse) moved.add(preferCourse);

      setChanged(moved);
      setResult(json);
      resultRef.current = json;
      void writeSummary(json, next);
      const merged = { ...next, activePlan: 0, selectedCourse: preferCourse ?? null };
      stateRef.current = merged;
      setStateRaw(merged);

      if (change) {
        const rec: ChangeRecord = {
          id: ++changeId.current,
          action: change.action,
          reason: change.reason,
          effects: describeEffects(previousPlan, json.plans?.[0] ?? null, coursesRef.current),
          state: merged,
          result: json,
        };
        setHistory((h) => {
          const trimmed = h.slice(0, historyIndexRef.current + 1);
          const nextH = [...trimmed, rec];
          historyIndexRef.current = nextH.length - 1;
          setHistoryIndex(historyIndexRef.current);
          return nextH;
        });
      }
    } catch {
      setError("The solver did not answer. Nothing was lost, try again.");
    } finally {
      setSolving(false);
      setReflowing(false);
      if (pulseTimer.current) window.clearTimeout(pulseTimer.current);
      pulseTimer.current = window.setTimeout(() => setChanged(new Set()), 900);
    }
  }, []);

  const runSolve = useCallback(async (overrides: Partial<PlannerState> = {}) => {
    const next = { ...stateRef.current, ...overrides };
    setStateRaw(next);
    stateRef.current = next;
    await solveWith(next);
  }, [solveWith]);

  const mutateAndSolve = useCallback(
    (
      mutate: (s: PlannerState) => PlannerState,
      preferCourse?: string,
      change?: { action: string; reason: string },
    ) => {
      // The first change needs somewhere to undo back to.
      if (!baseline.current && resultRef.current) {
        baseline.current = { state: stateRef.current, result: resultRef.current };
      }
      const next = mutate(stateRef.current);
      stateRef.current = next;
      setStateRaw(next);
      void solveWith(next, preferCourse, change);
    },
    [solveWith],
  );

  /** §9.2 — "I know something the model doesn't." Pin it; solve around it. */
  const toggleLock = useCallback((courseId: string, term: number, label = courseId) => {
    const wasLocked = stateRef.current.student.locked.some((l) => l.courseId === courseId);
    mutateAndSolve((s) => {
      const has = s.student.locked.some((l) => l.courseId === courseId);
      return {
        ...s,
        student: {
          ...s.student,
          locked: has
            ? s.student.locked.filter((l) => l.courseId !== courseId)
            : [...s.student.locked, { courseId, term }],
        },
      };
    }, undefined, {
      action: wasLocked ? `Unpinned ${label}` : `Pinned ${label} to semester ${term + 1}`,
      reason: wasLocked
        ? "You let it move again, so everything is free to shift."
        : "You wanted it in that semester, so everything else had to fit around it.",
    });
  }, [mutateAndSolve]);

  const exclude = useCallback((courseId: string, label = courseId) => {
    mutateAndSolve((s) => ({
      ...s,
      student: {
        ...s.student,
        excluded: [...new Set([...s.student.excluded, courseId])],
        locked: s.student.locked.filter((l) => l.courseId !== courseId),
      },
    }), undefined, {
      action: `Removed ${label}`,
      reason: "You said you did not want this course, so it had to be replaced.",
    });
  }, [mutateAndSolve]);

  const unexclude = useCallback((courseId: string, label = courseId) => {
    mutateAndSolve((s) => ({
      ...s,
      student: { ...s.student, excluded: s.student.excluded.filter((x) => x !== courseId) },
    }), undefined, {
      action: `Put ${label} back`,
      reason: "You allowed it again, so it can be picked if it helps.",
    });
  }, [mutateAndSolve]);

  /**
   * §9.3 — picking an alternative rules out the one the solver had chosen and
   * lets it re-derive the whole board around the choice, rather than swapping
   * one card in place and pretending nothing else was affected. Watching the
   * rest of the board move is the point.
   */
  const chooseSlot = useCallback((
    _bucketId: string, replace: string, withCourse: string,
    replaceLabel = replace, withLabel = withCourse,
  ) => {
    mutateAndSolve((s) => ({
      ...s,
      student: {
        ...s.student,
        excluded: [...new Set([...s.student.excluded, replace])],
        locked: s.student.locked.filter((l) => l.courseId !== replace),
      },
    }), withCourse, {
      action: `Swapped ${replaceLabel} for ${withLabel}`,
      reason: "You picked a different course for that slot, so the rest of the plan was worked out again around it.",
    });
  }, [mutateAndSolve]);

  /**
   * "Put this exact course in the plan."
   *
   * Not the same move as picking an alternative for a slot, and the difference
   * was measured. chooseSlot rules out the course it is replacing, and for a
   * course asked for by name that is the wrong mechanism: excluding COMS W4121
   * to make room for COMS W4113 returns no plan at all, because W4113 is taught
   * in Fall only and the slot it was aimed at is a Spring. Adding it and letting
   * the solver work out what has to leave reaches plans exclusion cannot:
   * COMS W4156 displaces COMS W4118 by itself, and COMS W4731 arrives while
   * COMS W4771 stays, which no exclusion can produce because excluding W4771 has
   * no solution at all.
   */
  const keepInPlan = useCallback((courseId: string, label = courseId) => {
    const term = pickTermForKeep(
      coursesRef.current.get(courseId),
      resultRef.current?.plans?.[0] ?? null,
      stateRef.current.student,
      programRef.current?.maxCreditsPerTerm ?? Infinity,
    );
    mutateAndSolve((s) => ({
      ...s,
      student: {
        ...s.student,
        locked: [...s.student.locked.filter((l) => l.courseId !== courseId), { courseId, term }],
        // Asking for a course by name and having removed it earlier are the same
        // question answered two ways, and the solver drops every excluded course
        // from its pools, so a pin on one can only ever come back as "no plan
        // fits". The ask wins. Nothing else on the list is touched.
        excluded: s.student.excluded.filter((x) => x !== courseId),
      },
    }), courseId, {
      action: `Added ${label}`,
      reason: "You asked for this course by name, so the plan was worked out again with it held in place. Anything that had to leave to make room for it is listed here.",
    });
  }, [mutateAndSolve]);

  const jumpTo = useCallback((i: number) => {
    const rec = history[i];
    if (!rec) return;
    historyIndexRef.current = i;
    setHistoryIndex(i);
    setStateRaw(rec.state);
    stateRef.current = rec.state;
    setResult(rec.result);
    resultRef.current = rec.result;
  }, [history]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) {
      // Back past the first recorded change is the original plan.
      const first = history[0];
      if (first && historyIndexRef.current === 0 && baseline.current) {
        historyIndexRef.current = -1;
        setHistoryIndex(-1);
        setStateRaw(baseline.current.state);
        stateRef.current = baseline.current.state;
        setResult(baseline.current.result);
        resultRef.current = baseline.current.result;
      }
      return;
    }
    jumpTo(historyIndexRef.current - 1);
  }, [history, jumpTo]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= history.length - 1) return;
    jumpTo(historyIndexRef.current + 1);
  }, [history, jumpTo]);

  /** Ask for the write-up of a freshly solved plan. Skipped when the plan is unchanged. */
  const writeSummary = useCallback(async (res: SolveResponse, st: PlannerState) => {
    const plan = res.plans?.[0];
    if (!plan || !res.coverage) return;
    const key = plan.placements.map((p) => `${p.courseId}@${p.term}`).sort().join("|");
    if (key === summaryFor.current) return;
    summaryFor.current = key;
    setSummary(null);
    setSummaryBusy(true);
    try {
      const names = semesterLabels(st.student.startTerm as Term, plan.termCredits.length);
      const cat = coursesRef.current;
      const r = await fetch("/api/summary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: {
            semesters: names.map((n, t) => ({
              name: n,
              courses: plan.placements.filter((p) => p.term === t).map((p) => ({
                code: cat.get(p.courseId)?.code,
                title: cat.get(p.courseId)?.title,
                teaches: p.covers.map((c) => c.skill),
                whyItIsHere: p.covers.length
                  ? "chosen because it answers this posting"
                  : "required by the degree no matter which job you are aiming at",
                waitedFor: p.earliestReason,
              })),
              majorCredits: plan.termCredits[t],
              otherCredits: plan.openCreditsNeeded[t],
            })),
            teaches: plan.skillsCovered,
            chosenForThisJob: plan.placements.filter((p) => p.covers.length > 0).length,
            requiredByDegreeAnyway: plan.placements.filter((p) => p.covers.length === 0).length,
            // The parts of the work, which is what the page shows and what the
            // plan is measured against. The summary used to be handed the
            // requirement list instead, whose names are different, so it wrote
            // about "Java" and "C++" while the page showed "Building data
            // integration features", and answeredByThisPlan was false for every
            // one of them because the two lists share no vocabulary.
            partsOfTheJob: (st.facets ?? []).map((f) => ({
              part: f.name,
              importance: f.weight,
              quotedFromPosting: f.quote,
              answeredByThisPlan: plan.skillsCovered.includes(f.name),
              coursesThatDoIt: plan.placements
                .filter((p) => p.covers.some((c) => c.skill === f.name))
                .map((p) => cat.get(p.courseId)?.title)
                .filter(Boolean),
            })),
            // Kept separate, and clearly labelled, because these are not what
            // the plan is scored on.
            alsoWantedButNotPlannedAgainst: Object.entries(st.skillEvidence ?? {})
              .filter(([, v]) => v.kind !== "teachable")
              .map(([k, v]) => ({
                thing: k,
                why: v.kind === "credential"
                  ? "an issuing body grants this, no course does"
                  : "a class can teach the subject, the posting also wants it practised",
              })),
            roleSummary: st.roleSummary,
            cannotTeach: res.coverage.courseworkCannotGive.map((c) => c.skill),
            totalCredits: plan.totalCredits,
          },
        }),
      });
      const reader = r.body?.getReader();
      if (!reader) throw new Error("no stream");
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      setSummary("");
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
          if (ev.type === "delta") { acc += String(ev.text ?? ""); setSummary(acc); }
          else if (ev.type === "done" && ev.ok) setSummary(String(ev.text ?? acc).trim());
        }
      }
    } catch {
      /* the plan itself does not depend on this */
    } finally {
      setSummaryBusy(false);
    }
  }, []);

  // Fires once after a restore that brought a plan but no write-up.
  useEffect(() => {
    const pending = restoreNeedsSummary.current;
    if (!pending) return;
    restoreNeedsSummary.current = null;
    void writeSummary(pending.res, pending.st);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses.size]);

  const reset = useCallback(() => {
    setStateRaw(INITIAL);
    stateRef.current = INITIAL;
    setResult(null);
    resultRef.current = null;
    setChanged(new Set());
    setError(null);
    setHistory([]);
    setHistoryIndex(-1);
    historyIndexRef.current = -1;
    baseline.current = null;
    try { sessionStorage.removeItem(STORAGE); } catch { /* fine */ }
  }, []);

  const value: Ctx = {
    state, setState, catalog, courses, school, program,
    result, solving, reflowing, changed, error,
    history, historyIndex,
    canUndo: historyIndex >= 0,
    canRedo: historyIndex < history.length - 1,
    undo, redo,
    lastChange: historyIndex >= 0 ? history[historyIndex] ?? null : null,
    summary, summaryBusy,
    solveWith, runSolve, toggleLock, exclude, unexclude, chooseSlot, keepInPlan, reset,
  };

  return <PlannerCtx.Provider value={value}>{children}</PlannerCtx.Provider>;
}

/** Plain sentences for what actually moved between two plans. */
function describeEffects(
  before: Plan | null,
  after: Plan | null,
  courses: Map<string, Course>,
): string[] {
  if (!after) return ["No plan fits any more. Undo to go back."];
  if (!before) return ["First plan worked out."];
  // Titles, not codes. "Added COMS W4111" means nothing to a student reading it.
  const name = (id: string) => courses.get(id)?.title ?? id;
  const semester = (t: number) => `semester ${t + 1}`;
  const out: string[] = [];

  const b = new Map(before.placements.map((p) => [p.courseId, p.term]));
  const a = new Map(after.placements.map((p) => [p.courseId, p.term]));

  const added = [...a.keys()].filter((id) => !b.has(id));
  const removed = [...b.keys()].filter((id) => !a.has(id));
  const moved = [...a.entries()].filter(([id, t]) => b.has(id) && b.get(id) !== t);

  if (added.length) out.push(`Added ${added.map(name).join(", ")}`);
  if (removed.length) out.push(`Took out ${removed.map(name).join(", ")}`);
  for (const [id, t] of moved.slice(0, 4)) {
    out.push(`${name(id)} moved from ${semester(b.get(id)!)} to ${semester(t)}`);
  }
  if (moved.length > 4) out.push(`and ${moved.length - 4} more courses moved`);

  const dSkills = after.skillsCovered.length - before.skillsCovered.length;
  if (dSkills !== 0) {
    const lost = before.skillsCovered.filter((s) => !after.skillsCovered.includes(s));
    const gained = after.skillsCovered.filter((s) => !before.skillsCovered.includes(s));
    if (gained.length) out.push(`Now also teaches ${gained.join(", ")}`);
    if (lost.length) out.push(`No longer teaches ${lost.join(", ")}`);
  }
  const dCredits = after.totalCredits - before.totalCredits;
  if (dCredits !== 0) out.push(`${dCredits > 0 ? "+" : ""}${dCredits} credits overall`);

  const brokeNow = after.buckets.filter((x) => !x.satisfied).map((x) => x.label);
  if (brokeNow.length) out.push(`Still missing: ${brokeNow.join(", ")}`);

  return out.length ? out : ["Nothing else had to move."];
}

export function usePlanner(): Ctx {
  const ctx = useContext(PlannerCtx);
  if (!ctx) throw new Error("usePlanner must be used inside PlannerProvider");
  return ctx;
}
