import type { Course, Plan, Program, Term } from "@/lib/types";
import { prereqSatisfied } from "@/lib/solver/core";

// ─────────────────────────────────────────────────────────────────────────────
// THE CRITERIA LIST.
//
// A plan you cannot check is a plan you have to take on trust, and nobody
// should take a degree plan on trust. Every rule the plan is supposed to obey
// is written out here as a check that either passes or fails, and it is run
// against the finished plan rather than asserted while building it. If the
// solver were wrong, this is what would catch it, because it re-derives the
// answer from the catalog instead of believing the solver's own bookkeeping.
//
// The same list runs in the test suite and on screen. There is no version of
// the truth that only the developer sees.
// ─────────────────────────────────────────────────────────────────────────────

export type Check = {
  id: string;
  /** what must be true, in plain words */
  rule: string;
  passed: boolean;
  /** the numbers behind the verdict, so it can be argued with */
  detail: string;
  /** courses or requirements involved, when something failed */
  offenders: string[];
};

export type Verification = {
  checks: Check[];
  passed: number;
  failed: number;
};

export function verifyPlan(
  plan: Plan,
  program: Program,
  courses: Map<string, Course>,
  completed: string[],
  termKinds: Term[],
): Verification {
  const checks: Check[] = [];
  const add = (id: string, rule: string, passed: boolean, detail: string, offenders: string[] = []) =>
    checks.push({ id, rule, passed, detail, offenders });

  const placed = plan.placements;
  const done = new Set(completed);

  // 1. every requirement met
  const unmet = plan.buckets.filter((b) => !b.satisfied);
  add(
    "requirements",
    "Every requirement of the degree is satisfied",
    unmet.length === 0,
    unmet.length === 0
      ? `all ${plan.buckets.length} requirements met`
      : `${unmet.length} of ${plan.buckets.length} not met`,
    unmet.map((b) => `${b.label}: has ${b.fromCompleted + b.fromPlan} of ${b.need}`),
  );

  // 2. no course twice
  const ids = placed.map((p) => p.courseId);
  const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
  add("no-duplicates", "No course appears twice", dupes.length === 0,
    `${ids.length} courses, ${new Set(ids).size} distinct`, dupes);

  // 3. nothing you already passed
  const retakes = ids.filter((id) => done.has(id));
  add("no-retakes", "Nothing you have already passed is planned again", retakes.length === 0,
    `${completed.length} courses already done`, retakes);

  // 4. credit cap
  const over = plan.termCredits
    .map((c, t) => ({ c, t }))
    .filter((x) => x.c > program.maxCreditsPerTerm);
  add("credit-cap", `No semester goes over the ${program.maxCreditsPerTerm} credit limit`,
    over.length === 0,
    `heaviest semester is ${Math.max(0, ...plan.termCredits)} credits`,
    over.map((x) => `semester ${x.t + 1}: ${x.c} credits`));

  // 5. offered when planned
  const badTerm = placed.filter((p) => {
    const c = courses.get(p.courseId);
    return c ? !c.termsOffered.includes(termKinds[p.term]) : false;
  });
  add("offered", "Every course is placed in a semester it is actually offered",
    badTerm.length === 0,
    `${placed.length} placements checked`,
    badTerm.map((p) => p.courseId));

  // 6. prerequisites, re-derived from the catalog
  const badPrereq = placed.filter((p) => {
    const c = courses.get(p.courseId);
    if (!c) return false;
    const before = new Set<string>(done);
    for (const q of placed) if (q.term < p.term) before.add(q.courseId);
    return !prereqSatisfied(c.prereq, before);
  });
  add("prereqs", "Every prerequisite is finished before the course that needs it",
    badPrereq.length === 0,
    `${placed.filter((p) => courses.get(p.courseId)?.prereq).length} courses have prerequisites`,
    badPrereq.map((p) => p.courseId));

  // 7. horizon
  const outside = placed.filter((p) => p.term < 0 || p.term >= plan.termCredits.length);
  add("horizon", "Nothing is scheduled past the semesters you have",
    outside.length === 0,
    `${plan.termCredits.length} semesters`, outside.map((p) => p.courseId));

  // 8. single counting
  const byBucket = new Map<string, string[]>();
  for (const p of placed) {
    if (p.bucketId === "SUPPORT") continue;
    byBucket.set(p.bucketId, [...(byBucket.get(p.bucketId) ?? []), p.courseId]);
  }
  const counted = [...byBucket.values()].flat();
  add("single-count", "No course is used to satisfy two different requirements",
    new Set(counted).size === counted.length,
    `${counted.length} courses counted toward requirements`,
    counted.filter((x, i) => counted.indexOf(x) !== i));

  // 9. citations
  const uncited = plan.buckets.filter((b) => !b.source?.url || !b.source?.quote);
  add("citations", "Every requirement links to the catalog page it came from",
    uncited.length === 0,
    `${plan.buckets.length} requirements, all quoted from the bulletin`,
    uncited.map((b) => b.label));

  // 10. full-time floor, reported rather than enforced
  const light = plan.belowFullTime ?? [];
  add("full-time", `Every semester reaches the ${program.minCreditsPerTerm} credit full-time minimum`,
    light.length === 0,
    light.length === 0
      ? "all semesters reach it once your other courses are counted"
      : `${light.length} semester(s) fall short even with your other courses`,
    light.map((t) => `semester ${t + 1}`));

  return {
    checks,
    passed: checks.filter((c) => c.passed).length,
    failed: checks.filter((c) => !c.passed).length,
  };
}

/** The concrete Fall/Spring sequence for a horizon, so checks can use it. */
export function termKindsFor(startTerm: Term, n: number): Term[] {
  const out: Term[] = [];
  let t = startTerm;
  for (let i = 0; i < n; i++) {
    out.push(t);
    t = t === "FA" ? "SP" : "FA";
  }
  return out;
}
