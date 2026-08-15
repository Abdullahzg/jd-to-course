"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import {
  ArrowRight, Check, ChevronDown, ExternalLink, Loader2, Lock, Redo2,
  RotateCcw, TriangleAlert, Undo2, X,
  Plus,
  Users,
  Search,
} from "lucide-react";
import type { Course, Placement, Plan, SlotAlternative, SlotChoice, Term } from "@/lib/types";
import { usePlanner } from "./planner-store";
import { useBudget } from "@/components/budget/budget-provider";
import { termKindsFor, verifyPlan } from "@/lib/verify";
import { PlanDoctor } from "./plan-doctor";
import { describeDiff, fillOpenCredits, type ElectiveOption, type FilledTerm } from "@/lib/solver";
import { prereqSatisfied } from "@/lib/solver/core";
import type { PrereqNode } from "@/lib/types";
import { AskPanel } from "./ask-panel";
import { RichText } from "./rich-text";
import { SemesterChart } from "./semester-chart";
import { WhatIsIt } from "./what-is-it";
import { PrereqList } from "./prereq-list";
import { CourseFinder } from "./course-finder";
import { TakeIt } from "./take-it";

const BASE_YEAR = 2026;

export function semesterNames(start: Term, n: number): string[] {
  const out: string[] = [];
  let t = start, y = BASE_YEAR;
  for (let i = 0; i < n; i++) {
    out.push(`${t === "FA" ? "Fall" : "Spring"} ${y}`);
    if (t === "FA") { t = "SP"; y += 1; } else { t = "FA"; }
  }
  return out;
}

/**
 * A requirement is not just a thing the job wants. It is a thing the job wants
 * in a particular way, and the way decides whether a degree can supply it at
 * all. Splitting them out is the difference between a plan that looks complete
 * and a plan that is honest about what it leaves you still needing.
 */
const KIND_ORDER = ["teachable", "experience", "credential"] as const;
type SkillKind = (typeof KIND_ORDER)[number];

const KIND_META: Record<SkillKind, { label: string; color: string }> = {
  teachable: { label: "A class can teach you these", color: "var(--teal)" },
  experience: { label: "These want the subject practised, not just studied", color: "var(--amber)" },
  credential: { label: "These need a credential no course issues", color: "var(--clay)" },
};

/**
 * One page. The plan, what each course teaches you, and the checklist of
 * everything the degree requires, side by side. Splitting these across three
 * screens meant nobody could see that the checklist is completed *by* the
 * courses, which is the only relationship that matters here.
 */
