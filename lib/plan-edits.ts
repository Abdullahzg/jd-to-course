import type { Course, PrereqNode, Term } from "@/lib/types";
import { prereqSatisfied } from "@/lib/solver/core";

// ─────────────────────────────────────────────────────────────────────────────
// Where a course may legally go, once a plan is being edited by hand.
//
// Every one of these answers used to be worked out inline in the plan screen
// from "which seasons does the catalog run this in", and that is not the same
// question. It cost two separate wrong fixes that a student pressed and was
// then blamed for:
//
//   - "Add COMS W3134 to Fall 2026" to repair a missing prerequisite, when
//     Fall 2026 is in front of the Programming in Java that COMS W3134 itself
//     requires. The panel went on complaining, now about the course it had
//     just told the student to add.
//   - Seven "Move to ..." buttons for a course stranded in front of its own
//     prerequisite, the first of which moved it EARLIER. Six of the seven
//     changed nothing at all.
//
// A term is only a real answer if the course's own prerequisites are behind
// it. That is the whole of what this file exists to enforce, and it is tested
// in scripts/solver-test.ts, which runs on every build.
// ─────────────────────────────────────────────────────────────────────────────

/** The board as a hand edit sees it: what sits where, and what is already done. */
export type BoardView = {
  courses: Map<string, Course>;
  /** courseId -> term index, including courses filling the open credits */
  termOf: Map<string, number>;
  completed: Set<string>;
  termKinds: Term[];
};

/** Everything on the board strictly before `term`, plus everything finished. */
function have(b: BoardView, term: number, ignore?: string): Set<string> {
  const s = new Set<string>(b.completed);
  for (const [id, t] of b.termOf) if (id !== ignore && t < term) s.add(id);
  return s;
}

/**
 * The first semester before `beforeTerm` that runs `course` AND has its
 * prerequisites behind it. -1 when the horizon has no such semester, which is
 * a real answer: it means adding the course cannot settle anything on its own.
 */
export function earliestLegalTerm(course: Course, beforeTerm: number, b: BoardView): number {
  for (let k = 0; k < beforeTerm && k < b.termKinds.length; k++) {
    if (!course.termsOffered.includes(b.termKinds[k])) continue;
    if (prereqSatisfied(course.prereq, have(b, k, course.id))) return k;
  }
  return -1;
}

/**
 * Every semester `courseId` could move to that actually resolves it. Excludes
 * where it already is, and any semester the catalog does not run it in.
 */
export function legalMoves(courseId: string, b: BoardView): number[] {
  const c = b.courses.get(courseId);
  if (!c) return [];
  const out: number[] = [];
  for (let k = 0; k < b.termKinds.length; k++) {
    if (b.termOf.get(courseId) === k) continue;
    if (!c.termsOffered.includes(b.termKinds[k])) continue;
    if (prereqSatisfied(c.prereq, have(b, k, courseId))) out.push(k);
  }
  return out;
}

/**
 * The third shape a prerequisite failure takes: the course it needs IS on the
 * board, just not early enough — including the case of sitting in the very
 * same semester, which a prerequisite may not do. Nothing can be added and
 * nothing un-excluded to settle it; one of the two has to move, so the useful
 * thing to report is which other course, and where it currently sits.
 */
export function latePrereq(courseId: string, b: BoardView): { course: Course; term: number } | null {
  const c = b.courses.get(courseId);
  const here = b.termOf.get(courseId);
  if (!c?.prereq || here == null) return null;
  const before = have(b, here, courseId);
  if (prereqSatisfied(c.prereq, before)) return null;

  const find = (node: PrereqNode | null): string | null => {
    if (!node) return null;
    if (node.op === "COURSE") {
      const t = b.termOf.get(node.courseId);
      return t != null && t >= here ? node.courseId : null;
    }
    if (node.op === "UNVERIFIABLE") return null;
    if (node.op === "AND") {
      for (const ch of node.children) { const m = find(ch); if (m) return m; }
      return null;
    }
    if (node.op === "OR") {
      // An OR is only unmet if no branch is met; then any unmet branch explains it.
      if (node.children.some((ch) => prereqSatisfied(ch, before))) return null;
      for (const ch of node.children) { const m = find(ch); if (m) return m; }
      return null;
    }
    return null;
  };

  const lateId = find(c.prereq);
  const late = lateId ? b.courses.get(lateId) : null;
  const term = late ? b.termOf.get(late.id) : null;
  return late && term != null ? { course: late, term } : null;
}

/**
 * The student, as a brand new posting should see them.
 *
 * `excluded` and `locked` describe edits to ONE timetable: a course dropped out
 * of it, a course pinned inside it. They used to travel to every later posting,
 * and because the solver bans every excluded course outright, a single drop
 * hours earlier quietly banned that course for good. A fresh Machine Learning
 * posting opened already broken -- Fundamentals of Computer Systems had been
 * dropped while looking at a different job, so Computer Science core could no
 * longer be completed -- and the panel blamed the student for a removal they
 * had made against a plan they had already left behind.
 *
 * What the student IS carries over, because it is true of them whatever they
 * are applying for: their programme, when they start, how long they have, and
 * what they have already passed. What they did to a previous timetable does not.
 */
export function studentForNewPosting<T extends {
  excluded: string[];
  locked: { courseId: string; term: number }[];
}>(student: T): T {
  return { ...student, excluded: [], locked: [] };
}