export function PlanScreen() {
  const {
    state, setState, result, solving, reflowing, courses, school, program, changed, keepInPlan,
    toggleLock, exclude, unexclude, chooseSlot, runSolve, solveWith,
    history, canUndo, canRedo, undo, redo, lastChange, summary, summaryBusy,
    repair, clearRepair, tryArrangement, removeCourse, addCourse, moveCourse, lastRemovedTerm, restoreSnapshot,
  } = usePlanner();
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [openFix, setOpenFix] = useState<string | null>(null);
  const [addHere, setAddHere] = useState<number | null>(null);
  const [addQuery, setAddQuery] = useState("");
  // A plan you built belongs to your account, not to one browser tab. An
  // empty store on /plan pulls your newest saved search back from the
  // database before showing "no plan yet" to someone who has one.
  const triedRestore = useRef(false);
  useEffect(() => {
    if (result?.ok || triedRestore.current) return;
    triedRestore.current = true;
    void (async () => {
      try {
        const list = await fetch("/api/searches").then((r) => r.json());
        const latest = list?.searches?.[0];
        if (!latest) return;
        const full = await fetch(`/api/searches?id=${latest.id}`).then((r) => r.json());
        if (full?.ok && full.search?.snapshot?.payload) restoreSnapshot(full.search.snapshot.payload);
      } catch { /* signed out or nothing saved; the empty state stands */ }
    })();
  }, [result, restoreSnapshot]);
  const { noteSpend } = useBudget();

  const [openAlts, setOpenAlts] = useState<string | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);

  /**
   * Go to a course and make it obvious which one arrived.
   *
   * This lived inline in the chart's onJump prop, so nothing else on the page
   * could reuse it. The prerequisite tags need exactly this behaviour, and a
   * second implementation that scrolled slightly differently would be worse
   * than no second implementation.
   */
  const jumpToCourse = useCallback((t: number, courseId?: string) => {
    if (courseId) {
      setOpenAlts(courseId);
      setTimeout(() => {
        const el = document.getElementById(`course-${courseId}`);
        if (!el) return;
        // A filler course lives inside a collapsed disclosure. Scrolling would
        // land on a hidden element, so anything shut between here and the page
        // root is opened first.
        let node: HTMLElement | null = el;
        while (node) {
          if (node instanceof HTMLDetailsElement) node.open = true;
          node = node.parentElement;
        }
        requestAnimationFrame(() => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.remove("landed");
          void el.offsetWidth;
          el.classList.add("landed");
        });
      }, 60);
      return;
    }
    document.getElementById(`term-${t}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const [openQuote, setOpenQuote] = useState<string | null>(null);
  const [draftSkill, setDraftSkill] = useState("");
  const [addingSkill, setAddingSkill] = useState(false);

  /**
   * Add a requirement the posting did not mention.
   *
   * This is a full re-run, not a cosmetic tag. The catalog is read again for
   * the new skill so any course that teaches it arrives with the sentence that
   * proves it, and the solver starts over, so the plan can genuinely change
   * shape. It goes through solveWith like every other edit, which means it
   * lands in the change log with a reason and can be undone.
   */
  const addSkill = async () => {
    const skill = draftSkill.trim();
    if (!skill || addingSkill) return;
    if (state.targetSkills.some((s) => s.toLowerCase() === skill.toLowerCase())) {
      setDraftSkill("");
      return;
    }
    setAddingSkill(true);
    try {
      const pool = [...courses.values()]
        .filter((c) => c.id.startsWith(`${state.schoolId}:`) && !state.student.completed.includes(c.id))
        .map((c) => c.id);

      // The same two pass read the survey uses, scoped to the one thing being
      // added. This used to call the old endpoint, which had no first pass and
      // read all hundred and thirty nine descriptions in full for a single
      // word, so adding a keyword took as long as building the entire plan.
      // The question for an added keyword is not "does this help with the
      // posting", it is "does this teach the thing I asked for". Sending the
      // original posting as context made the model judge cryptography courses
      // against a backend internship that never mentions cryptography, and it
      // correctly answered no to all of them, which looked like the catalog
      // having nothing.
      // The facet's quote has to be a real sentence of the text being judged
      // against, because both quotes are verified before anything is kept. The
      // first attempt used a label that appeared nowhere in the request, so
      // every genuine cryptography course was thrown out for failing to prove
      // that cryptography was asked for.
      const asked = `You asked to learn ${skill}.`;
      const ask = `${asked} Judge each course only on whether it would teach ${skill}. `
        + `Ignore every other consideration, including any job.`;
      const newFacet = { name: skill, quote: asked, weight: "supporting" };
      const rl = await fetch("/api/fit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jd: ask,
          schoolId: state.schoolId,
          courseIds: pool,
          facets: [newFacet],
          // One keyword does not need the whole catalog read in full. The first
          // pass narrows it, and a dozen careful reads is plenty to find the
          // courses that genuinely teach one subject.
          deepCap: 14,
        }),
      }).then((r) => r.json()).catch(() => ({ ok: false }));
      if (rl?.costUsd) noteSpend(rl.costUsd);

      const relevance = { ...state.relevance };
      const found: string[] = [];
      if (rl?.ok) {
        for (const f of (rl.fits ?? []) as { courseId: string; courseQuote: string; strength: string; title: string }[]) {
          relevance[f.courseId] = [
            ...(relevance[f.courseId] ?? []).filter((x) => x.skill !== skill),
            { skill, evidence: f.courseQuote, strength: f.strength as "central" | "useful" | "tangential" },
          ];
          found.push(f.title);
        }
      }

      const next = {
        ...state,
        targetSkills: [...state.targetSkills, skill],
        customSkills: [...(state.customSkills ?? []), skill],
        facets: [...(state.facets ?? []), newFacet],
        relevance,
      };
      await solveWith(next, undefined, {
        action: `Added "${skill}"`,
        reason: found.length
          ? `${found.length} course${found.length === 1 ? "" : "s"} in this catalog turned out to do it: ${found.slice(0, 4).join(", ")}${found.length > 4 ? `, and ${found.length - 4} more` : ""}. The whole plan was worked out again with it counted alongside everything the posting already asked for.`
          : `Nothing in this catalog does it, so the plan could not change. It is listed as something coursework will not give you, which is the honest answer.`,
      });
      setDraftSkill("");
      setOpenQuote(skill);
    } finally {
      setAddingSkill(false);
    }
  };

  /**
   * Take back something you added.
   *
   * You could add a requirement and never remove it, so a typo or a change of
   * mind was permanent for the session. Nothing needs re-reading here: the
   * catalog evidence for it is simply dropped and the plan worked out again.
   */
  const removeSkill = async (skill: string) => {
    const relevance: typeof state.relevance = {};
    for (const [id, hits] of Object.entries(state.relevance ?? {})) {
      const kept = hits.filter((h) => h.skill !== skill);
      if (kept.length) relevance[id] = kept;
    }
    await solveWith(
      {
        ...state,
        targetSkills: state.targetSkills.filter((s) => s !== skill),
        customSkills: (state.customSkills ?? []).filter((s) => s !== skill),
        facets: (state.facets ?? []).filter((f) => f.name !== skill),
        relevance,
      },
      undefined,
      {
        action: `Removed "${skill}"`,
        reason: "You added this one and then took it back, so the plan was worked out again without it.",
      },
    );
    setOpenQuote(null);
  };

  const plan = result?.plans?.[state.activePlan] ?? result?.plans?.[0] ?? null;

  // The prerequisite list has to say whether each course it names is in this
  // plan, already finished, or neither, so both sets are derived once here
  // rather than rebuilt inside every card.
  const plannedIds = useMemo(
    () => new Set(plan?.placements.map((p) => p.courseId) ?? []),
    [plan],
  );
  const completedIds = useMemo(
    () => new Set(state.student.completed),
    [state.student.completed],
  );

  // A, B and C were rendered identically, so changing option looked like
  // nothing happened. Each carries its own accent through the whole page.
  const planTint = ["plan-a", "plan-b", "plan-c"][state.activePlan % 3];
  const names = useMemo(
    () => semesterNames(state.student.startTerm as Term, state.student.horizonTerms),
    [state.student.startTerm, state.student.horizonTerms],
  );

  // The write-up now starts in the store the moment a solve returns, which is
  // while the loader is still on screen. By the time this page mounts it has
  // usually already been written, so there is nothing to wait for here.

  if (!result) return <Empty />;

  // A plan restored from the session is a list of course ids. Until the catalog
  // arrives there is nothing to turn them into, and drawing it half way was the
  // difference between a page and a blank screen after every reload.
  if (result.ok && courses.size === 0) {
    return (
      <div className="mx-auto flex max-w-[600px] items-center gap-3 px-6 py-28 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> loading your plan
      </div>
    );
  }

  if (!result.ok || !plan) {
    const inf = result.infeasibility;
    return (
      <div className="mx-auto max-w-[820px] px-6 py-16">
        <div className="rounded-3xl border border-border bg-card p-8 glow">
          <span className="label text-[11px]" style={{ color: inf?.timedOut ? "var(--amber)" : "var(--clay)" }}>
            {inf?.timedOut ? "Took too long" : "No plan fits"}
          </span>
          <h1 className="mt-3 font-display text-3xl font-semibold leading-tight">
            {inf?.message ?? "No plan fits these rules."}
          </h1>
          {!!inf?.blockingBuckets.length && (
            <ul className="mt-6 space-y-3">
              {inf.blockingBuckets.map((b) => (
                <li key={b.bucketId} className="rounded-2xl bg-[var(--blue-soft)] p-5">
                  <p className="font-semibold">{b.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{b.detail}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-7 flex flex-wrap gap-3">
            {inf?.timedOut ? (
              // Offering more semesters here would be nonsense: nothing said the
              // horizon was the problem, only that the clock ran out.
              <button
                onClick={() => void runSolve({})}
                className="rounded-full bg-[var(--blue)] px-6 py-3 text-white glow-hover"
              >
                Try again
              </button>
            ) : (
              <button
                onClick={() => void runSolve({ student: { ...state.student, horizonTerms: Math.min(8, state.student.horizonTerms + 1) } })}
                className="rounded-full bg-[var(--blue)] px-6 py-3 text-white glow-hover"
              >
                Try {state.student.horizonTerms + 1} semesters
              </button>
            )}
            <Link href="/" className="rounded-full border border-border px-6 py-3 transition-colors hover:bg-[var(--blue-soft)]">
              Start over
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const termKinds = termKindsFor(state.student.startTerm as Term, plan.termCredits.length);
  // The degree does not name the free electives, so the solver cannot schedule
  // them. It can still be planned: this commits a concrete course to every open
  // credit, job relevant ones first, and guarantees nothing is used twice.
  // The reader's consideration order for this posting, by course id. This is
  // the metric behind every "which of these" list on the page: matched courses
  // carry the judge's rank, and courses considered but not matched carry their
  // shortlist position, so nothing below is ordered by taste alone.
  const orderedCodes = (state.considerationAll?.length
    ? state.considerationAll.map((x) => x.code)
    : state.shortlist ?? []);
  const codeToId = new Map([...courses.values()].map((c) => [c.code, c.id]));
  const consideration: Record<string, number> = Object.fromEntries(
    orderedCodes.map((code, i) => [codeToId.get(code), i] as const).filter(([id]) => id),
  ) as Record<string, number>;
  /** Why a course sits where it sits in the order, by course id. */
  const considerationWhy = new Map(
    (state.considerationAll ?? []).map((x) => [codeToId.get(x.code) ?? x.code, x.why]),
  );
  const shortlistCount = (state.shortlist ?? []).length;

  const filledByTerm = new Map(
    fillOpenCredits({
      catalog: school?.courses ?? [],
      plan,
      completed: state.student.completed,
      excluded: state.student.excluded,
      termKinds,
      relevance: state.relevance,
      targetSkills: state.targetSkills,
      shortlistRank: consideration,
      shortlistCount,
    }).map((f) => [f.term, f]),
  );

  const v = program ? verifyPlan(plan, program, courses, state.student.completed, termKinds) : null;

  // The always-on health readout. Manual edits change placements, placements
  // change these numbers, same render. No dialog to open, no solver to wait
  // for: the sidebar is the monitor and the board carries the lights.
  const placedIdsLive = new Set(plan.placements.map((p) => p.courseId));
  const doneSetLive = new Set(state.student.completed);
  // The solver already worked out which requirement each course counts
  // toward, by a real assignment that lets one course serve only where it
  // is actually needed. Recomputing "is this bucket met" independently, from
  // eligible-list membership alone, ignores that assignment and disagrees
  // with it: a course shared between two requirements can look like it
  // satisfies both, when the solver in fact used it for only one, or the
  // credits/courses accounting genuinely differs from a plain membership
  // count. plan.buckets IS the solver's real answer. Reading it directly is
  // what the "What the degree needs" panel does; this panel now agrees with
  // it instead of publishing a second, wrong opinion next to the true one.
  const bucketEligible = new Map((program?.buckets ?? []).map((b) => [b.id, new Set(b.eligible)]));
  const unmetLive = plan.buckets
    .filter((b) => !b.satisfied)
    .map((b) => ({
      id: b.bucketId, label: b.label,
      gap: Math.max(0, b.need - b.fromCompleted - b.fromPlan),
      unit: b.unit === "courses" ? "course" : "credit",
      eligible: bucketEligible.get(b.bucketId) ?? new Set<string>(),
    }));
  // "Every requirement of the degree is satisfied" fails for exactly the
  // reason each unmet requirement below already states, one row per
  // requirement, each with courses that would close it. Keeping both made one
  // problem read as two: a plan short a single data structures course counted
  // "3 open" for two things. The per-requirement rows are the ones worth
  // showing, because they are the ones that can be acted on. The rule itself
  // still appears, ticked or crossed, in the full "Rules checked" list.
  const failedLive = (v?.checks ?? []).filter((c) => !c.passed && c.id !== "requirements");
  // Courses committed to the open credits live in the filler, not in the
  // solver's placements, so an offender sitting there had no term and its
  // semester never lit up.
  const termOfLive = new Map<string, number>([
    ...plan.placements.map((p) => [p.courseId, p.term] as const),
    ...[...filledByTerm.entries()].flatMap(([t, f]) => f.picks.map((pk) => [pk.courseId, t] as const)),
  ]);
  /**
   * A problem that cannot be acted on where it is read is a problem the
   * student has to go hunting for. For every unmet requirement, work out the
   * courses that would actually close it and the earliest term each could sit
   * in, so the panel can offer the fix rather than describe where to look.
   */
  /**
   * "Move it" answers a mis-ordering. It says nothing when the prerequisite
   * is not merely early enough, but missing from the plan entirely, which is
   * exactly the COMS W3261-needs-W3203 case: moving W3261 later never adds
   * W3203. This walks the same prereq tree the solver itself checks
   * (prereqSatisfied, imported, not re-implemented) to name the one course
   * still missing, so the fix can be offered directly instead of left as an
   * exercise.
   */
  const excludedSetLive = new Set(state.student.excluded);
  /**
   * Where a course can actually go, if it has to land before `beforeTerm`.
   *
   * "Offered in that season" is not enough, and assuming it was produced a fix
   * that broke the plan a second way: told that COMS W3157 was missing its
   * Data Structures, the panel offered to put Data Structures in the very
   * first semester -- in front of the Programming in Java that Data Structures
   * itself depends on. Pressing exactly what the app said to press left it
   * still complaining, now about the course it had just added. A term only
   * counts if the course's own prerequisites are already behind it.
   */
  const earliestLegalTermFor = (course: Course, beforeTerm: number): number => {
    for (let k = 0; k < beforeTerm; k++) {
      if (!course.termsOffered.includes(termKinds[k])) continue;
      const have = new Set<string>(doneSetLive);
      for (const [id, t] of termOfLive) if (t < k) have.add(id);
      if (prereqSatisfied(course.prereq, have)) return k;
    }
    return -1;
  };
  const missingPrereqFor = (courseId: string): { course: Course; term: number } | null => {
    const c = courses.get(courseId);
    if (!c?.prereq) return null;
    const have = new Set([...placedIdsLive, ...doneSetLive]);
    const find = (node: PrereqNode | null): string | null => {
      if (!node) return null;
      if (node.op === "COURSE") return have.has(node.courseId) ? null : node.courseId;
      if (node.op === "UNVERIFIABLE") return null;
      if (node.op === "AND") { for (const ch of node.children) { const m = find(ch); if (m) return m; } return null; }
      if (node.op === "OR") {
        if (node.children.some((ch) => prereqSatisfied(ch, have))) return null;
        for (const ch of node.children) { const m = find(ch); if (m) return m; }
        return null;
      }
      return null;
    };
    const missingId = find(c.prereq);
    // A course the student excluded on purpose is not a fix to offer back —
    // "Add it" would silently override that choice. Report nothing rather
    // than a button that undoes a decision the student already made.
    if (missingId && excludedSetLive.has(missingId)) return null;
    const missing = missingId ? courses.get(missingId) : null;
    if (!missing) return null;
    const here = termOfLive.get(courseId) ?? 0;
    const term = earliestLegalTermFor(missing, here);
    return term >= 0 ? { course: missing, term } : null;
  };
  /** Same walk, but reports specifically when the reason is an exclusion, and
   *  where the excluded course would go if it came back — so the banner can
   *  offer the fix that actually resolves it instead of only the destructive
   *  one. A course excluded by hand is still the thing the plan needs. */
  const excludedPrereqFor = (courseId: string): { course: Course; term: number } | null => {
    const c = courses.get(courseId);
    if (!c?.prereq) return null;
    const have = new Set([...placedIdsLive, ...doneSetLive]);
    const find = (node: PrereqNode | null): string | null => {
      if (!node) return null;
      if (node.op === "COURSE") return have.has(node.courseId) ? null : node.courseId;
      if (node.op === "UNVERIFIABLE") return null;
      if (node.op === "AND") { for (const ch of node.children) { const m = find(ch); if (m) return m; } return null; }
      if (node.op === "OR") {
        if (node.children.some((ch) => prereqSatisfied(ch, have))) return null;
        for (const ch of node.children) { const m = find(ch); if (m) return m; }
        return null;
      }
      return null;
    };
    const missingId = find(c.prereq);
    if (!missingId || !excludedSetLive.has(missingId)) return null;
    const missing = courses.get(missingId);
    if (!missing) return null;
    const here = termOfLive.get(courseId) ?? 0;
    // Where it would land if it came back: the first semester before the
    // course that needs it that runs it AND has its own prerequisites behind it.
    const term = earliestLegalTermFor(missing, here);
    return term >= 0 ? { course: missing, term } : null;
  };

  /**
   * The third shape a prerequisite failure takes, and the one that had no
   * words at all: the course it needs IS in the plan, just not early enough.
   * Nothing can be added and nothing un-excluded to fix that — one of the two
   * has to move — so the only useful thing to say is which two, and where
   * each one currently sits. "Move it, or open it on the board" was the whole
   * of what this used to offer.
   */
  const latePrereqFor = (courseId: string): { course: Course; term: number } | null => {
    const c = courses.get(courseId);
    const here = termOfLive.get(courseId);
    if (!c?.prereq || here == null) return null;
    const before = new Set<string>(doneSetLive);
    for (const [id, t] of termOfLive) if (t < here) before.add(id);
    if (prereqSatisfied(c.prereq, before)) return null;
    const find = (node: PrereqNode | null): string | null => {
      if (!node) return null;
      if (node.op === "COURSE") {
        const t = termOfLive.get(node.courseId);
        return t != null && t >= here ? node.courseId : null;
      }
      if (node.op === "UNVERIFIABLE") return null;
      if (node.op === "AND") { for (const ch of node.children) { const m = find(ch); if (m) return m; } return null; }
      if (node.op === "OR") {
        if (node.children.some((ch) => prereqSatisfied(ch, before))) return null;
        for (const ch of node.children) { const m = find(ch); if (m) return m; }
        return null;
      }
      return null;
    };
    const lateId = find(c.prereq);
    const late = lateId ? courses.get(lateId) : null;
    const term = late ? termOfLive.get(late.id) : null;
    return late && term != null ? { course: late, term } : null;
  };

  const suggestFor = (eligible: Set<string>) => {
    const takenOrPlanned = new Set([...placedIdsLive, ...doneSetLive]);
    return (school?.courses ?? [])
      .filter((c) => eligible.has(c.id) && !takenOrPlanned.has(c.id))
      .map((c) => {
        // The first term this course runs in AND has its own prerequisites
        // behind it. Offering the first term it merely runs in is how a fix
        // for one requirement arrived already breaking another.
        const term = earliestLegalTermFor(c, termKinds.length);
        const rank = consideration[c.id];
        return { course: c, term, rank };
      })
      .filter((x) => x.term >= 0)
      .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.course.code.localeCompare(b.course.code))
      .slice(0, 4);
  };

  // Two different things light a semester up, and they are not the same news.
  // A semester can CONTAIN something broken: a course whose prerequisite is no
  // longer in front of it, a term over the credit cap. Or it can simply be a
  // place a missing requirement could be satisfied, with nothing whatever
  // wrong inside it. Outlining both in red is why removing one course looked
  // like it broke five semesters at once — four were holding a course that had
  // just lost its prerequisite, and the fifth was only the earliest term a
  // replacement runs in. They are now separated, and each semester says which
  // it is and why.
  const brokenTerms = new Set<number>();
  for (const c of failedLive) for (const id of c.offenders) { const t = termOfLive.get(id); if (t != null) brokenTerms.add(t); }
  if (failedLive.some((c) => c.id === "full-time")) {
    plan.termCredits.forEach((cr, t) => {
      if (cr + (plan.openCreditsNeeded?.[t] ?? 0) < (program?.minCreditsPerTerm ?? 0)) brokenTerms.add(t);
    });
  }
  // A shortfall is an absence, and an absence has no course to point at, so
  // these are the semesters that could HOST the missing thing — which is where
  // the fix has to happen. Computed once: suggestFor walks the whole catalog.
  const unmetPicks = unmetLive.map((r) => ({ ...r, picks: suggestFor(r.eligible) }));
  const fixHereTerms = new Set<number>(unmetPicks.flatMap((r) => r.picks.map((p) => p.term)));
  // Nothing anywhere to point at and a removal to blame: mark where it happened.
  if (unmetLive.length && !brokenTerms.size && !fixHereTerms.size && lastRemovedTerm != null) brokenTerms.add(lastRemovedTerm);
  const problemTerms = new Set<number>([...brokenTerms, ...fixHereTerms]);
  const healthy = !failedLive.length && !unmetLive.length;


  /**
   * Every reason ONE semester is flagged, each with the action that settles it.
   *
   * The banner used to show a single headline picked from whichever failure it
   * found first, so a semester with three separate problems announced one, and
   * a semester with nothing wrong in it announced someone else's problem. When
   * removing a single course flags five semesters, the only useful answer to
   * "why this one" is the whole list for that one, and every entry saying
   * which course, what it is missing, and what to press.
   */
  type TermReason = {
    key: string;
    broken: boolean;
    headline: string;
    detail?: string;
    actions: { label: string; primary?: boolean; onClick: () => void }[];
  };
  const reasonsForTerm = (t: number): TermReason[] => {
    const out: TermReason[] = [];
    const prereqOffenders = failedLive
      .filter((c) => c.id === "prereqs")
      .flatMap((c) => c.offenders)
      .filter((id) => termOfLive.get(id) === t);

    for (const id of prereqOffenders) {
      const code = courses.get(id)?.code ?? id;
      const missing = missingPrereqFor(id);
      if (missing) {
        out.push({
          key: `missing:${id}`, broken: true,
          headline: `${code} needs ${missing.course.code} first, and it is not in the plan.`,
          detail: `${missing.course.title} runs in ${missing.course.termsOffered.join("/")}, so it can go in ${names[missing.term]}, before this.`,
          actions: [{
            label: `Add ${missing.course.code} to ${names[missing.term]}`, primary: true,
            onClick: () => addCourse(missing.course.id, missing.term, missing.course.code),
          }],
        });
        continue;
      }
      const gone = excludedPrereqFor(id);
      if (gone) {
        const requiredBy = (program?.buckets ?? []).find((b) => b.eligible.includes(gone.course.id)
          && (b.needCourses ?? 0) >= b.eligible.length)?.label;
        out.push({
          key: `excluded:${id}`, broken: true,
          headline: `${code} needs ${gone.course.code}, and you took ${gone.course.code} out of the plan.`,
          detail: requiredBy
            ? `${requiredBy} requires ${gone.course.code} too, so the degree cannot finish without it.`
            : `Putting it back in ${names[gone.term]} puts it in front of ${code} again.`,
          actions: [
            { label: `Put ${gone.course.code} back in ${names[gone.term]}`, primary: true,
              onClick: () => addCourse(gone.course.id, gone.term, gone.course.code) },
            { label: `or drop ${code}`, onClick: () => removeCourse(id, code) },
          ],
        });
        continue;
      }
      const late = latePrereqFor(id);
      if (late) {
        const co = courses.get(id);
        const legal = names
          .map((n, k) => ({ n, k }))
          .filter(({ k }) => k > late.term && co?.termsOffered.includes(termKinds[k]));
        out.push({
          key: `late:${id}`, broken: true,
          headline: `${code} is in ${names[t]}, but ${late.course.code}, which it needs first, is in ${names[late.term]}.`,
          detail: `One of the two has to move. ${code} runs in ${co?.termsOffered.join("/") ?? ""}.`,
          actions: legal.slice(0, 3).map(({ n, k }) => ({
            label: `Move ${code} to ${n}`, primary: true, onClick: () => moveCourse(id, k, code),
          })),
        });
        continue;
      }
      out.push({
        key: `prereq:${id}`, broken: true,
        headline: `${code} does not have its prerequisites met where it sits.`,
        actions: [{ label: "Show me", onClick: () => jumpToCourse(t, id) }],
      });
    }

    // Any other rule that failed with something in THIS semester: wrong term
    // for the course, over the credit cap, counted twice, past the horizon.
    for (const c of failedLive) {
      if (c.id === "prereqs" || c.id === "full-time") continue;
      const here = c.offenders.filter((id) => termOfLive.get(id) === t);
      if (!here.length) continue;
      out.push({
        key: `rule:${c.id}:${t}`, broken: true,
        headline: c.problem,
        detail: `In this semester: ${here.map((id) => courses.get(id)?.code ?? id).join(", ")}. ${c.detail}`,
        actions: here.slice(0, 1).map((id) => ({
          label: `Show me ${courses.get(id)?.code ?? id}`, onClick: () => jumpToCourse(t, id),
        })),
      });
    }

    if (failedLive.some((c) => c.id === "full-time")
        && (plan.termCredits[t] ?? 0) + (plan.openCreditsNeeded?.[t] ?? 0) < (program?.minCreditsPerTerm ?? 0)) {
      out.push({
        key: `full-time:${t}`, broken: true,
        headline: `This semester is below the ${program?.minCreditsPerTerm} credit full-time minimum.`,
        detail: `It has ${(plan.termCredits[t] ?? 0) + (plan.openCreditsNeeded?.[t] ?? 0)} credits once your other classes are counted.`,
        actions: [{ label: "Add a course here", onClick: () => setAddHere(t) }],
      });
    }

    // Nothing wrong here — this is somewhere a missing requirement could go.
    for (const r of unmetPicks) {
      const picks = r.picks.filter((p) => p.term === t);
      if (!picks.length) continue;
      out.push({
        key: `unmet:${r.id}:${t}`, broken: false,
        headline: `${r.label} is ${r.gap} ${r.unit}${r.gap === 1 ? "" : "s"} short.`,
        detail: `Nothing in ${names[t]} is wrong. It is flagged because this is the earliest semester a course that closes ${r.label.toLowerCase()} runs in.`,
        actions: picks.slice(0, 3).map((p) => ({
          label: `Add ${p.course.code} here`, primary: true,
          onClick: () => addCourse(p.course.id, p.term, p.course.code),
        })),
      });
    }
    return out;
  };

  const slotByCourse = new Map(plan.slotChoices.map((s) => [s.chosen, s]));
  // "Not covered" was hiding two completely different answers behind one
  // outlined chip. Either this catalog teaches the thing and the plan simply
  // has no room for it, which is a choice you might want to revisit, or nothing
  // here teaches it at all, which is the end of the conversation. Only the
  // second one is bad news, so they stopped looking identical.
  const teachableSomewhere = new Map<string, { courseId: string; code: string; title: string; quote: string }[]>();
  for (const [courseId, hits] of Object.entries(state.relevance ?? {})) {
    const c = courses.get(courseId);
    if (!c) continue;
    for (const h of hits) {
      const list = teachableSomewhere.get(h.skill) ?? [];
      list.push({ courseId, code: c.code, title: c.title, quote: h.evidence });
      teachableSomewhere.set(h.skill, list);
    }
  }

  const cov = result.coverage;

  /**
   * A part of the job answered by a free elective is still answered.
   *
   * `plan.skillsCovered` is the solver's bitmask over the courses it chose for
   * the degree's named requirements. The filler runs afterwards and commits
   * real courses to the open credits, and the board draws those exactly like
   * any other course. Reading coverage off the bitmask alone told a student
   * that nothing here does a thing while the course doing it sat two rows below
   * in their own timetable.
   */
  const coveredByFiller = new Set(
    [...filledByTerm.values()].flatMap((f) => f.picks).flatMap((o) => o.teaches),
  );
  const answered = (name: string) =>
    plan.skillsCovered.includes(name) || coveredByFiller.has(name);

  // Same reason: a heading saying no class teaches this must not name something
  // a class in the plan is teaching.
  const cannot = (cov?.courseworkCannotGive ?? []).filter((c) => !answered(c.skill));

  return (
    <div className={`${planTint} mx-auto max-w-[1500px] px-4 py-5 lg:px-8 lg:py-6`}>
      {(solving || reflowing) && (
        <div className="fixed left-1/2 top-14 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-white px-4 py-2 text-xs font-medium shadow-lg">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
          Rebuilding the plan around your change
        </div>
      )}
      {/* What this plan is for: the school, the degree, the job. Used to be
          its own bar; three bars deep, the page started below the fold. */}
      <p className="mb-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{school?.shortName ?? school?.name}</span>
        {program && <><span aria-hidden>·</span><span>{program.name}</span></>}
        {state.roleSummary && <><span aria-hidden>·</span><span className="min-w-0">planning for: {state.roleSummary}</span></>}
        <Link href="/start" className="underline underline-offset-2 hover:text-foreground" title="Change your school, degree or the job">change</Link>
      </p>
      {/* ── can this degree even reach this job ───────────────────────────── */}
      {(() => {
        const ev = state.skillEvidence ?? {};
        const facets = state.facets ?? [];
        // Measured against the parts of the work, because that is what the plan
        // was built against. Reading it off the requirement list instead meant
        // comparing two vocabularies that never overlap, so every job looked
        // unreachable and a computer science degree was told it was the wrong
        // preparation for a backend engineering internship.
        const core = facets.filter((f) => f.weight === "core");
        const coveredCore = core.filter((f) => answered(f.name)).length;
        const coveredAll = facets.filter((f) => answered(f.name)).length;
        const gatedNames = Object.keys(ev).filter((k) => ev[k]?.kind === "credential");

        // Only two things are worth interrupting for. A credential no degree
        // issues, which is a hard stop whatever else the plan does. Or a plan
        // that misses most of what the job is actually made of.
        const barred = gatedNames.length > 0;
        const thin = core.length > 0 && coveredCore / core.length < 0.5;
        if (!barred && !thin) return null;

        return (
          <div className="fade-up mb-3 rounded-xl border-2 p-3 lg:p-4"
               style={{ borderColor: "var(--amber)", background: "color-mix(in oklab, var(--amber) 7%, transparent)" }}>
            <div className="flex items-start gap-2.5">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--amber)" }} />
              <div className="min-w-0 text-sm leading-relaxed">
                <p className="font-semibold">
                  {barred
                    ? `This posting asks for something no degree issues.`
                    : `This plan reaches ${coveredCore} of the ${core.length} things this job is mainly made of.`}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {barred && (
                    <>
                      It wants {gatedNames.slice(0, 3).join(", ")}
                      {gatedNames.length > 3 ? ` and ${gatedNames.length - 3} more` : ""}.
                      Your plan still covers {coveredAll} of the {facets.length} parts of the work,
                      which is the part a degree can do.{" "}
                    </>
                  )}
                  {!barred && "The rest you would pick up through a project, an internship, or the first year of the job."}
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── the brief: what the job wants, then what this plan answers ─────── */}
      <header className="rounded-2xl border plan-edge bg-card glow overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b plan-edge plan-wash px-4 py-2 lg:px-5">
          <div className="min-w-0">
            <h1 className="font-display text-sm font-semibold leading-tight">Your course path</h1>
            <p className="text-xs text-muted-foreground">
              {plan.placements.length} courses across {plan.termCredits.length} semesters.{" "}
              <strong className="plan-accent">
                {plan.placements.filter((p) => p.covers.length > 0).length}
              </strong>{" "}
              picked for this job, answering{" "}
              <strong className="plan-accent">{plan.skillsCovered.length}</strong> of the{" "}
              {state.targetSkills.filter((k) => (state.skillEvidence?.[k]?.kind ?? "teachable") !== "credential").length}{" "}
              a course could answer.
            </p>
          </div>
          <TakeIt plan={plan} courses={courses} names={names} fill={filledByTerm} />
          <div className="flex items-center gap-2">
            {solving && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> working it out
              </span>
            )}
            <button
              onClick={undo} disabled={!canUndo}
              className="flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-sm transition-colors hover:bg-[var(--blue-soft)] disabled:opacity-35"
              title="Undo the last change"
            >
              <Undo2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Undo</span>
            </button>
            <button
              onClick={redo} disabled={!canRedo}
              className="flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-sm transition-colors hover:bg-[var(--blue-soft)] disabled:opacity-35"
              title="Redo"
            >
              <Redo2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Redo</span>
            </button>
          </div>
        </div>

        {/* The details, on demand.
            This block is the posting's facets, the add a skill box, the write
            up and the alumni, and open it filled the whole first screen. What
            a student checks daily is the verdict line and the timetable, so
            those come first and this opens when the why is wanted. */}
        <details className="group border-t plan-edge">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground lg:px-5">
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden />
            What this job asks for, what the plan does about it, and graduates you could ask
          </summary>
        <div className={`grid items-start gap-0 ${summary || summaryBusy ? "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]" : ""}`}>
          {/* what the posting asks for, in the posting's own words, with the
              posting's own sentence behind every one of them */}
          <div className="surface-sunken h-full max-h-none overflow-visible border-b border-border p-3.5 lg:border-b-0 lg:border-r lg:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="label text-muted-foreground">What this job asks for</p>
              <span className="text-xs text-muted-foreground">click any one to see the line it came from</span>
            </div>
            {state.roleSummary && (
              <p className="mt-1.5 text-sm italic text-muted-foreground">{state.roleSummary}</p>
            )}

            {/* The posting itself. Every claim on this page is measured against
                it, so it should be readable here rather than in another tab. */}
            {state.jd.trim() && (
              <details className="mt-2 rounded-lg border border-border bg-white">
                <summary className="cursor-pointer list-none px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronDown className="h-3 w-3 transition-transform" />
                    Read the posting this was built from ({state.jd.trim().split(/\s+/).length} words)
                  </span>
                </summary>
                <div className="max-h-[40vh] overflow-y-auto border-t border-border px-3 py-2.5 rail-scroll">
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {state.jd.trim()}
                  </p>
                </div>
              </details>
            )}

            {/*
              The parts of the work, which is what the plan is built against.
              These were a stacked list of full width rows, which for six parts
              was most of a screen before you reached the plan itself. They are
              the index, not the content, so they read as tags now and the one
              you open explains itself underneath the whole set.
            */}
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {(state.facets ?? []).map((f) => {
                const got = answered(f.name);
                const elsewhere = !got ? (teachableSomewhere.get(f.name) ?? []) : [];
                const on = openQuote === f.name;
                return (
                  <li key={f.name} className="flex items-center">
                    <button
                      onClick={() => setOpenQuote(on ? null : f.name)}
                      aria-pressed={on}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-all ${
                        got ? "border-transparent font-medium text-white"
                          : elsewhere.length ? "border-dashed bg-white"
                          : "border-border bg-white text-muted-foreground"
                      } ${on ? "ring-2 ring-offset-1" : ""}`}
                      style={{
                        ...(got ? { background: "var(--accent, var(--blue))" }
                          : elsewhere.length ? { borderColor: "var(--accent, var(--blue))", color: "var(--accent, var(--blue))" }
                          : {}),
                        ...(on ? { boxShadow: "0 0 0 2px var(--accent, var(--blue))" } : {}),
                      }}
                    >
                      {f.name}
                      {f.weight === "core" && <span className="ml-1 opacity-60">•</span>}
                    </button>
                    {(state.customSkills ?? []).includes(f.name) && (
                      <button
                        onClick={() => void removeSkill(f.name)}
                        title={`Remove ${f.name}`}
                        aria-label={`Remove ${f.name}`}
                        className="-ml-1 rounded-full px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-[var(--clay)]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* one panel, for whichever tag is open */}
            {(() => {
              const f = (state.facets ?? []).find((x) => x.name === openQuote);
              if (!f) return (
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Filled means a course in your plan does it. Dashed means the school teaches it but the
                  plan had no room. Plain means nothing here does. A dot marks the main parts of the job.
                  Click any one to see the line of your posting it came from.
                </p>
              );
              const got = answered(f.name);
              const elsewhere = !got ? (teachableSomewhere.get(f.name) ?? []) : [];
              // Counted only the solver's placements and ignored the free
              // electives, so the panel said "1 course does this" while the
              // chart above it plainly showed two.
              const inPlan = [
                ...plan.placements
                  .filter((p) => p.covers.some((c) => c.skill === f.name))
                  .map((p) => courses.get(p.courseId)?.title)
                  .filter(Boolean),
                ...[...filledByTerm.values()]
                  .flatMap((ft) => ft.picks)
                  .filter((o) => o.teaches.includes(f.name))
                  .map((o) => o.title),
              ];
              return (
                <div className="fade-up mt-2 rounded-lg border border-border bg-white p-2.5">
                  <p className="text-[11px] text-muted-foreground">
                    {f.weight === "core" ? "A main part of this job." : "A supporting part of this job."}{" "}
                    Your posting said:
                  </p>
                  <p className="mt-1 border-l-2 pl-2.5 text-sm italic leading-snug"
                     style={{ borderColor: "var(--accent, var(--blue))" }}>
                    &ldquo;{f.quote}&rdquo;
                  </p>
                  {got ? (
                    <p className="mt-2 text-[11px]">
                      <span className="font-medium plan-accent">
                        {inPlan.length} course{inPlan.length === 1 ? "" : "s"} in your plan {inPlan.length === 1 ? "does" : "do"} this:
                      </span>{" "}
                      {inPlan.join(", ")}
                    </p>
                  ) : elsewhere.length ? (
                    <p className="mt-2 text-[11px]">
                      <span className="font-medium plan-accent">The school teaches it, the plan had no room:</span>{" "}
                      {elsewhere.slice(0, 3).map((e) => e.title).join(", ")}
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Nothing in this catalog does this part of the job.
                    </p>
                  )}
                  {(() => {
                    // The choice the page never offered. Every course the
                    // reader matched to this part, in its ranking order, each
                    // one a button: jump to it if it is already planned, add
                    // it by name if it is not. The plan chose for you before;
                    // now it shows its shortlist and lets you overrule it.
                    const ranked = Object.entries(state.relevance ?? {})
                      .flatMap(([cid, hits]) => hits
                        .filter((h) => h.skill === f.name)
                        .map((h) => ({ cid, why: h.why, strength: h.strength ?? "useful" })))
                      .sort((a, b) =>
                        ["central", "useful", "tangential"].indexOf(a.strength) -
                        ["central", "useful", "tangential"].indexOf(b.strength))
                      .slice(0, 5);
                    if (ranked.length < 2) return null;
                    return (
                      <div className="mt-2 border-t border-border pt-1.5">
                        <p className="text-[10px] font-medium text-muted-foreground">
                          Every course that teaches this, in the reader&rsquo;s order. Your call.
                        </p>
                        <ul className="mt-1 space-y-1">
                          {ranked.map((r, i) => {
                            const c = courses.get(r.cid);
                            if (!c) return null;
                            const planned = plannedIds.has(r.cid);
                            return (
                              <li key={r.cid} className="flex items-start gap-1.5 text-[11px]">
                                <span className="tabular shrink-0 text-muted-foreground">{i + 1}.</span>
                                <span className="min-w-0 flex-1">
                                  <span className="font-medium">{c.title}</span>{" "}
                                  <span className="code text-[10px]">{c.code}</span>
                                  {r.why && <span className="block text-muted-foreground">{r.why}</span>}
                                </span>
                                {planned ? (
                                  <button onClick={() => jumpToCourse(0, r.cid)}
                                          className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] hover:bg-[var(--blue-soft)]">
                                    in your plan
                                  </button>
                                ) : (
                                  <button onClick={() => keepInPlan(r.cid, c.title)}
                                          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                                          style={{ background: "var(--blue)" }}>
                                    Add instead
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* things the posting wants that no timetable can supply */}
            {(() => {
              const ev = state.skillEvidence ?? {};
              // Only credentials belong under "no course can give you".
              //
              // This used to list everything that was not marked teachable,
              // which put Java, Python and C++ in it while two Java courses sat
              // in the plan below. "Wants it practised" is not "cannot be
              // taught", and collapsing the two made the page contradict
              // itself in the same screenful.
              // A posting asking for "a degree in computer science" is not
              // telling this student anything: they are enrolled on one. Only
              // credentials the plan cannot lead to are worth the alarm.
              const ownDegree = `${program?.name ?? ""} ${school?.name ?? ""}`.toLowerCase();
              const alreadyOnIt = (k: string) => {
                const w = k.toLowerCase().replace(/\b(a|an|the|degree|in|bachelors?|pursuing)\b/g, " ").trim();
                return w.length > 3 && ownDegree.includes(w.split(/\s+/)[0]);
              };
              const gated = Object.keys(ev)
                .filter((k) => ev[k]?.kind === "credential")
                .filter((k) => !alreadyOnIt(k));
              const practised = Object.keys(ev).filter((k) => ev[k]?.kind === "experience");
              const hard = [...gated, ...practised];
              if (!hard.length) return null;
              return (
                <details className="mt-3 rounded-lg border border-border bg-white">
                  <summary className="cursor-pointer list-none px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronDown className="h-3 w-3 transition-transform" />
                      {gated.length > 0 && `${gated.length} thing${gated.length === 1 ? "" : "s"} no course can give you`}
                    {gated.length > 0 && practised.length > 0 && ", and "}
                    {practised.length > 0 && `${practised.length} it wants practised, not just studied`}
                    </span>
                  </summary>
                  <ul className="border-t border-border px-2.5 py-2">
                    {gated.map((k) => (
                      <li key={k} className="mb-1.5 text-xs last:mb-0">
                        <span className="font-medium">{k}</span>{" "}
                        <span style={{ color: "var(--clay)" }}>no course issues this</span>
                      </li>
                    ))}
                    {practised.map((k) => (
                      <li key={k} className="mb-1.5 text-xs last:mb-0">
                        <span className="font-medium">{k}</span>{" "}
                        <span className="text-muted-foreground">
                          a class can teach the subject, this posting also wants it practised
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })()}

            {/* the student's own additions, which re-run the whole thing */}
            <form
              className="mt-4 border-t border-border pt-3"
              onSubmit={(e) => { e.preventDefault(); void addSkill(); }}
            >
              <label htmlFor="add-skill" className="label text-muted-foreground">
                Add something the posting missed
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="add-skill"
                  value={draftSkill}
                  onChange={(e) => setDraftSkill(e.target.value)}
                  placeholder="Robotics, Cryptography, Game theory…"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-white px-3 py-1.5 text-sm outline-none transition-colors focus:border-[var(--blue)]"
                />
                <button
                  type="submit"
                  disabled={!draftSkill.trim() || addingSkill}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--blue)] px-3 py-1.5 text-sm text-white transition-opacity disabled:opacity-40"
                >
                  {addingSkill ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  Add
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                The catalog gets read again for it, the plan is worked out from scratch, and the change
                summary below tells you exactly what moved and why.
              </p>
            </form>
          </div>

          {/* and what the plan does about it */}
          <div className="p-3 lg:p-4">
            <p className="label flex items-center gap-2 plan-accent">
              What this plan does about it
            </p>
            {summaryBusy && !summary ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> writing it out
              </p>
            ) : summary ? (
              <RichText text={summary} className="mt-2 text-xs leading-relaxed" />
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                The written summary needs an API key. Everything below is the plan itself and does not.
              </p>
            )}

            {/* People who did this degree, found while the plan was being worked
                out. The rest of this page argues from catalogs and postings;
                these are the only rows on it that can be asked a question. */}
            {!!(state.alumni ?? []).length && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="label flex items-center gap-2 plan-accent">
                  <Users className="h-3.5 w-3.5" /> Graduates you could ask
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  They did {program?.name ?? "this degree"}. Ask which of these courses actually mattered.
                </p>
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {(state.alumni ?? []).slice(0, 6).map((a) => (
                    <li key={a.url}>
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-2 rounded-lg border border-border p-2 transition-colors hover:border-[var(--blue)] hover:bg-[var(--blue-soft)]"
                      >
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                          style={{ background: "var(--blue-soft)", color: "var(--blue-deep)" }}
                          aria-hidden
                        >
                          {a.initials || "?"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 text-xs font-medium">
                            <span className="truncate">{a.name}</span>
                            <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                            {[a.classOf && `class of ${a.classOf}`, a.studied, a.nowAt]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  Found by public web search. The school had to appear on the profile, but nothing else
                  is checked, so look before you write. Profile photographs are not shown because the
                  search does not return them.
                </p>
              </div>
            )}
          </div>
        </div>
        </details>
      </header>

      <div className="mt-3">
        <SemesterChart
            names={names}
            plan={plan}
            courses={courses}
            fill={filledByTerm}
            completed={state.student.completed}
            onJump={jumpToCourse}
            problemTerms={problemTerms}
            addSearch={{
              catalog: school?.courses ?? [],
              termKinds: termKinds as unknown as string[],
              completed: doneSetLive,
              unmetBuckets: unmetLive.map((r) => ({ id: r.id, label: r.label, eligible: r.eligible })),
              onAdd: (id, t) => addCourse(id, t, courses.get(id)?.code),
            }}
          />
          <div className="mt-2 flex justify-end">
            <button onClick={() => setDoctorOpen(true)} data-track="plan_doctor_open"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-4 py-2 text-xs font-medium transition-colors hover:border-[var(--blue)] hover:bg-[var(--blue-soft)]"
                    title="Every semester gets its own search box and live rule checks">
              <RotateCcw className="h-3.5 w-3.5" /> Arrange semesters by hand: add, remove, move courses
            </button>
          </div>
      </div>

      {(doctorOpen || repair) && program && (
        <PlanDoctor
          key={repair ? `${repair.attempted}-${repair.dropCourseId ?? ""}` : "manual"}
          plan={plan}
          program={program}
          courses={courses}
          catalog={school?.courses ?? []}
          names={names}
          termKinds={termKinds}
          completed={state.student.completed}
          repair={repair}
          busy={solving}
          onClose={() => { setDoctorOpen(false); clearRepair(); }}
          onApply={(pl, dropId) => { setDoctorOpen(false); tryArrangement(pl, dropId); }}
          onJump={(id) => { setDoctorOpen(false); clearRepair(); jumpToCourse(0, id); }}
        />
      )}


      {/* The board shows what the solver reached for. This is how you ask for
          something it never offered, which for a whole degree is most of it.
          It opens from a button rather than sitting open: as a permanent panel
          it pushed the change log and everything below it off the screen, and
          almost nobody is searching the bulletin on any given visit. */}
      {program && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setFinderOpen((v) => !v)}
            aria-expanded={finderOpen}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-[var(--blue)] hover:text-foreground"
          >
            <Search className="h-3 w-3" aria-hidden />
            {finderOpen ? "Close the course search" : "Look for a course by name"}
          </button>
        </div>
      )}
      {program && finderOpen && (
        <div className="fade-up mt-2">
          <CourseFinder
            catalog={{
              courses: school?.courses ?? [],
              buckets: program.buckets,
              completed: state.student.completed,
            }}
            plan={plan}
            courses={courses}
            onKeep={(id, label) => keepInPlan(id, label)}
            onJump={(id) => jumpToCourse(0, id)}
          />
        </div>
      )}

      {/* ── what changed, and what it did ──────────────────────────────────── */}
      {lastChange && (
        <div className="fade-up mt-5 rounded-3xl border-2 p-5 glow"
             style={{ borderColor: "var(--blue-light)", background: "var(--blue-soft)" }}>
          <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
            <div className="min-w-[200px]">
              <p className="label" style={{ color: "var(--blue)" }}>You changed</p>
              <p className="mt-1 font-semibold">{lastChange.action}</p>
            </div>
            <div className="min-w-[240px] max-w-md">
              <p className="label" style={{ color: "var(--blue)" }}>Why it had to move</p>
              <p className="mt-1 text-sm text-muted-foreground">{lastChange.reason}</p>
            </div>
            <div className="min-w-[240px] flex-1">
              <p className="label" style={{ color: "var(--blue)" }}>What happened</p>
              <ul className="mt-1 space-y-0.5">
                {lastChange.effects.map((e, i) => (
                  <li key={i} className="text-sm text-muted-foreground">{e}</li>
                ))}
              </ul>
            </div>
            <button
              onClick={undo}
              className="ml-auto flex items-center gap-2 self-start rounded-full bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-white/70"
              style={{ color: "var(--blue-deep)" }}
            >
              <Undo2 className="h-3.5 w-3.5" /> Undo this
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-6 lg:mt-8 lg:flex-row lg:gap-8">
        {/* ── the semesters, stacked ───────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          {result.plans.length > 1 && (
            <div className="mb-4 grid gap-2.5 sm:grid-cols-3">
              {result.plans.map((p, i) => {
                const on = i === state.activePlan;
                const tint = ["plan-a", "plan-b", "plan-c"][i % 3];
                // Compared against whatever you have open, not against the best
                // plan forever. Switch to option 2 and the other two start
                // describing themselves relative to option 2, which is the only
                // baseline that makes sense once you have switched.
                const d = on ? null : describeDiff(plan, p, courses);
                const quiet = d && !d.gains.length && !d.losses.length && !d.creditDelta;
                return (
                  <button
                    key={p.id}
                    onClick={() => setState({ activePlan: i, selectedCourse: null })}
                    aria-pressed={on}
                    className={`${tint} rounded-xl border-2 p-3 text-left transition-all ${
                      on ? "plan-edge plan-wash glow" : "border-border bg-card hover:plan-edge"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`text-sm font-semibold ${on ? "plan-accent" : ""}`}>
                        {i === 0 ? "Best plan" : `Option ${i + 1}`}
                      </span>
                      {on
                        ? <Check className="h-4 w-4 shrink-0 plan-accent" />
                        : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-border" />}
                    </span>

                    {on ? (
                      <span className="tabular mt-1 block text-xs text-muted-foreground">
                        {p.totalCredits} credits, answers {p.skillsCovered.length}. This is the one you have open.
                      </span>
                    ) : d?.sameCourses ? (
                      <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                        The same courses as the one you have open, moved to different semesters.
                      </span>
                    ) : (
                      <span className="mt-1.5 block text-xs leading-snug">
                        {d?.swaps.slice(0, 2).map((sw, k) => (
                          <span key={k} className="mb-0.5 block text-muted-foreground">
                            {sw.in && sw.out ? (
                              <>
                                <span className="font-medium text-foreground">{sw.in.title}</span>
                                {" instead of "}
                                <span>{sw.out.title}</span>
                              </>
                            ) : sw.in ? (
                              <>
                                {"adds "}
                                <span className="font-medium text-foreground">{sw.in.title}</span>
                              </>
                            ) : (
                              // Not a substitution. Saying "instead of" here was
                              // how the page came to claim a course had replaced
                              // one it never touched.
                              <>
                                {"drops "}
                                <span>{sw.out!.title}</span>
                              </>
                            )}
                          </span>
                        ))}
                        {(d?.swaps.length ?? 0) > 2 && (
                          <span className="mb-0.5 block text-muted-foreground">
                            and {(d!.swaps.length) - 2} more change{d!.swaps.length - 2 === 1 ? "" : "s"}
                          </span>
                        )}
                        {!!d?.gains.length && (
                          <span className="block" style={{ color: "var(--teal)" }}>
                            also answers {d.gains.join(", ")}
                          </span>
                        )}
                        {!!d?.losses.length && (
                          <span className="block" style={{ color: "var(--clay)" }}>
                            gives up {d.losses.join(", ")}
                          </span>
                        )}
                        {!!d?.creditDelta && (
                          <span className="tabular block text-muted-foreground">
                            {d.creditDelta > 0 ? "+" : ""}{d.creditDelta} credits
                          </span>
                        )}
                        {!quiet && !!(d?.gains.length || d?.losses.length) && (
                          <span className="block text-muted-foreground">
                            {d!.gains.length && !d!.losses.length
                              ? `Choose it to also cover ${d!.gains.join(", ")}.`
                              : !d!.gains.length && d!.losses.length
                                ? `Only if you can live without ${d!.losses.join(", ")}.`
                                : `A trade: ${d!.gains.join(", ")} for ${d!.losses.join(", ")}.`}
                          </span>
                        )}
                        <span className="block text-muted-foreground">
                          {(() => {
                            // The one question this card exists to answer:
                            // why would you take THIS plan over the one you
                            // have open. Praising the incoming course was not
                            // an answer, it was an advert. Both courses of
                            // the first swap are placed on the same scale,
                            // the reader's consideration list, and the
                            // sentence says which plan that list favours.
                            const sw = d?.swaps.find((x) => x.in && x.out);
                            if (!sw) return null;
                            const byCode = (code: string) => [...courses.values()].find((c) => c.code === code);
                            const cin = byCode(sw.in!.code);
                            const cout = byCode(sw.out!.code);
                            const pIn = cin ? consideration[cin.id] : undefined;
                            const pOut = cout ? consideration[cout.id] : undefined;
                            const N = (state.shortlist ?? []).length;
                            if (pIn == null && N > 0) {
                              return `${sw.in!.title} was not among the ${N} courses the reader weighed for this posting. The degree accepts it; the posting does not ask for it.`;
                            }
                            if (pIn != null && pOut != null) {
                              const inHits = (cin && state.relevance?.[cin.id]) || [];
                              const answers = inHits.length
                                ? ` ${sw.in!.title} answers ${inHits.slice(0, 2).map((h) => h.skill).join(" and ")} for this posting.`
                                : "";
                              // Eleventh against twelfth is not a reason, it
                              // is a rounding error wearing one's clothes.
                              if (Math.abs(pIn - pOut) <= 2) {
                                return `The reader ranks these nearly even (${sw.in!.title} ${pIn + 1} of ${N}, ${sw.out!.title} ${pOut + 1}), so the posting is answered the same either way.${answers} Pick by which subject you would rather sit through.`;
                              }
                              return pIn < pOut
                                ? `The reader placed ${sw.in!.title} ${pIn + 1} of ${N}, well above ${sw.out!.title} at ${pOut + 1}.${answers}`
                                : `Your open plan already holds the stronger pick: ${sw.out!.title} sits ${pOut + 1} of ${N} against ${pIn + 1}. Take this option only if you would rather study ${sw.in!.title}.${answers}`;
                            }
                            return "Same job coverage, same credits, a different set of courses. Pick by which subjects you would rather sit through.";
                          })()}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-6 rounded-full border-2" style={{ borderColor: "var(--teal)" }} />
              chosen for this job
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-6 rounded-full border" style={{ borderColor: "var(--border)" }} />
              required by the degree
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-6 rounded-full border-2" style={{ borderColor: "var(--amber)" }} />
              pinned by you
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-6 rounded-full border border-dashed" style={{ borderColor: "var(--border)" }} />
              your other classes
            </span>
          </div>

          <div className="stagger mt-4 space-y-4">
            {names.map((name, t) => {
              const inTerm = plan.placements.filter((p) => p.term === t);
              const major = plan.termCredits[t] ?? 0;
              const other = plan.openCreditsNeeded[t] ?? 0;
              const under = plan.belowFullTime?.includes(t);
              // A missing prerequisite for a course sitting IN this term can
              // only be fixed by an earlier term — adding it here too would
              // leave the violation standing. Computed once per term so both
              // the banner and this term's own add-search can avoid the trap.
              const missingPrereqHere = problemTerms.has(t)
                ? failedLive
                    .filter((c) => c.id === "prereqs")
                    .flatMap((c) => c.offenders.filter((id) => termOfLive.get(id) === t))
                    .map((id) => missingPrereqFor(id))
                    .find((m): m is { course: Course; term: number } => !!m)
                : null;
              // The gap can also be one no NEW course closes: the missing
              // course is one that was taken off the table by hand. Removing
              // it is what created the break, so putting it back is the fix
              // that actually resolves it — and for a course the degree
              // requires, the only one that leaves a finishable plan.
              const excludedOffenderHere = !missingPrereqHere && problemTerms.has(t)
                ? failedLive
                    .filter((c) => c.id === "prereqs")
                    .flatMap((c) => c.offenders.filter((id) => termOfLive.get(id) === t))
                    .map((id) => ({ id, excluded: excludedPrereqFor(id) }))
                    .find((x) => x.excluded)
                : null;
              const reasons = problemTerms.has(t) ? reasonsForTerm(t) : [];
              const brokenHere = brokenTerms.has(t);
              return (
                <section key={name} id={`term-${t}`}
                         className="scroll-mt-4 rounded-2xl border plan-edge bg-card p-3.5 glow sm:p-4 lg:p-5"
                         style={brokenHere
                           ? { borderColor: "#dc2626", boxShadow: "inset 0 0 0 1px #dc2626" }
                           : problemTerms.has(t)
                             ? { borderColor: "var(--amber)" }
                             : undefined}>
                  {/* The compact board at the top marks trouble; these cards are
                      where people actually read a semester, so they carry the
                      same mark and the same way out of it. */}
                  {!!reasons.length && (
                    <div className="mb-3 rounded-xl border p-2.5"
                         style={brokenHere
                           ? { borderColor: "#dc2626", background: "rgba(220,38,38,0.04)" }
                           : { borderColor: "var(--amber)", background: "color-mix(in oklab, var(--amber) 6%, white)" }}>
                      <p className="text-[11px] font-medium" style={{ color: brokenHere ? "#dc2626" : "var(--clay)" }}>
                        {brokenHere
                          ? reasons.filter((r) => r.broken).length === 1
                            ? "One thing to settle in this semester"
                            : `${reasons.filter((r) => r.broken).length} things to settle in this semester`
                          : "Nothing here is broken \u2014 this semester can host a fix"}
                      </p>
                      <ul className="mt-1.5 space-y-2">
                        {reasons.map((r) => (
                          <li key={r.key}>
                            <p className="text-xs font-medium" style={{ color: r.broken ? "#dc2626" : "var(--clay)" }}>
                              {r.headline}
                            </p>
                            {r.detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{r.detail}</p>}
                            {!!r.actions.length && (
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {r.actions.map((a) => (
                                  <button key={a.label} onClick={a.onClick}
                                          data-track="term_reason_fix"
                                          className={a.primary
                                            ? "rounded-full bg-foreground px-3 py-1 text-[11px] font-medium text-background"
                                            : "rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground"}>
                                    {a.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button onClick={() => setAddHere(addHere === t ? null : t)} data-track="term_add_open"
                                className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground">
                          {addHere === t ? "Close" : "or add something else here"}
                        </button>
                      </div>
                      {addHere === t && (
                        <div className="mt-2">
                          {(() => {
                            const q = addQuery.trim().toLowerCase();
                            const missingHere = failedLive
                              .filter((c) => c.id === "prereqs")
                              .flatMap((c) => c.offenders.filter((id) => termOfLive.get(id) === t))
                              .map((id) => missingPrereqFor(id))
                              .find((m): m is { course: Course; term: number } => !!m);
                            // Nothing typed yet: lead with a real, ranked
                            // suggestion instead of a search box with nothing
                            // in it. This is the fix, not a hunt for one.
                            const readyFixes = q.length < 2 && unmetLive.length
                              ? unmetLive.flatMap((r) => suggestFor(r.eligible).filter((x) => x.term === t).map((x) => ({ ...x, forLabel: r.label })))
                              : [];
                            const list = (readyFixes.length ? readyFixes.map((x) => x.course) : (school?.courses ?? [])
                              .filter((c) => !placedIdsLive.has(c.id) && !doneSetLive.has(c.id) && !excludedSetLive.has(c.id))
                              .filter((c) => c.termsOffered.includes(termKinds[t]))
                              .filter((c) => q.length < 2 || c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
                              .slice(0, 5))
                              // Putting the missing prerequisite in THIS term
                              // wouldn't satisfy it — a prerequisite has to
                              // land strictly before the course that needs it.
                              // A missing prerequisite cannot be fixed by
                              // adding it to THIS semester -- it has to land
                              // in an earlier one -- so it is kept out of this
                              // list, which would otherwise offer a move that
                              // leaves the violation standing.
                              .filter((c) => c.id !== missingHere?.course.id);
                            return (
                              <>
                                {!!missingHere && (
                                  <p className="mb-1 text-[10px] text-muted-foreground">
                                    {missingHere.course.code} is left out here — it needs to land in an earlier semester to count.
                                  </p>
                                )}
                                {!!readyFixes.length && (
                                  <p className="mb-1 text-[10px] text-muted-foreground">
                                    Closes what is open in this semester. Ranked by how well it answers your posting.
                                  </p>
                                )}
                                <input autoFocus value={addQuery} onChange={(e) => setAddQuery(e.target.value)}
                                       placeholder="or search any other course to put in this semester"
                                       className="w-full rounded-lg border border-border px-2.5 py-1.5 text-xs focus:border-[var(--blue)] focus:outline-none" />
                                <ul className="mt-1 space-y-0.5">
                                  {list.map((c) => {
                                    const fills = unmetLive.filter((r) => r.eligible.has(c.id));
                                    return (
                                      <li key={c.id}>
                                        <button onClick={() => { addCourse(c.id, t, c.code); setAddHere(null); setAddQuery(""); }}
                                                className="flex w-full items-baseline gap-2 rounded-lg border border-border bg-white px-2 py-1.5 text-left text-xs hover:border-[var(--blue)]">
                                          <span className="min-w-0 flex-1 truncate">
                                            {c.title} <span className="code text-[10px] text-muted-foreground">{c.code}</span>
                                          </span>
                                          <span className="shrink-0 text-[10px]" style={{ color: fills.length ? "var(--teal)" : "var(--muted-foreground, #6b7280)" }}>
                                            {fills.length ? `fills: ${fills[0].label}` : "fills no open requirement"} · {c.credits} cr
                                          </span>
                                        </button>
                                      </li>
                                    );
                                  })}
                                  {!list.length && (
                                    <li className="px-1 py-1 text-[10px] text-muted-foreground">Nothing left in the catalog fills this here; try another semester.</li>
                                  )}
                                </ul>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex flex-wrap items-baseline gap-3 border-b border-border pb-3">
                    <h2 className="font-display text-lg font-semibold">{name}</h2>
                    <span className="tabular plan-wash plan-accent rounded-full px-2.5 py-0.5 text-xs font-medium">
                      {major + other} credits
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {major} from your major
                      {other > 0 && `, ${other} of core curriculum and free electives`}
                    </span>
                    {under && (
                      <span className="text-sm" style={{ color: "var(--amber)" }}>
                        below full time
                      </span>
                    )}
                  </div>

                  <div className="mt-3 space-y-2">
                    {inTerm.map((p) => courses.get(p.courseId) ? (
                      <CourseRow
                        key={p.courseId}
                        placement={p}
                        course={courses.get(p.courseId)!}
                        plan={plan}
                        changed={changed.has(p.courseId)}
                        choice={slotByCourse.get(p.courseId)}
                        altOpen={openAlts === p.courseId}
                        onToggleAlts={() => setOpenAlts(openAlts === p.courseId ? null : p.courseId)}
                        courses={courses}
                        planned={plannedIds}
                        completed={completedIds}
                        onJump={jumpToCourse}
                        whyOf={(id, context) => {
                          // The first reason on file was shown whatever the
                          // slot was about, which put a sentence about GPU
                          // pipelines under a course offered for a databases
                          // slot. A reason only shows unlabelled when it is
                          // about a part the chosen course actually covers;
                          // out of context it carries the part's name, so a
                          // strange pairing reads as what it is.
                          const hits = state.relevance?.[id] ?? [];
                          const inContext = hits.find((h) => h.why && context.includes(h.skill));
                          if (inContext) return inContext.why;
                          const any = hits.find((h) => h.why);
                          return any ? `For "${any.skill}": ${any.why}` : undefined;
                        }}
                        posOf={(id) => consideration[id]}
                        consideredTotal={orderedCodes.length}
                        shortlistCount={shortlistCount}
                        whyConsidered={(id) => considerationWhy.get(id) ?? null}
                        onLock={() => toggleLock(p.courseId, p.term, courses.get(p.courseId)?.code)}
                        onRemove={() => removeCourse(p.courseId, courses.get(p.courseId)?.code)}
                        onChoose={(id) => {
                          setOpenAlts(null);
                          chooseSlot(p.bucketId, p.courseId, id, courses.get(p.courseId)?.code, courses.get(id)?.code);
                        }}
                      />
                    ) : null)}

                    {other > 0 && (
                      <OpenSlot fill={filledByTerm.get(t)} courses={courses} revealCourse={openAlts}
                                jobParts={(state.facets ?? []).length} consideredTotal={orderedCodes.length} whyConsidered={(id) => considerationWhy.get(id) ?? null} />
                    )}

                    {!inTerm.length && other === 0 && (
                      <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                        Nothing scheduled this semester.
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {/* ── what if ──────────────────────────────────────────────────── */}
          {!!result.counterfactuals.length && (
            <section className="mt-6 rounded-3xl border border-border bg-card p-6 glow">
              <h2 className="font-display text-lg font-semibold">Would more room help?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each of these relaxes one rule and works the whole plan out again. Click one to try it.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {result.counterfactuals.map((cf) => {
                  const nothing = cf.feasible && !cf.deltaSkills && !cf.deltaCredits && !cf.deltaTerms;
                  const better = cf.deltaSkills > 0 || cf.deltaTerms < 0;
                  const apply = () => {
                    if (/summer/i.test(cf.change) || /beyond your horizon/i.test(cf.change)) {
                      void runSolve({ student: { ...state.student, horizonTerms: Math.min(8, state.student.horizonTerms + 1) } });
                    }
                  };
                  const clickable = /summer|horizon/i.test(cf.change);
                  return (
                    <button
                      key={cf.change}
                      onClick={clickable ? apply : undefined}
                      disabled={!clickable}
                      className={`rounded-2xl border p-4 text-left transition-all ${
                        clickable ? "hover:border-[var(--blue)] hover:bg-[var(--blue-soft)]" : "cursor-default"
                      }`}
                      style={better ? { borderColor: "var(--teal)" } : undefined}
                    >
                      <p className="font-medium">{cf.change}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {!cf.feasible ? "Still no plan fits."
                          : nothing ? "Changes nothing. You already reach everything this catalog can teach."
                          : [
                              cf.deltaSkills > 0 && `teaches ${cf.deltaSkills} more`,
                              cf.deltaTerms < 0 && `finishes ${-cf.deltaTerms} semester earlier`,
                              cf.deltaTerms > 0 && `takes ${cf.deltaTerms} semester longer`,
                              cf.deltaCredits !== 0 && `${cf.deltaCredits > 0 ? "+" : ""}${cf.deltaCredits} credits`,
                            ].filter(Boolean).join(", ")}
                      </p>
                      {clickable && (
                        <p className="mt-2 text-sm font-medium" style={{ color: "var(--blue)" }}>
                          Try this →
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── things you removed ───────────────────────────────────────── */}
          {!!state.student.excluded.length && (
            <section className="mt-6 rounded-3xl border border-border bg-card p-6">
              <h2 className="font-display text-lg font-semibold">Courses you removed</h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {state.student.excluded.map((id) => (
                  <li key={id}>
                    <button
                      onClick={() => unexclude(id, courses.get(id)?.code)}
                      className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm transition-colors hover:bg-[var(--blue-soft)]"
                    >
                      {courses.get(id)?.code ?? id} <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── history ──────────────────────────────────────────────────── */}
          {history.length > 0 && (
            <section className="mt-6 rounded-3xl border border-border bg-card p-6">
              <h2 className="font-display text-lg font-semibold">Everything you changed</h2>
              <ol className="mt-3 space-y-2">
                {history.map((h, i) => (
                  <li key={h.id} className="flex items-baseline gap-3 text-sm">
                    <span className="tabular w-5 shrink-0 text-muted-foreground">{i + 1}</span>
                    <span className="font-medium">{h.action}</span>
                    <span className="text-muted-foreground">{h.effects[0]}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {/* ── sidebar: the checklist ───────────────────────────────────────── */}
        <aside className="w-full min-w-0 shrink-0 lg:w-[360px]">
          <div className="stagger space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-1 lg:pb-20 rail-scroll">
            <section className="rounded-3xl border p-4"
                     style={healthy
                       ? { borderColor: "color-mix(in oklab, var(--teal) 45%, transparent)", background: "color-mix(in oklab, var(--teal) 5%, white)" }
                       : { borderColor: "#dc2626", background: "rgba(220,38,38,0.04)" }}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 id="plan-health" className="font-display text-sm font-semibold">Plan health, live</h2>
                <span className="text-xs font-medium" style={{ color: healthy ? "var(--teal)" : "#dc2626" }}>
                  {healthy ? "all clear" : `${failedLive.length + unmetLive.length} open`}
                </span>
              </div>
              {healthy ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Every rule passes and every requirement is on track. Edit freely; this panel and the
                  board's lights update with every change.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {failedLive.map((c) => (
                    <li key={c.id} className="text-xs">
                      {/* These are the FAILED checks only, so the heading says
                          what is wrong. The full ticked-and-crossed list
                          further down is the place for the rule's own name. */}
                      <p className="font-medium" style={{ color: "#dc2626" }}>{c.problem}</p>
                      <p className="text-muted-foreground">{c.detail}</p>
                      {!!c.offenders.length && (
                        <div className="mt-1 space-y-1">
                          {c.offenders.map((id) => {
                            const co = courses.get(id);
                            // A rule can also fail at the semester or the
                            // requirement level (a credit cap, a missing
                            // citation), where there is no single course to
                            // move or remove. Those offenders are plain
                            // labels; only a real course id gets the button.
                            if (!co) {
                              return <span key={id} className="inline-block rounded-full bg-foreground/5 px-2 py-0.5 text-[10px] text-muted-foreground">{id}</span>;
                            }
                            const here = termOfLive.get(id);
                            const open = openFix === `${c.id}:${id}`;
                            // Where this course could legally sit instead: the
                            // terms it is actually offered in, minus where it is.
                            const legal = names
                              .map((n, t) => ({ n, t }))
                              .filter(({ t }) => co.termsOffered.includes(termKinds[t]) && t !== here);
                            // A prereq failure can mean two different things:
                            // the course IS in the plan but sits too late (Move
                            // fixes that), or its prerequisite was never placed
                            // at all, and moving THIS course changes nothing.
                            const missing = c.id === "prereqs" ? missingPrereqFor(id) : null;
                            const excludedPrereq = c.id === "prereqs" && !missing ? excludedPrereqFor(id) : null;
                            return (
                              <div key={id}>
                                <button onClick={() => setOpenFix(open ? null : `${c.id}:${id}`)}
                                        aria-expanded={open}
                                        className="rounded-full border border-border bg-white px-2 py-0.5 text-[10px] hover:border-[var(--blue)]">
                                  {co.code} {open ? "\u25B4" : "\u25BE"}
                                </button>
                                {open && (
                                  <div className="mt-1 rounded-lg border border-border bg-white p-2">
                                    <p className="text-[10px] text-muted-foreground">
                                      {co.title}{here != null ? ` sits in ${names[here]}.` : " is not currently placed."}{" "}
                                      {missing
                                        ? `Its prerequisite, ${missing.course.title}, is not in the plan at all.`
                                        : excludedPrereq
                                          ? `Its prerequisite, ${excludedPrereq.course.title}, was taken out of the plan \u2014 moving this course to another term will not fix that. Putting it back will.`
                                          : "Move it, or open it on the board."}
                                    </p>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {missing && (
                                        <button onClick={() => { addCourse(missing.course.id, missing.term, missing.course.code); setOpenFix(null); }}
                                                data-track="health_fix_add_prereq"
                                                className="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-medium text-background">
                                          Add {missing.course.code} to {names[missing.term]}
                                        </button>
                                      )}
                                      {excludedPrereq && (
                                        <button onClick={() => { addCourse(excludedPrereq.course.id, excludedPrereq.term, excludedPrereq.course.code); setOpenFix(null); }}
                                                data-track="health_fix_restore_prereq"
                                                className="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-medium text-background">
                                          Put {excludedPrereq.course.code} back in {names[excludedPrereq.term]}
                                        </button>
                                      )}
                                      {!excludedPrereq && legal.map(({ n, t }) => (
                                        <button key={t} onClick={() => { moveCourse(id, t, co.code); setOpenFix(null); }}
                                                data-track="health_fix_move"
                                                className="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-medium text-background">
                                          Move to {n}
                                        </button>
                                      ))}
                                      <button onClick={() => { removeCourse(id, co.code); setOpenFix(null); }}
                                              data-track="health_fix_remove"
                                              className="rounded-full border border-border px-2.5 py-1 text-[10px]">
                                        Remove it
                                      </button>
                                      {here != null && (
                                        <button onClick={() => { setOpenFix(null); jumpToCourse(here, id); }}
                                                className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground">
                                          Show me
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  ))}
                  {unmetLive.map((r) => {
                    const picks = suggestFor(r.eligible);
                    const open = openFix === r.id;
                    return (
                      <li key={r.id} className="text-xs">
                        <button onClick={() => setOpenFix(open ? null : r.id)}
                                aria-expanded={open}
                                className="flex w-full items-center gap-1 text-left font-medium" style={{ color: "#dc2626" }}>
                          {r.label}: {r.gap} {r.unit}{r.gap === 1 ? "" : "s"} short
                          <ChevronDown className={`ml-auto h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>
                        {open && (
                          <div className="mt-1.5 rounded-lg border border-border bg-white p-2">
                            {picks.length ? (
                              <>
                                <p className="text-[10px] text-muted-foreground">
                                  Any one of these closes it. Ranked by how well it answers your posting.
                                </p>
                                <ul className="mt-1 space-y-1">
                                  {picks.map(({ course, term, rank }) => (
                                    <li key={course.id} className="flex items-center gap-2">
                                      <span className="min-w-0 flex-1 truncate">
                                        {course.title} <span className="code text-[10px] text-muted-foreground">{course.code}</span>
                                        <span className="block text-[10px] text-muted-foreground">
                                          {rank != null ? `reader's pick ${rank + 1} for this job · ` : ""}
                                          {course.credits} cr · runs {course.termsOffered.join("/")}
                                        </span>
                                      </span>
                                      <button onClick={() => { addCourse(course.id, term, course.code); setOpenFix(null); }}
                                              data-track="health_fix_add"
                                              className="shrink-0 rounded-full bg-foreground px-2.5 py-1 text-[10px] font-medium text-background">
                                        Add to {names[term]}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            ) : (
                              <p className="text-[10px] text-muted-foreground">
                                Nothing left in the catalog fills this inside your remaining semesters. Adding a
                                semester in the survey, or unpinning a course, is what opens it up.
                              </p>
                            )}
                            <button onClick={() => document.getElementById(`bucket-${r.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                                    className="mt-1.5 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                              see the rule this comes from
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-3xl border border-border bg-card p-5 glow">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-lg font-semibold">What the degree needs</h2>
                <span className="tabular text-sm text-muted-foreground">
                  {plan.buckets.filter((b) => b.satisfied).length}/{plan.buckets.length}
                </span>
              </div>

              <ul className="mt-4 space-y-3">
                {plan.buckets.map((b) => {
                  const fills = plan.placements.filter((p) => p.bucketId === b.bucketId);
                  const already = b.fromCompletedCourses;
                  return (
                    <li key={b.bucketId} id={`bucket-${b.bucketId}`} className="rounded-2xl bg-[var(--blue-soft)]/60 p-3">
                      <div className="flex items-start gap-2.5">
                        <span
                          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                          style={{ background: b.satisfied ? "var(--teal)" : "var(--border)" }}
                        >
                          {b.satisfied && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug">{b.label}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {b.fromCompleted + b.fromPlan} of {b.need}
                            {b.fromCompleted > 0 && <span> · {b.fromCompleted} from what you already passed</span>}
                          </p>
                          {!b.satisfied && (
                            <p className="mt-0.5 text-xs font-medium" style={{ color: "var(--amber-deep, #92400e)" }}>
                              still open: {Math.max(0, b.need - b.fromCompleted - b.fromPlan)} more needed beyond this horizon
                            </p>
                          )}

                          {/* Which course closed it, and the proof that it counts. */}
                          {(!!fills.length || !!already.length) && (
                            <ul className="mt-2 space-y-1.5">
                              {already.map((id) => (
                                <li key={id} className="text-xs">
                                  <span>{courses.get(id)?.title}</span>{" "}
                                  <span className="code text-xs">{courses.get(id)?.code}</span>
                                  <span className="text-muted-foreground"> · you already passed it</span>
                                </li>
                              ))}
                              {fills.map((p) => (
                                <li key={p.courseId} className="text-xs">
                                  <span className="code" style={{ color: "var(--blue)" }}>
                                    {courses.get(p.courseId)?.title}{" "}
                                    <span className="code text-xs">{courses.get(p.courseId)?.code}</span>
                                  </span>
                                  <span className="text-muted-foreground"> · {names[p.term]}</span>
                                </li>
                              ))}
                            </ul>
                          )}

                          {/* The rule itself, word for word, with the page it is on. */}
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs underline underline-offset-2"
                                     style={{ color: "var(--blue)" }}>
                              Proof this counts
                            </summary>
                            <div className="mt-2 rounded-xl border border-border bg-white p-2.5">
                              <p className="label text-[9px] text-muted-foreground">
                                Columbia says, word for word
                              </p>
                              <blockquote className="mt-1 border-l-2 pl-2 text-xs italic leading-relaxed"
                                          style={{ borderColor: "var(--blue-light)" }}>
                                &ldquo;{b.source.quote}&rdquo;
                              </blockquote>
                              <p className="mt-2 text-xs text-muted-foreground">
                                {[...already, ...fills.map((p) => p.courseId)]
                                  .map((id) => courses.get(id)?.code)
                                  .filter(Boolean)
                                  .join(", ") || "Nothing yet"}
                                {" "}
                                {[...already, ...fills].length === 1 ? "is one of" : "are among"} the{" "}
                                {b.eligibleCount} courses that rule allows.
                              </p>
                              <a href={b.source.url} target="_blank" rel="noreferrer"
                                 className="mt-2 inline-flex items-center gap-1 text-xs underline"
                                 style={{ color: "var(--blue)" }}>
                                Open the bulletin page <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                retrieved {b.source.retrievedAt}. If this page has changed since,
                                the wording above is what the plan was built on.
                              </p>
                            </div>
                          </details>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* rules check */}
            {v && (
              <section className="rounded-3xl border border-border bg-card p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold">Rules checked</h2>
                  <span className="tabular text-sm" style={{ color: v.failed ? "var(--clay)" : "var(--teal)" }}>
                    {v.passed}/{v.checks.length}
                  </span>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {v.checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full"
                            style={{ background: c.passed ? "var(--teal)" : "var(--clay)" }}>
                        {c.passed
                          ? <Check className="h-2 w-2 text-white" strokeWidth={4} />
                          : <X className="h-2 w-2 text-white" strokeWidth={4} />}
                      </span>
                      <span className={c.passed ? "text-muted-foreground" : ""}>{c.rule}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* what no class can teach */}
            {!!cannot.length && (
              <section className="rounded-3xl border-2 p-5" style={{ borderColor: "var(--clay)" }}>
                <h2 className="font-display text-lg font-semibold" style={{ color: "var(--clay)" }}>
                  No class can teach you this
                </h2>
                <ul className="mt-3 space-y-2">
                  {cannot.map((c) => (
                    <li key={c.skill}>
                      <p className="text-sm font-medium">{c.skill}</p>
                      <p className="text-xs text-muted-foreground">{c.reason}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                  No schedule fixes this part. These need a project, a research group, an internship,
                  or time on the job.
                </p>
              </section>
            )}

            <p className="text-xs text-muted-foreground">
              <Link href="/sources" className="underline">Every catalog page used</Link>
              {" · "}
              {result.stats.provedOptimal
                ? "Every option was tried, so nothing better exists under these rules."
                : "Time ran out before every option was tried, so this is the best found so far."}
            </p>
          </div>
        </aside>
      </div>

      <AskPanel plan={plan} />
    </div>
  );
}

/** One course, with what it teaches you and its alternatives, always visible. */
/** "a, b and c", because a comma list of three reads like a list of two. */
function listOf(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/**
 * What a swap really costs in credits.
 *
 * Comparing the two courses' own credit lines said "same credits" for swaps
 * that quietly drag in prerequisites the plan does not already hold, one of
 * them worth nine credits.
 */
function creditNote(alt: SlotAlternative): string {
  const own = alt.deltaCredits === 0 ? "same credits" : `${alt.deltaCredits > 0 ? "+" : ""}${alt.deltaCredits} cr`;
  if (!alt.extraPrereqCredits) return own;
  return `${own}, plus ${alt.extraPrereqCredits} cr of prerequisites`;
}

/**
 * The honest sentence for one swap.
 *
 * Every one of these used to read "Just as good for this job. No reason to
 * prefer either." whenever the alternative added nothing, which is what a
 * course answering nothing at all looks like. On a product manager posting
 * that put the sentence beside Operating Systems and Graph Theory, against a
 * course that answered one of the things the posting asked for. Twenty eight of
 * forty rows in one measured run were saying it untruthfully.
 *
 * Claims are kept at the level of the two courses, not the level of the plan,
 * because clicking re-runs the whole solve and the plan that comes back is not
 * this swap. What actually changed is narrated afterwards by the change log.
 */
function swapNote(alt: SlotAlternative, chosenCode: string): string {
  // The only case the solver can prove: identical job skills, credits, terms
  // and prerequisites. Nothing else may be called an equal choice.
  if (alt.sameClass && !alt.deltaSkills.length && !alt.losesSkills.length) {
    return "The solver could not tell these two apart on anything it measures, so this is a free choice.";
  }
  const gains = alt.deltaSkills.length ? `Answers ${listOf(alt.deltaSkills)}, which ${chosenCode} does not.` : "";
  const loses = alt.losesSkills.length
    ? `Does not answer ${listOf(alt.losesSkills)}, which ${chosenCode} does.`
    : "";
  const orphan = alt.lossesNoOtherPlannedCourseAnswers.length
    ? ` No other course in this plan answers ${alt.lossesNoOtherPlannedCourseAnswers.length === 1 ? "it" : "those"} either.`
    : "";
  if (gains && loses) return `${gains} ${loses}${orphan}`;
  if (loses) return `${loses}${orphan}`;
  if (gains) return gains;
  return "Neither course answers anything this posting asked for, so pick on the subject you would rather study.";
}

function CourseRow({
  placement, course, plan, changed, choice, altOpen, onToggleAlts,
  courses, onLock, onRemove, onChoose, planned, completed, onJump, whyOf, posOf, consideredTotal, shortlistCount, whyConsidered,
}: {
  placement: Placement;
  course: Course;
  plan: Plan;
  changed: boolean;
  choice?: SlotChoice;
  altOpen: boolean;
  onToggleAlts: () => void;
  courses: Map<string, Course>;
  onLock: () => void;
  onRemove: () => void;
  onChoose: (id: string) => void;
  /** every course id the plan holds, so a prerequisite can say where it is */
  planned: Set<string>;
  completed: Set<string>;
  onJump: (term: number, courseId?: string) => void;
  /** The judge's reason for a course IN THE CONTEXT of given facets. */
  whyOf: (courseId: string, context: string[]) => string | undefined;
  /** Position in the reader's consideration order, when it was considered. */
  posOf: (courseId: string) => number | undefined;
  consideredTotal: number;
  shortlistCount?: number;
  whyConsidered?: (id: string) => string | null;
}) {
  const isSupport = placement.bucketId === "SUPPORT";
  const bucket = plan.buckets.find((b) => b.bucketId === placement.bucketId);
  const chosenCode = course.code;

  // How much of the job this one course answers. Drives the glow, so the
  // courses the posting actually bought you are visible at a glance.
  const hits = placement.covers.length;
  const matchClass = hits >= 3 ? "match-3" : hits === 2 ? "match-2" : hits === 1 ? "match-1" : "";

  return (
    <div id={`course-${placement.courseId}`} className={`scroll-mt-6 rounded-lg border bg-white p-2 transition-all glow-hover ${matchClass} ${changed ? "pulse-changed match-announce" : ""}`}
         style={placement.locked ? { borderColor: "var(--amber)" } : undefined}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-x-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold">{course.title}</span>
            <WhatIsIt course={course} />
            <span
              className={`code text-xs ${placement.parseUnreviewed ? "cursor-help decoration-dotted underline-offset-2 [text-decoration-line:underline]" : ""}`}
              title={placement.parseUnreviewed
                ? "Its prerequisites were read off the bulletin by a parser and nobody has checked that reading"
                : undefined}
            >
              {course.code}
            </span>
            <span className="tabular text-[11px] text-muted-foreground">{course.credits} cr</span>
            {hits > 0 && (
              <span className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium"
                    style={{ background: "color-mix(in oklab, var(--teal) 14%, transparent)", color: "var(--teal)" }}
                    title={`Answers ${hits} thing${hits === 1 ? "" : "s"} this posting asks for`}>
                                {hits}
              </span>
            )}
            {placement.locked && (
              <span className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]"
                    style={{ background: "color-mix(in oklab, var(--amber) 15%, transparent)", color: "var(--amber)" }}
                    title="Pinned to this semester">
                <Lock className="h-2.5 w-2.5" />
              </span>
            )}
          </div>

          {/* One line, not four.
              This was a sentence about the requirement, a second sentence
              repeating the facet names that the pills below already carried, a
              row of pills, a proof disclosure, a prerequisite block and a
              bordered advisory box, stacked. Six blocks of chrome around three
              facts. The facts are the same, the stacking is gone. */}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <span>
              {isSupport
                ? placement.unlocks.length
                  ? `Needed before ${placement.unlocks.join(", ")}`
                  : "Not a requirement, taken for what it teaches"
                : `Counts toward ${bucket?.label ?? "a requirement"}`}
            </span>
            <span aria-hidden>·</span>
            <span>{course.termsOffered.map((t) => (t === "FA" ? "Fall" : t === "SP" ? "Spring" : "Summer")).join("/")}</span>
            {placement.covers.map((c) => (
              <span
                key={c.skill}
                className="rounded-full px-1.5 py-0.5 text-[11px]"
                style={{ background: "color-mix(in oklab, var(--teal) 12%, transparent)", color: "var(--teal)" }}
                title={c.why ? `${c.why} The catalog says: "${c.evidence}"` : `The catalog says: "${c.evidence}"`}
              >
                {c.skill}
              </span>
            ))}
          </p>

          <PrereqList
            course={course}
            courses={courses}
            planned={planned}
            completed={completed}
            onJump={(id) => onJump(0, id)}
          />

          {/* Only when the catalog attaches a real condition nobody can check.
              55 of the 139 courses have an unreviewed parse and nothing else, so
              showing that as its own amber line put an identical warning on
              almost every card in the plan, which is noise wearing the clothes
              of a warning. That fact now lives on the course code, which is the
              thing it is about. */}
          {placement.unverifiableText.length > 0 && (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[11px]" style={{ color: "var(--amber)" }}>
              <TriangleAlert className="h-3 w-3 shrink-0 self-center" aria-hidden />
              <span className="font-medium">Ask an advisor:</span>
              <span className="text-muted-foreground">
                {placement.unverifiableText.map((t) => `"${t}"`).join("; ")}
              </span>
            </p>
          )}

          {!!placement.covers.length && (
            <details className="mt-1">
              <summary
                className="cursor-pointer text-[11px] underline underline-offset-2"
                style={{ color: "var(--blue)" }}
              >
                Proof it teaches {placement.covers.length === 1 ? "this" : "these"}
              </summary>
              <ul className="mt-1 space-y-1 rounded-lg border border-border bg-[var(--blue-soft)]/50 p-2">
                {placement.covers.map((s) => (
                  <li key={s.skill} className="text-[11px] leading-snug">
                    <span className="font-medium" style={{ color: "var(--teal)" }}>{s.skill}</span>{" "}
                    <span className="italic text-muted-foreground">&ldquo;{s.evidence}&rdquo;</span>
                  </li>
                ))}
                <li className="border-t border-border pt-1 text-[10px] text-muted-foreground">
                  <a href={course.sourceUrl} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 underline" style={{ color: "var(--blue)" }}>
                    Read {course.code} in the catalog <ExternalLink className="h-2.5 w-2.5" />
                  </a>{" "}
                  Every sentence here is copied from that page. If one is not there, the claim is
                  wrong and should be reported.
                </li>
              </ul>
            </details>
          )}
        </div>

        <div className="order-first flex shrink-0 gap-2 self-end sm:order-none sm:self-auto">
          <button onClick={onLock}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--blue-soft)]">
            {placement.locked ? "Let it move" : "Keep"}
          </button>
          <button onClick={onRemove}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--blue-soft)]">
            Drop
          </button>
        </div>
      </div>

      {/* the dropdown, unmissable */}
      {choice && choice.alternatives.length > 0 && (
        <div className="mt-1">
          <button
            onClick={onToggleAlts}
            aria-expanded={altOpen}
            className="inline-flex items-center gap-1 text-[11px] underline underline-offset-2 transition-colors"
            style={{ color: "var(--blue)" }}
          >
            {altOpen ? "Hide" : "Show"} {choice.alternatives.length} other course
            {choice.alternatives.length === 1 ? "" : "s"} that fit this slot
            <ChevronDown className={`h-3 w-3 transition-transform ${altOpen ? "rotate-180" : ""}`} />
          </button>

          {altOpen && (() => {
            // A visible ranking, not six sentences that all start the same
            // way. The shared fact, that none of these answer what the chosen
            // course answers, is said ONCE in the lead line, so each row is
            // left saying only what makes it different: its rank, the
            // reader's placement, and its own reason. Row one is named the
            // best alternative outright, because "which one do I take if not
            // this" is the entire question this list exists to answer.
            const sorted = [...choice.alternatives].sort((a, b) =>
              b.deltaSkills.length - a.deltaSkills.length ||
              a.losesSkills.length - b.losesSkills.length ||
              (a.rank ?? posOf(a.courseId) ?? 9999) - (b.rank ?? posOf(b.courseId) ?? 9999));
            const lossKey = (x: SlotAlternative) => [...x.losesSkills].sort().join("|");
            const sharedLoss = sorted.length > 1 &&
              sorted[0].losesSkills.length > 0 &&
              sorted.every((x) => lossKey(x) === lossKey(sorted[0]));
            return (
              <div className="mt-2">
                <p className="mb-1.5 text-[11px] text-muted-foreground">
                  Ranked best first, by the reader&rsquo;s weighing of your posting.
                  {sharedLoss && (
                    <> None of these answer {listOf(sorted[0].losesSkills)}, which {chosenCode} does; that
                    loss is the price of any swap here, so it is not repeated on every row.</>
                  )}
                </p>
                <ul className="space-y-1.5">
                  {sorted.map((alt, i) => {
                    const c = courses.get(alt.courseId);
                    if (!c) return null;
                    const pos = posOf(alt.courseId);
                    return (
                      <li key={alt.courseId}>
                        <button
                          onClick={() => onChoose(alt.courseId)}
                          className="w-full rounded-xl border border-border p-2.5 text-left transition-all hover:border-[var(--blue)] hover:bg-[var(--blue-soft)]"
                        >
                          <span className="flex flex-wrap items-baseline gap-2">
                            <span
                              className={`tabular shrink-0 rounded px-1.5 text-[11px] font-semibold ${i === 0 ? "text-white" : "text-muted-foreground"}`}
                              style={i === 0 ? { background: "var(--blue)" } : { background: "var(--foreground)/0.06" }}
                            >
                              #{i + 1}
                            </span>
                            <span className="text-sm font-medium">{c.title}</span>
                            <span className="code text-xs">{c.code}</span>
                            <WhatIsIt course={c} align="right" />
                            {i === 0 && (
                              <span className="rounded-full px-2 text-[10px] font-medium"
                                    style={{ background: "color-mix(in oklab, var(--teal) 14%, transparent)", color: "var(--teal)" }}>
                                best alternative
                              </span>
                            )}
                            {alt.sameClass && (
                              <span className="rounded-full bg-foreground/5 px-2 text-[10px] text-muted-foreground">
                                same on every count
                              </span>
                            )}
                            <span className="tabular ml-auto text-xs text-muted-foreground">
                              {pos != null
                                ? pos < (shortlistCount ?? consideredTotal)
                                  ? `reader's pick ${pos + 1} of ${consideredTotal}`
                                  : `closeness rank ${pos + 1} of ${consideredTotal}`
                                : consideredTotal > 0 ? "not ranked for this job" : ""}
                              {" · "}{creditNote(alt)}
                            </span>
                          </span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {(() => {
                              const why = whyOf(alt.courseId, placement.covers.map((x) => x.skill));
                              const gains = alt.deltaSkills.length
                                ? `Also answers ${listOf(alt.deltaSkills)}, which ${chosenCode} does not. `
                                : "";
                              const loss = !sharedLoss && alt.losesSkills.length
                                ? `Drops ${listOf(alt.losesSkills)}. `
                                : "";
                              const ranked = whyConsidered?.(alt.courseId);
                              const own = why
                                ?? (pos != null
                                  ? pos < (shortlistCount ?? 0)
                                    ? `Made the reader's shortlist at spot ${pos + 1} for this posting, but on the full read its text answered no specific line of it; it outranks the rows below on that shortlisting alone.`
                                    : ranked
                                      ? `Never shortlisted, but ${ranked}; that is what places it here.`
                                      : `Its catalog entry shares nothing with this posting; it fits the degree slot only.`
                                  : consideredTotal > 0
                                    ? `It fits the degree slot; the posting never asked for it.`
                                    : "");
                              return `${gains}${loss}${own}`.trim() || "Fits the same requirement for the same credits; nothing in the posting separates them.";
                            })()}
                          </span>
                          {alt.stopsSatisfying.length > 0 && (
                            <span className="mt-1 block text-xs" style={{ color: "var(--amber-deep, #92400e)" }}>
                              This one leaves {listOf(alt.stopsSatisfying)} short, so something else has to
                              cover it.
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="mx-auto max-w-[600px] px-6 py-28 text-center">
      <h1 className="font-display text-3xl font-semibold">No plan yet</h1>
      <p className="mx-auto mt-3 max-w-sm text-muted-foreground">
        Answer a few questions and this page fills with the exact courses to take, and when.
      </p>
      <Link href="/" className="mt-7 inline-flex items-center gap-2 rounded-full bg-[var(--blue)] px-7 py-4 text-lg text-white glow-hover">
        Start <ArrowRight className="h-5 w-5" />
      </Link>
    </div>
  );
}

/**
 * The credits the degree leaves open.
 *
 * This is the most valuable part of the page and it spent a while being the
 * least visible. The required core is the same for everybody: a computer
 * science degree makes you take data structures whatever job you are chasing.
 * These free credits are the only place the plan can actually respond to the
 * posting, so a course put here because it answers the job should be as loud as
 * anything else on the page, and it should say what it answers and quote the
 * line that proves it right there, not behind a disclosure.
 *
 * Courses that answer nothing are still listed, because a semester with a hole
 * in it is not a plan, but they are visibly the quiet ones.
 */
function OpenSlot({ fill, courses, revealCourse, jobParts, consideredTotal, whyConsidered }: {
  fill?: FilledTerm;
  courses: Map<string, Course>;
  /** How many parts of the job exist, so "answers 2 of 5" has a denominator. */
  jobParts: number;
  /** how many courses were ranked for this posting, catalog wide */
  consideredTotal: number;
  /** why a course sits where it sits in that ranking */
  whyConsidered?: (id: string) => string | null;
  /** A course the page is jumping to; if it is one of the quiet ones, unfold them. */
  revealCourse?: string | null;
}) {
  const [showFiller, setShowFiller] = useState(false);
  useEffect(() => {
    if (revealCourse && fill?.picks.some((p) => p.courseId === revealCourse && !p.teaches.length)) {
      setShowFiller(true);
    }
  }, [revealCourse, fill]);
  if (!fill) return null;
  void courses;
  const matched = fill.picks.filter((p) => p.teaches.length);
  const filler = fill.picks.filter((p) => !p.teaches.length);

  return (
    <div className="rounded-xl border border-dashed plan-edge plan-wash p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm font-medium">Free electives and core curriculum</p>
        <span className="tabular text-xs text-muted-foreground">
          {fill.creditsNeeded} credits the degree lets you choose
          {fill.shortfall > 0 && `, ${fill.shortfall} still open`}
        </span>
        {matched.length > 0 && (
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: "color-mix(in oklab, var(--teal) 14%, transparent)", color: "var(--teal)" }}>
                        {matched.length} spent on this job
          </span>
        )}
      </div>

      {!fill.picks.length ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Nothing in this catalog runs this semester with prerequisites you will have, so these are
          yours to choose with an advisor.
        </p>
      ) : (
        <>
          {matched.length > 0 && (
            <ul className="mt-2 space-y-2">
              {matched.map((o) => {
                const glow = o.teaches.length >= 3 ? "match-3" : o.teaches.length === 2 ? "match-2" : "match-1";
                return (
                  <li key={o.courseId} id={`course-${o.courseId}`} className={`${glow} scroll-mt-6 rounded-lg border bg-white p-2.5`}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold">{o.title}</span>
                      <WhatIsIt course={courses.get(o.courseId)} />
                      <span className="code text-[11px]">{o.code}</span>
                      <span className="rounded px-1.5 text-[10px] font-medium"
                            style={{ background: "color-mix(in oklab, var(--teal) 14%, transparent)", color: "var(--teal)" }}>
                        answers {o.teaches.length} of {jobParts}
                        {o.strength === "central" ? ", closely" : o.strength === "tangential" ? ", loosely" : ""}
                      </span>
                      {o.consideredPos != null && consideredTotal > 0 && (
                        <span className="tabular rounded px-1.5 text-[10px] text-muted-foreground"
                              style={{ background: "var(--foreground)/0.05" }}>
                          reader&rsquo;s pick {o.consideredPos + 1} of {consideredTotal}
                        </span>
                      )}
                      <span className="tabular ml-auto text-[11px] text-muted-foreground">{o.credits} cr</span>
                    </div>
                    <p className="mt-1 text-xs">
                      Chosen for this slot because it answers{" "}
                      <strong style={{ color: "var(--teal)" }}>{o.teaches.join(", ")}</strong>, which
                      the posting asked for.
                    </p>
                    {o.evidence && (
                      <p className="mt-1 border-l-2 pl-2 text-xs italic leading-snug text-muted-foreground"
                         style={{ borderColor: "var(--teal)" }}>
                        The catalog says: &ldquo;{o.evidence}&rdquo;
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {filler.length > 0 && (
            <>
              <button
                onClick={() => setShowFiller((v) => !v)}
                aria-expanded={showFiller}
                className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
              >
                <span>
                  {filler.length} more course{filler.length === 1 ? "" : "s"} to complete the semester,
                  answering nothing the posting asked for
                </span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${showFiller ? "rotate-180" : ""}`} />
              </button>
              {showFiller && (
                <ul className="fade-up mt-1 space-y-1">
                  {filler.map((o) => (
                    <li key={o.courseId} id={`course-${o.courseId}`}
                        className="scroll-mt-6 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="min-w-0 font-medium">{o.title}</span>
                        <WhatIsIt course={courses.get(o.courseId)} />
                        <span className="code text-[10px]">{o.code}</span>
                        <span className="rounded px-1.5 text-[10px] text-muted-foreground"
                              style={{ background: "var(--foreground)/0.05" }}>
                          {o.consideredPos != null && consideredTotal > 0
                            ? `elective rank ${o.consideredPos + 1} of ${consideredTotal} considered`
                            : "not weighed for this posting"}
                        </span>
                        {o.fillerPool ? (
                          <span className="tabular text-[10px] text-muted-foreground">
                            best of {o.fillerPool} available for this slot
                          </span>
                        ) : null}
                        <span className="tabular ml-auto text-[10px] text-muted-foreground">{o.credits} cr</span>
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                        {o.fillerReason
                          ? `The closest remaining match: of the ${o.fillerPool ?? "other"} courses that could take this slot it came first because ${o.fillerReason}.`
                          : "Every course in the catalog was ranked against your posting and this one answers none of it outright. It is here to complete the credits."}
                        {(() => {
                          const w = whyConsidered?.(o.courseId);
                          return w ? ` Its rank comes from the text: ${w}.` : "";
                        })()}
                      </span>
                    </li>
                  ))}
                  <li className="px-1 pt-1 text-[11px] leading-relaxed text-muted-foreground">
                    No course left in this semester answers a part of the posting outright, so
                    these are the <strong>closest remaining matches</strong>: filled from the top of
                    the reader&rsquo;s ranked list for your posting, and only past the end of that
                    list by spreading across subjects. Each row carries its rank and its reason.
                    Swap any of them for whatever your core curriculum actually needs.
                  </li>
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
