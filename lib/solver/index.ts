import type {
  BucketStatus, Counterfactual, CoverageReport, Infeasibility, Placement, Plan,
  Relaxation, SlotChoice, SolveRequest, SolveResponse, Course, Term,
} from "@/lib/types";
import { getProgram, getSchool } from "@/data";
import { termKindsFor } from "@/lib/verify";
import {
  buildModel, collectUnverifiable, neededFor, popcount, prereqSatisfied, search, W_CREDIT, W_SKILL, W_TERM,
  type Model, type Selection,
} from "./core";
import { isExperienceRequirement, skillKey } from "@/lib/skills";

// Raised when the catalog grew from 47 courses to 139 and the CS elective pool
// from 34 to 79. The search space is much larger now, and four seconds was
// enough of the time to run out mid-search on a loaded machine.
const DEFAULT_BUDGET_MS = 12000;

const norm = (s: string) => skillKey(s);

export function solve(req: SolveRequest, budgetMs = DEFAULT_BUDGET_MS, nodeLimit = 400_000): SolveResponse {
  const t0 = Date.now();
  const school = getSchool(req.schoolId);
  const program = getProgram(req.schoolId, req.programId);

  if (!school || !program) {
    return {
      ok: false, plans: [], coverage: null, counterfactuals: [],
      infeasibility: {
        message: "That school and program combination isn't in the catalog yet.",
        blockingBuckets: [], suggestions: [],
      },
      stats: { nodesExplored: 0, ms: 0, provedOptimal: false, candidateCourses: 0, symmetryClasses: 0 },
    };
  }

  const model = buildModel(school, program, req.student, req.targetSkills, req.relax ?? {}, req.skillMatches ?? {}, req.relevance ?? {}, req.centrality ?? {});
  const k = Math.max(1, Math.min(req.k ?? 3, 5));

  const candidateCourses = new Set(model.buckets.flatMap((b) => b.pool)).size;
  const symmetryClasses = model.buckets.reduce((s, b) => s + b.classes.length, 0);

  // ── K-best (§7.2): solve, forbid that exact course set, solve again. ───────
  const forbidden: Set<string>[] = [];
  const selections: Selection[] = [];
  let nodes = 0;
  let provedOptimal = false;
  /** Did the very first search finish looking, or simply run out of clock? */
  let searchExhausted = true;
  const deadline = t0 + budgetMs;

  for (let i = 0; i < k; i++) {
    const perPlan = Math.max(400, Math.floor((deadline - Date.now()) / Math.max(1, k - i)));
    const r = search(model, forbidden, Math.min(deadline, Date.now() + perPlan), nodeLimit);
    if (i === 0) searchExhausted = r.exhausted;
    nodes += r.nodes;
    if (i === 0) provedOptimal = r.provedOptimal;
    if (!r.best) break;
    selections.push(r.best);
    // The cut has to match what search() compares against: the job answering
    // subset when the posting names one, the whole set otherwise.
    const chosenAll = [...r.best.assignment.keys(), ...r.best.support];
    forbidden.push(new Set(
      model.jobRelevant.size ? chosenAll.filter((id) => model.jobRelevant.has(id)) : chosenAll,
    ));
    if (Date.now() > deadline) break;
  }

  const stats = {
    nodesExplored: nodes,
    ms: Date.now() - t0,
    provedOptimal,
    candidateCourses,
    symmetryClasses,
  };

  if (!selections.length) {
    // Nothing was found. There are two very different reasons for that, and
    // the page used to print the alarming one for both: a student saw "No plan
    // fits in 8 terms" for a computer science degree that plainly fits in
    // eight terms, because the machine was busy and the search was cut off.
    if (!searchExhausted) {
      return {
        ok: false, plans: [], coverage: null,
        counterfactuals: [],
        infeasibility: {
          message: "The search ran out of time before finding a plan, even after an automatic retry with a much larger budget. Nothing here says a plan is impossible, only that it is taking too long to prove. Unpinning a course or adding a semester usually breaks the logjam.",
          blockingBuckets: [],
          suggestions: [],
          timedOut: true,
        },
        stats,
      };
    }
    return {
      ok: false, plans: [], coverage: null,
      counterfactuals: [],
      infeasibility: diagnose(req, model, budgetMs),
      stats,
    };
  }

  const plans = selections.map((s, i) => buildPlan(model, s, i));
  for (let i = 1; i < plans.length; i++) plans[i].diffFromBest = diffPlans(model, plans[0], plans[i]);

  return {
    ok: true,
    plans,
    coverage: buildCoverage(model, plans[0], req.targetSkills),
    counterfactuals: counterfactuals(req, plans[0], budgetMs),
    infeasibility: null,
    stats,
  };
}

// ─────────────────────────── plan rendering ─────────────────────────────────

function buildPlan(m: Model, sel: Selection, index: number): Plan {
  const placements: Placement[] = [];
  const all = new Set<string>([...sel.assignment.keys(), ...sel.support]);

  // The search assigns courses to buckets as it branches, which means a course
  // pulled in to unlock a prerequisite can end up labelled "support" even when
  // it is perfectly eligible for a requirement that another course happened to
  // fill first. Same course set either way — but the student reads the label,
  // so re-credit as many courses to requirements as the slots allow.
  const assignment = maximiseCredit(m, all, sel);

  for (const id of all) {
    const c = m.catalog.get(id)!;
    const term = sel.schedule.termOf.get(id)!;
    const unver = collectUnverifiable(c.prereq);
    const bucketId = assignment.get(id) ?? "SUPPORT";
    placements.push({
      courseId: id,
      term,
      bucketId,
      locked: m.lockedByCourse.has(id),
      needsAdvisorCheck: unver.length > 0 || !c.verified,
      // Only the catalog's own words. The app's "not been reviewed by a human"
      // sentence used to live in this array too, and the page renders every
      // entry inside quotation marks, so the planner appeared to be quoting the
      // bulletin saying its own parse was unreviewed. For 55 of the 139 courses
      // that sentence was the entire quoted content of the box.
      unverifiableText: [...new Set([...unver, ...c.restrictions])],
      /** Whether the prerequisite parse itself has been checked by a person. */
      parseUnreviewed: !c.verified,
      // One row per requirement, counted the way the objective counts it.
      // `covers` was one row per evidence sentence and the reader can return the
      // same course twice, so the "answers N things" badge over-counted and two
      // rows shared a React key.
      covers: [...new Map(
        (m.courseSkills.get(id) ?? c.skills)
          .filter((s) => m.skillIndex.has(norm(s.skill)))
          .map((s) => [norm(s.skill), s] as const),
      ).values()],
      earliestTerm: sel.schedule.earliest.get(id) ?? 0,
      earliestReason: sel.schedule.earliestReason.get(id) ?? "no earlier term is blocked",
      unlocks: bucketId === "SUPPORT" ? unlockedBy(m, id, all) : [],
    });
  }
  placements.sort((a, b) => a.term - b.term || a.courseId.localeCompare(b.courseId));

  const buckets: BucketStatus[] = m.buckets.map((b) => {
    const source = m.program.buckets.find((x) => x.id === b.id)!.source;
    let fromPlan = 0;
    for (const p of placements) {
      const counts = p.bucketId === b.id ||
        (b.doubleCountWith.has(p.bucketId) && b.pool.includes(p.courseId));
      if (counts) fromPlan += b.unit === "credits" ? (m.catalog.get(p.courseId)?.credits ?? 0) : 1;
    }
    return {
      bucketId: b.id,
      label: b.label,
      need: b.need,
      unit: b.unit,
      fromCompleted: b.fromCompleted,
      fromCompletedCourses: b.fromCompletedCourses,
      fromPlan: Math.min(fromPlan, b.need - b.fromCompleted),
      satisfied: b.fromCompleted + fromPlan >= b.need,
      source,
      eligibleCount: b.eligibleCount,
      allowDoubleCount: [...b.doubleCountWith],
    };
  });

  const skillsCovered = m.skills.filter((_, i) => (sel.skillMask >> i) & 1);

  return {
    id: `plan-${index}`,
    label: `Plan ${String.fromCharCode(65 + index)}`,
    placements,
    buckets,
    termCredits: sel.schedule.termCredits,
    openCreditsNeeded: sel.schedule.openCreditsNeeded,
    belowFullTime: sel.schedule.belowFullTime,
    minTermsRequired: m.minTermsRequired,
    objective: sel.objective,
    skillsCovered,
    totalCredits: sel.credits,
    termsUsed: sel.schedule.termsUsed,
    slotChoices: slotChoices(m, sel, assignment),
    diffFromBest: index === 0 ? "" : "",
  };
}

/**
 * Re-credit the chosen course set to requirement slots, filling as many as the
 * needs allow (Kuhn's augmenting paths). The course set and the objective are
 * untouched — this only decides which course gets named against which rule.
 */
function maximiseCredit(m: Model, all: Set<string>, sel: Selection): Map<string, string> {
  const slots: string[] = [];
  for (const b of m.buckets) {
    const n = b.unit === "credits" ? Math.ceil(b.remaining / 3) : b.remaining;
    for (let i = 0; i < n; i++) slots.push(b.id);
  }
  const eligibleOf = new Map(m.buckets.map((b) => [b.id, new Set(b.pool)]));
  const slotMatch: (string | null)[] = new Array(slots.length).fill(null);

  const augment = (id: string, visited: Set<number>): boolean => {
    for (let si = 0; si < slots.length; si++) {
      if (visited.has(si) || !eligibleOf.get(slots[si])!.has(id)) continue;
      visited.add(si);
      if (slotMatch[si] === null || augment(slotMatch[si]!, visited)) {
        slotMatch[si] = id;
        return true;
      }
    }
    return false;
  };

  // Courses eligible for fewest buckets go first — they have the least choice.
  const ids = [...all].sort((a, b) => {
    const na = m.buckets.filter((x) => eligibleOf.get(x.id)!.has(a)).length;
    const nb = m.buckets.filter((x) => eligibleOf.get(x.id)!.has(b)).length;
    return na - nb;
  });
  for (const id of ids) augment(id, new Set());

  const out = new Map<string, string>();
  for (let si = 0; si < slots.length; si++) {
    if (slotMatch[si]) out.set(slotMatch[si]!, slots[si]);
  }
  // A course the matching couldn't seat keeps whatever the search decided,
  // so we never lose an assignment the matching simply had no slot for.
  for (const [id, bid] of sel.assignment) if (!out.has(id)) out.set(id, bid);

  // This matching is one-course-one-slot; it cannot express a course that
  // counts twice. Columbia's bulletin explicitly lets MATH UN2015 satisfy both
  // linear algebra and probability, and the search uses that to free a course
  // for the elective requirement — a labelling that spends two courses there
  // instead leaves the elective short. Relabelling is cosmetic, so if it
  // degrades any requirement, keep what the search decided.
  if (!allSatisfied(m, out)) return new Map(sel.assignment);
  return out;
}

function allSatisfied(m: Model, assignment: Map<string, string>): boolean {
  for (const b of m.buckets) {
    let have = b.fromCompleted;
    for (const [courseId, bucketId] of assignment) {
      const counts =
        bucketId === b.id ||
        (b.doubleCountWith.has(bucketId) && b.pool.includes(courseId));
      if (counts) have += b.unit === "credits" ? (m.catalog.get(courseId)?.credits ?? 0) : 1;
    }
    if (have < b.need) return false;
  }
  return true;
}

/** Which planned courses this one unlocks — the reason it is in the plan. */
function unlockedBy(m: Model, id: string, all: Set<string>): string[] {
  const out: string[] = [];
  for (const other of all) {
    if (other === id) continue;
    const c = m.catalog.get(other);
    if (!c?.prereq) continue;
    const mentions = (n: unknown): boolean => {
      const node = n as { op?: string; courseId?: string; children?: unknown[] };
      if (!node) return false;
      if (node.op === "COURSE") return node.courseId === id;
      return (node.children ?? []).some(mentions);
    };
    if (mentions(c.prereq)) out.push(c.code);
  }
  return out;
}

/**
 * §9.3. Where a requirement has several legal fillers, the interface asks
 * instead of pretending.
 *
 * Both directions of the swap are measured. The old version computed only what
 * an alternative would ADD, so a course answering nothing about the posting
 * came back with an empty gains list, and the page rendered that with the copy
 * meant for a proved tie. On a product manager posting, Operating Systems I and
 * Graph Theory were both offered as "just as good for this job" against a
 * course that answered one of the five things the posting asked for.
 */
function slotChoices(m: Model, sel: Selection, assignment: Map<string, string>): SlotChoice[] {
  const out: SlotChoice[] = [];
  const planned = new Set<string>([...sel.assignment.keys(), ...sel.support]);

  /** The job parts one course proves it teaches, by canonical name. */
  const partsOf = (id: string): string[] => {
    const c = m.catalog.get(id);
    return [
      ...new Set(
        (m.courseSkills.get(id) ?? c?.skills ?? [])
          .filter((s) => m.skillIndex.has(norm(s.skill)))
          .map((s) => s.skill),
      ),
    ];
  };

  const contributes = (id: string, bid: string, b: (typeof m.buckets)[number]) =>
    bid === b.id || (b.doubleCountWith.has(bid) && b.pool.includes(id));

  for (const [courseId, bucketId] of assignment) {
    const bucket = m.buckets.find((b) => b.id === bucketId);
    if (!bucket) continue;
    const klass = bucket.classes.find((k) => k.members.includes(courseId));
    if (!klass) continue;

    const chosenParts = partsOf(courseId);
    const chosenSet = new Set(chosenParts);
    const chosenCredits = m.catalog.get(courseId)?.credits ?? 0;

    // What the REST of the plan answers, so a loss can be reported as a real
    // loss only when nothing else already covers it.
    const coveredElsewhere = new Set<string>();
    for (const id of planned) {
      if (id === courseId) continue;
      for (const p of partsOf(id)) coveredElsewhere.add(p);
    }

    /**
     * Whether putting this one course in leaves any requirement short.
     *
     * Comparing the two courses' credit lines cannot see a requirement the
     * chosen course was covering twice, and cannot see one the student has
     * already finished, so it called a swap free that costs a whole course.
     */
    const shortIfSwapped = (memberId: string): string[] => {
      const short: string[] = [];
      for (const b of m.buckets) {
        let have = b.fromCompleted;
        for (const [id, bid] of assignment) {
          const use = id === courseId ? memberId : id;
          if (contributes(use, bid, b)) {
            have += b.unit === "credits" ? (m.catalog.get(use)?.credits ?? 0) : 1;
          }
        }
        if (have < b.need) short.push(b.label);
      }
      return short;
    };

    /** Prerequisites this one needs that the rest of the plan does not supply. */
    const prereqCost = (memberId: string): number => {
      const have = new Set([...planned].filter((x) => x !== courseId));
      for (const id of m.completed) have.add(id);
      const need = neededFor(m.catalog.get(memberId)?.prereq ?? null, have, m.catalog);
      if (!need) return 0;
      return [...need].reduce((n, id) => n + (m.catalog.get(id)?.credits ?? 0), 0);
    };

    const build = (memberId: string, sameClass: boolean) => {
      const theirs = partsOf(memberId);
      const theirSet = new Set(theirs);
      const losesSkills = chosenParts.filter((p) => !theirSet.has(p));
      return {
        courseId: memberId,
        rank: m.courseRank.get(memberId),
        deltaSkills: theirs.filter((p) => !chosenSet.has(p)),
        losesSkills,
        lossesNoOtherPlannedCourseAnswers: losesSkills.filter((p) => !coveredElsewhere.has(p)),
        deltaCredits: (m.catalog.get(memberId)?.credits ?? 0) - chosenCredits,
        extraPrereqCredits: prereqCost(memberId),
        stopsSatisfying: shortIfSwapped(memberId),
        sameClass,
      };
    };

    const alternatives: SlotChoice["alternatives"] = [];
    // Proved interchangeable first. These are the only ones that may ever be
    // described to a student as an equal choice.
    for (const member of klass.members) {
      if (member === courseId || planned.has(member)) continue;
      alternatives.push(build(member, true));
    }
    // Then genuinely different courses, with both directions of the trade.
    for (const other of bucket.classes) {
      if (other.key === klass.key) continue;
      const member = other.members.find((x) => !planned.has(x));
      if (!member) continue;
      alternatives.push(build(member, false));
    }

    // Show the ties first, then the swaps that cost least. A swap that drags in
    // three prerequisite courses is not cheaper than one that drags in none.
    // Best first, by the judge's own order once ties on the hard facts are
    // broken. Six alternatives that all answer nothing used to arrive in
    // arbitrary order wearing identical sentences, which is a list, not a
    // recommendation.
    alternatives.sort((a, b) =>
      Number(b.sameClass) - Number(a.sameClass) ||
      b.deltaSkills.length - a.deltaSkills.length ||
      a.losesSkills.length - b.losesSkills.length ||
      (a.rank ?? 999) - (b.rank ?? 999) ||
      (a.deltaCredits + a.extraPrereqCredits) - (b.deltaCredits + b.extraPrereqCredits),
    );

    if (alternatives.length >= 1) {
      out.push({
        bucketId,
        term: sel.schedule.termOf.get(courseId) ?? 0,
        chosen: courseId,
        alternatives: alternatives.slice(0, 6),
      });
    }
  }
  return out;
}

function diffPlans(m: Model, a: Plan, b: Plan): string {
  const setA = new Set(a.placements.map((p) => p.courseId));
  const setB = new Set(b.placements.map((p) => p.courseId));
  const added = [...setB].filter((x) => !setA.has(x));
  const removed = [...setA].filter((x) => !setB.has(x));
  // A code on its own tells the student nothing. Name the course.
  const name = (id: string) => {
    const c = m.catalog.get(id);
    return c ? `${c.title} (${c.code})` : id;
  };

  if (!added.length && !removed.length) {
    return "Same courses, different terms.";
  }
  const parts: string[] = [];
  if (added.length) parts.push(`${added.map(name).join(", ")} instead of ${removed.map(name).join(", ") || "nothing"}`);
  else parts.push(`drops ${removed.map(name).join(", ")}`);

  const skillDelta = b.skillsCovered.length - a.skillsCovered.length;
  const creditDelta = b.totalCredits - a.totalCredits;
  const tail: string[] = [];
  if (skillDelta !== 0) tail.push(`${skillDelta > 0 ? "+" : ""}${skillDelta} skill${Math.abs(skillDelta) === 1 ? "" : "s"}`);
  if (creditDelta !== 0) tail.push(`${creditDelta > 0 ? "+" : ""}${creditDelta} cr`);
  return parts.join("") + (tail.length ? ` · ${tail.join(", ")}` : "");
}

// ─────────────────────────── coverage (§8.3) ────────────────────────────────
// Three honest buckets. No percentage anywhere.

/**
 * Every skill the job asked for lands in exactly one of three buckets, and all
 * three speak the JOB's words, not the catalog's.
 *
 * The previous version walked the planned courses and reported whatever the
 * catalog called each skill, while the third bucket reported what the posting
 * called it. So a job asking for "Transformer models", taught by a course whose
 * description says "transformers", appeared as covered under one name and as
 * unteachable under the other. The three counts did not even add up to the
 * number of skills asked for.
 */
function buildCoverage(m: Model, plan: Plan, targetSkills: string[]): CoverageReport {
  const covered: CoverageReport["covered"] = [];
  const availableIfYouSwap: CoverageReport["availableIfYouSwap"] = [];
  const courseworkCannotGive: CoverageReport["courseworkCannotGive"] = [];

  const planIds = new Set(plan.placements.map((p) => p.courseId));

  // Does this course teach the thing the job called `target`?
  const teaches = (courseId: string, target: string) => {
    const c = m.catalog.get(courseId);
    if (!c) return null;
    const wanted = new Set([norm(target), ...(m.skillMatches[target] ?? []).map(norm)]);
    return (m.courseSkills.get(courseId) ?? c.skills).find((s) => wanted.has(norm(s.skill))) ?? null;
  };

  for (const target of m.skills) {
    // 1. Something in the plan already teaches it.
    let hit: { courseId: string; ev: { skill: string; evidence: string; strength?: "central" | "useful" | "tangential"; why?: string; rank?: number } } | null = null;
    for (const p of plan.placements) {
      const ev = teaches(p.courseId, target);
      if (ev) { hit = { courseId: p.courseId, ev }; break; }
    }
    if (hit) {
      const c = m.catalog.get(hit.courseId)!;
      covered.push({
        skill: target,                    // the job's wording
        courseId: c.id,
        courseCode: c.code,
        evidence: hit.ev.evidence,        // the catalog's verbatim sentence
        sourceUrl: c.sourceUrl,
      });
      continue;
    }

    // 2. Some course in the catalog teaches it, so it is a trade, not a wall.
    let best: CoverageReport["availableIfYouSwap"][number] | null = null;
    for (const bucket of m.buckets) {
      for (const candId of bucket.pool) {
        if (planIds.has(candId)) continue;
        const ev = teaches(candId, target);
        if (!ev) continue;
        const cand = m.catalog.get(candId)!;
        const victim = plan.placements.find((p) => p.bucketId === bucket.id);
        const victimCourse = victim ? m.catalog.get(victim.courseId) : undefined;
        const extra = cand.credits - (victimCourse?.credits ?? 0);
        if (!best || extra < best.extraCredits) {
          best = {
            skill: target,
            courseId: cand.id,
            courseCode: cand.code,
            replaces: victim?.courseId ?? "",
            replacesCode: victimCourse?.code ?? "a free elective",
            bucketId: bucket.id,
            extraCredits: victimCourse ? extra : cand.credits,
            evidence: ev.evidence,
          };
        }
      }
    }
    if (best) { availableIfYouSwap.push(best); continue; }

    // 3. Nothing in the catalog teaches it.
    courseworkCannotGive.push({ skill: target, reason: reasonNoCourse(target) });
  }

  for (const s of m.truncatedSkills) {
    courseworkCannotGive.push({
      skill: s,
      reason: "Beyond the 31 skills this run could track. Shorten the job description to include it.",
    });
  }

  return { covered, availableIfYouSwap, courseworkCannotGive };
}

function reasonNoCourse(skill: string): string {
  if (isExperienceRequirement(skill)) {
    return "No course teaches this. It needs a project, research, an internship, or time on the job.";
  }
  // Says what was actually done, and stops there.
  //
  // The old wording, "No course in this catalog names it in its description",
  // was a claim about every full description in the catalog. For a while it was
  // being printed after a pass that had only read the first 320 characters of
  // most of them. The reading is fixed now, but the sentence is still narrowed
  // to what a run can honestly stand behind: this catalog, read against this
  // posting, on this occasion.
  return "Every course description in this catalog was read against your posting and none of them does this. You would pick it up from a project, an internship, or a course this catalog does not carry.";
}

// ─────────────────────────── counterfactuals (§7.3) ─────────────────────────

const RELAXATIONS: { change: string; relax: Relaxation }[] = [
  { change: "Allow one summer term", relax: { allowSummer: true, extraTerms: 1 } },
  { change: "Raise the credit cap by 3", relax: { extraCreditsPerTerm: 3 } },
  { change: "Allow one term beyond your horizon", relax: { extraTerms: 1 } },
];

function counterfactuals(req: SolveRequest, base: Plan, budgetMs: number): Counterfactual[] {
  const out: Counterfactual[] = [];
  const per = Math.max(300, Math.floor(budgetMs / 4));
  for (const { change, relax } of RELAXATIONS) {
    const r = solveOnce({ ...req, k: 1, relax }, per);
    if (!r) {
      out.push({ change, deltaSkills: 0, deltaCredits: 0, deltaTerms: 0, newSkills: [], feasible: false });
      continue;
    }
    const newSkills = r.skillsCovered.filter((s) => !base.skillsCovered.includes(s));
    out.push({
      change,
      deltaSkills: r.skillsCovered.length - base.skillsCovered.length,
      deltaCredits: r.totalCredits - base.totalCredits,
      deltaTerms: r.termsUsed - base.termsUsed,
      newSkills,
      feasible: true,
    });
  }
  return out;
}

function solveOnce(req: SolveRequest, budgetMs: number): Plan | null {
  const school = getSchool(req.schoolId);
  const program = getProgram(req.schoolId, req.programId);
  if (!school || !program) return null;
  const m = buildModel(school, program, req.student, req.targetSkills, req.relax ?? {}, req.skillMatches ?? {}, req.relevance ?? {}, req.centrality ?? {});
  const r = search(m, [], Date.now() + budgetMs);
  if (!r.best) return null;
  return buildPlan(m, r.best, 0);
}

// ─────────────────────────── infeasibility (§7.4) ───────────────────────────
// Never a blank screen. Relax one bucket at a time and name the one that broke.

function diagnose(req: SolveRequest, m: Model, budgetMs: number): Infeasibility {
  const school = getSchool(req.schoolId)!;
  const program = getProgram(req.schoolId, req.programId)!;
  const blocking: Infeasibility["blockingBuckets"] = [];
  const per = Math.max(250, Math.floor(budgetMs / (program.buckets.length + 4)));

  for (const b of program.buckets) {
    const trimmed = {
      ...program,
      buckets: program.buckets.map((x) =>
        x.id === b.id ? { ...x, needCourses: 0, needCredits: undefined } : x,
      ),
    };
    const relaxedModel = buildModel(school, trimmed, req.student, req.targetSkills, req.relax ?? {}, req.skillMatches ?? {}, req.relevance ?? {}, req.centrality ?? {});
    const r = search(relaxedModel, [], Date.now() + per);
    if (r.best) {
      blocking.push({
        bucketId: b.id,
        label: b.label,
        detail: explainBucketBlock(m, b.id),
      });
    }
  }

  const suggestions = RELAXATIONS.map(({ change, relax }) => {
    const p = solveOnce({ ...req, k: 1, relax }, per);
    return p
      ? { change, deltaSkills: p.skillsCovered.length, deltaCredits: p.totalCredits, deltaTerms: p.termsUsed, newSkills: p.skillsCovered, feasible: true }
      : { change, deltaSkills: 0, deltaCredits: 0, deltaTerms: 0, newSkills: [], feasible: false };
  }).filter((s) => s.feasible);

  const terms = req.student.horizonTerms;
  const message = blocking.length
    ? `No plan fits in ${terms} term${terms === 1 ? "" : "s"}. ${blocking.map((b) => b.label).join(" and ")} ${blocking.length > 1 ? "can't" : "can't"} be reached in time.`
    : `No plan fits in ${terms} term${terms === 1 ? "" : "s"}. Even dropping any single requirement doesn't make room. The credit cap and the terms courses are offered are both binding at once.`;

  return { message, blockingBuckets: blocking, suggestions };
}

function explainBucketBlock(m: Model, bucketId: string): string {
  const b = m.buckets.find((x) => x.id === bucketId);
  if (!b) return "This requirement could not be satisfied within the horizon.";
  if (!b.pool.length) {
    return "Every course that satisfies it is either already taken, excluded, or missing from the catalog.";
  }
  const courses = b.pool.map((id) => m.catalog.get(id)!).filter(Boolean) as Course[];
  const springOnly = courses.filter((c) => c.termsOffered.length === 1 && c.termsOffered[0] === "SP");
  const fallOnly = courses.filter((c) => c.termsOffered.length === 1 && c.termsOffered[0] === "FA");
  const deepest = courses.reduce((mx, c) => Math.max(mx, prereqDepth(c, m, 0)), 0);

  if (springOnly.length === courses.length) {
    return `Every remaining option is offered in spring only, and your horizon doesn't contain enough spring terms.`;
  }
  if (fallOnly.length === courses.length) {
    return `Every remaining option is offered in fall only, and your horizon doesn't contain enough fall terms.`;
  }
  if (deepest >= 2) {
    return `Its options sit ${deepest} prerequisites deep, so they can't start until term ${deepest + 1} at the earliest.`;
  }
  return `There isn't room under the ${m.maxCredits}-credit-per-term cap once everything else is placed.`;
}

function prereqDepth(c: Course, m: Model, depth: number): number {
  if (depth > 8 || !c.prereq) return depth;
  const ids: string[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (n.op === "COURSE") ids.push(n.courseId);
    else if (n.children) n.children.forEach(walk);
  };
  walk(c.prereq);
  let mx = depth;
  for (const id of ids) {
    if (m.completed.has(id)) continue;
    const p = m.catalog.get(id);
    if (p) mx = Math.max(mx, prereqDepth(p, m, depth + 1));
  }
  return mx;
}

export { W_SKILL, W_CREDIT, W_TERM };

// ─────────────────────────────────────────────────────────────────────────────
// What to put in the open credits.
//
// The plan used to print "your major does not say which, so this planner leaves
// the choice to you" against the free elective credits, which is a true
// statement and a useless one. The degree does not name these courses, but that
// does not mean every course is equally good: the student is aiming at a
// specific job, and some of the catalog answers it and most does not.
//
// So the same evidence the solver used for the major is turned on the open
// slots. A candidate has to be in the catalog, unplanned, not already taken,
// running that semester, and reachable by then. What ranks it is how many of
// the job's asks its own description proves it teaches.
// ─────────────────────────────────────────────────────────────────────────────

export interface ElectiveOption {
  courseId: string;
  code: string;
  title: string;
  credits: number;
  /** Best strength any of this course's matches carried. */
  strength?: "central" | "useful" | "tangential";
  /** Job asks this course's description proves it teaches. */
  teaches: string[];
  /** The catalog sentence behind the first of those. */
  evidence?: string;
  /** The judge's one line reason for this course. */
  why?: string;
  /** Position in the judge's strongest-first order. Lower is better. */
  rank?: number;
  /** Position in the reader's consideration list for this posting. */
  consideredPos?: number;
  /**
   * Why this course is here when it answers nothing.
   *
   * Filler is chosen by a tiebreak: spread across departments and subjects, and
   * prefer broader courses. That is a real reason but it is not a reason about
   * the student's job, and a page that shows it silently next to courses that
   * were chosen for the job implies otherwise.
   */
  fillerReason?: string;
  /**
   * Where this landed among the courses that could legally have taken the slot.
   *
   * A course that answers nothing about the job still beat some number of other
   * courses to get here, and saying how many turns "we needed a filler" into a
   * claim a student can argue with.
   */
  fillerRank?: number;
  fillerPool?: number;
  /** The catalog's own subject tags, used to keep the filler from all being one subject. */
  subjects: string[];
}

/**
 * How much a course costs for being a specialism, when it answers nothing.
 *
 * A student filling spare credits is better served by a broad course than by a
 * narrow one. System on Chip Platforms is a fine course and a strange thing to
 * hand someone whose plan is about content governance.
 */
function levelCost(code: string): number {
  const num = parseInt(code.replace(/[^0-9]/g, ""), 10) || 0;
  if (num >= 6000) return 14;
  if (num >= 4000) return 9;
  if (num >= 3000) return 4;
  return 0;
}

/**
 * Courses that should never be proposed as a free elective.
 *
 * Two separate problems. Fieldwork, seminars, colloquia and independent study
 * are not courses a planner can put in a slot on a student's behalf: they need
 * an arrangement with a person, and Columbia's own bulletin says fieldwork
 * cannot count toward the major at all. And a one credit orientation seminar
 * padding out a semester is not a plan, it is arithmetic.
 */
/** Words that say nothing about what a course is about. */
const STOP = new Set([
  "introduction", "intro", "advanced", "principles", "fundamentals", "topics",
  "applications", "methods", "analysis", "design", "systems", "science",
  "engineering", "computer", "honors", "with", "from", "into", "their",
]);

/**
 * Departments a computer science student's free credits sensibly go to.
 *
 * These courses are in the catalog because the bulletin's own elective rule
 * lets a handful of them count, not because they belong in every plan. Left
 * unranked, the filler cheerfully spent a software student's spare credits on
 * Bioinformatics of Gene Expression, Computational Solid Mechanics with AI and
 * Deep Learning for Biomedical Signal Processing, which reads on a transcript
 * as a computational biology student who took one software course.
 *
 * They are not banned. They rank below the departments the degree is actually
 * built from, and only appear when nothing better is available that term.
 */
const HOME_DEPARTMENTS = new Set(["COMS", "CSEE", "CSOR", "MATH", "APMA", "STAT", "IEOR", "ENGI", "EECS", "ELEN"]);

const NOT_SCHEDULABLE =
  /fieldwork|seminar|colloqui|independent study|thesis|senior project|research problems|supervised research|internship|teaching practic|tutorial/i;

export function electiveOptions(args: {
  catalog: Course[];
  plan: Plan;
  completed: string[];
  excluded?: string[];
  /** Index of the semester being filled. */
  term: number;
  /** Which season that semester is, so a spring-only course is not suggested for a fall. */
  season: Term;
  relevance?: Record<string, { skill: string; evidence: string; strength?: "central" | "useful" | "tangential"; why?: string; rank?: number }[]>;
  /** What the posting asks for, used when there is no relevance pass to lean on. */
  targetSkills?: string[];
  /** Filler already committed to earlier semesters, so prerequisites chain through it. */
  alreadyFilled?: string[];
  /**
   * Also return courses that answer nothing in the posting.
   *
   * Off by default, because a recommendation should have a reason. On when the
   * caller is filling a semester rather than advising, since the student has to
   * take something and a degree that is 30 credits short is not a plan.
   */
  includeUnmatched?: boolean;
  limit?: number;
}): ElectiveOption[] {
  const { catalog, plan, term, season, relevance = {}, limit = 4 } = args;
  // Same fallback the solver uses: with no key there is no relevance pass, so
  // the catalog's own skill tags stand in rather than the slot going blank.
  const wanted = new Set((args.targetSkills ?? []).map((t) => t.toLowerCase()));

  const placed = new Set(plan.placements.map((p) => p.courseId));
  const done = new Set(args.completed);
  const banned = new Set(args.excluded ?? []);

  // Everything the student will have passed by the time this semester starts,
  // including the filler already committed to earlier semesters. Leaving those
  // out is how Calculus II ended up scheduled a semester after Calculus III.
  const have = new Set(done);
  for (const p of plan.placements) if (p.term < term) have.add(p.courseId);
  for (const id of args.alreadyFilled ?? []) have.add(id);

  // Course ids are namespaced by school. A merged catalog would otherwise let a
  // Columbia plan recommend a BMCC course, which is not a course this student
  // can register for.
  const schoolOf = (id: string) => id.split(":")[0];
  const home = schoolOf(plan.placements[0]?.courseId ?? "");

  const options: ElectiveOption[] = [];
  for (const c of catalog) {
    if (home && schoolOf(c.id) !== home) continue;
    if (placed.has(c.id) || done.has(c.id) || banned.has(c.id)) continue;
    if (NOT_SCHEDULABLE.test(c.title)) continue;
    if (c.credits < 3) continue;

    // A missing prerequisite is not the same as no prerequisite.
    //
    // Rows parsed from the bulletin often have prereq null because the sentence
    // was prose the parser could not turn into course ids, and prereqSatisfied
    // returns true for anything it cannot check. Between them, a filler pass
    // put Machine Learning for Biomolecular and Cellular Applications, a 4000
    // level course, in the first semester of freshman year, next to the class
    // that teaches what a variable is. So level is capped by how far in the
    // student actually is, which is a rule no parse can get wrong.
    const num = parseInt(c.code.replace(/[^0-9]/g, ""), 10) || 0;
    const yearsIn = Math.floor(term / 2);
    if (num >= 4000 && yearsIn < 2) continue;
    if (num >= 3000 && yearsIn < 1) continue;
    if (!c.termsOffered.includes(season)) continue;
    if (!prereqSatisfied(c.prereq, have)) continue;

    const hits = relevance[c.id] ?? c.skills.filter((sk) => wanted.has(sk.skill.toLowerCase()));
    if (!hits.length && !args.includeUnmatched) continue; // no proof it helps, so it is not a recommendation
    options.push({
      courseId: c.id,
      code: c.code,
      title: c.title,
      credits: c.credits,
      teaches: [...new Set(hits.map((h) => h.skill))],
      strength: hits.some((h) => h.strength === "central") ? "central"
        : hits.some((h) => h.strength === "useful") ? "useful"
        : hits.some((h) => h.strength === "tangential") ? "tangential"
        : undefined,
      evidence: hits[0]?.evidence,
      why: hits[0]?.why,
      rank: hits.reduce<number | undefined>((m, h) => (h.rank != null && (m == null || h.rank < m) ? h.rank : m), undefined),
      subjects: [...new Set(c.skills.map((sk) => sk.skill))],
    });
  }

  // The judge returned courses strongest first and that order is the product:
  // when the best course cannot be scheduled, the student is offered the next
  // one down. Sorting by breadth alone offered whichever course claimed the
  // most parts, which is how a stretched three part claim outranked the single
  // best course for the one part that mattered.
  options.sort((a, b) =>
    b.teaches.length - a.teaches.length ||
    (a.rank ?? 999) - (b.rank ?? 999) ||
    a.code.localeCompare(b.code));
  return options.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Actually filling the open credits.
//
// electiveOptions above answers "what could go here". That still left the plan
// showing a dashed box and a number, which is not a plan. This fills the box:
// it walks the semesters in order and commits concrete courses to each one
// until the credits are met, never using the same course twice, never
// scheduling something before its prerequisites, never scheduling a spring
// course in a fall.
//
// These are suggestions and the UI has to say so, because the bulletin does not
// name them. But a suggestion with a course code, a semester and a reason is
// worth something, and an empty box with "12 credits" on it is not.
// ─────────────────────────────────────────────────────────────────────────────

export interface FilledTerm {
  term: number;
  creditsNeeded: number;
  picks: ElectiveOption[];
  /** Credits still unaccounted for after exhausting the catalog. */
  shortfall: number;
}

export function fillOpenCredits(args: {
  catalog: Course[];
  plan: Plan;
  completed: string[];
  excluded?: string[];
  termKinds: Term[];
  relevance?: Record<string, { skill: string; evidence: string; strength?: "central" | "useful" | "tangential"; why?: string; rank?: number }[]>;
  targetSkills?: string[];
  /** courseId -> position in the consideration order, 0 is best. */
  shortlistRank?: Record<string, number>;
  /** Ranks below this came from the reader; at or beyond it, from text closeness. */
  shortlistCount?: number;
}): FilledTerm[] {
  const { catalog, plan, termKinds } = args;
  const taken = new Set<string>();
  // Anything the catalog says cannot be taken alongside a course already in the
  // plan is off the table before ranking even starts.
  const conflicts = overlapGroups(catalog);
  const planned = new Set(plan.placements.map((p) => p.courseId));
  for (const id of planned) for (const other of conflicts.get(id) ?? []) taken.add(other);
  /** What every pick so far already answers, so later semesters keep spreading too. */
  const picked: string[][] = [];
  /** Every pick across every semester, so diversity is judged over the whole plan. */
  const pickedAll: ElectiveOption[] = [];
  /** Filler committed to strictly earlier semesters, so later ones can build on it. */
  const committedBefore = new Set<string>();
  /**
   * The courses the degree and the job already put in the plan.
   *
   * Filler is chosen to bring something the plan does not have, so it has to
   * know what the plan has, and the plan is mostly required courses.
   */
  const requiredSoFar = plan.placements
    .map((pl) => catalog.find((c) => c.id === pl.courseId))
    .filter((c): c is Course => Boolean(c))
    .map((c) => ({
      code: c.code,
      title: c.title,
      subjects: [...new Set(c.skills.map((sk) => sk.skill))],
    }));
  const out: FilledTerm[] = [];

  for (let t = 0; t < plan.termCredits.length; t++) {
    const need = plan.openCreditsNeeded[t] ?? 0;
    if (need <= 0) continue;

    // Ask for more than we need, because the best ones may already be spoken
    // for by an earlier semester.
    const ranked = electiveOptions({
      catalog,
      plan,
      completed: args.completed,
      excluded: [...(args.excluded ?? []), ...taken],
      alreadyFilled: [...committedBefore],
      term: t,
      season: termKinds[t],
      relevance: args.relevance,
      targetSkills: args.targetSkills,
      limit: 40,
    });

    // Anything left over is filled from the rest of the catalog. These carry no
    // "teaches" list, and the UI says plainly that they are there to complete
    // the semester rather than to answer the posting.
    const anything = electiveOptions({
      catalog,
      plan,
      completed: args.completed,
      excluded: [...(args.excluded ?? []), ...taken],
      alreadyFilled: [...committedBefore],
      term: t,
      season: termKinds[t],
      relevance: args.relevance,
      targetSkills: args.targetSkills,
      includeUnmatched: true,
      limit: 120,
    });

    const picks: ElectiveOption[] = [];
    const seenHere = new Set<string>();
    let filled = 0;

    // Ranking by "answers the most requirements" stacked the electives with
    // near-duplicates: for a machine learning posting it would spend every free
    // credit on machine learning, because the fifth machine learning course
    // still scores three. That is not a degree, and it is not what the posting
    // asked for either, since the posting also wanted collaboration, business
    // understanding and a dozen other things.
    //
    // So a course is scored on what it adds that nothing already chosen covers.
    // Once a requirement has a course behind it, a second course answering only
    // that requirement is worth nothing here, and the slot goes to whatever
    // reaches something still unanswered. This is a greedy set cover, and its
    // effect is that the free credits spread across the posting instead of
    // piling onto its loudest word.
    const answered = new Set(plan.skillsCovered.map((s) => s.toLowerCase()));
    for (const p of picked) for (const t of p) answered.add(t.toLowerCase());
    /** How many courses already stand behind each part of the job. */
    const depth = new Map<string, number>();
    for (const s of answered) depth.set(s, (depth.get(s) ?? 0) + 1);
    for (const p of picked) for (const t of p) depth.set(t.toLowerCase(), (depth.get(t.toLowerCase()) ?? 0) + 1);

    for (const pool of [ranked, anything]) {
      for (;;) {
        if (filled >= need) break;
        // Scoring the free credits.
        //
        // This used to be pure set cover: once a part of the job had one course
        // behind it, every other course for that part scored zero and fell
        // through to a diversity tiebreak that charges for being in the same
        // department. So a plan already full of computer science courses
        // penalised the next computer science course, and Cloud Computing,
        // rated central for the job's main part, lost a slot to Introduction to
        // Robotics. Twenty three of twenty five free courses ended up answering
        // nothing at all.
        //
        // A new part of the job is still worth most. But a second course on a
        // part the plan only covers once is worth real points too, especially a
        // strong one, because that is what depth on a resume looks like. What
        // is worth nothing is the fifth course on the same part.
        const STRENGTH: Record<string, number> = { central: 3, useful: 2, tangential: 1 };
        let best: ElectiveOption | null = null;
        let bestScore = 0;
        for (const o of pool) {
          if (seenHere.has(o.courseId) || taken.has(o.courseId)) continue;
          if (filled + o.credits > need + 1) continue;
          const str = STRENGTH[o.strength ?? "useful"] ?? 2;
          let score = 0;
          for (const t of o.teaches) {
            const k = t.toLowerCase();
            const already = depth.get(k) ?? 0;
            // 10 for a part nothing covers, 4 for a second course on it, 1 for
            // a third, nothing after that.
            const room = already === 0 ? 10 : already === 1 ? 4 : already === 2 ? 1 : 0;
            score += room * str;
          }
          if (score > bestScore ||
              (score === bestScore && best && (o.rank ?? 999) < (best.rank ?? 999))) {
            best = o; bestScore = score;
          }
        }
        // Once nothing in the job-relevant pool adds a part of the job that is
        // not already covered, the job-relevant pool is spent. A second course
        // for the same part is not a course chosen for this job, it is filler
        // that happens to be on topic, and calling it the former is how a plan
        // ends up with eight machine learning electives all pointing at one
        // supporting line of the posting.
        if (!best && pool === ranked) break;

        // Nothing left adds anything new, so this is filler, and filler needs
        // its own taste. Ordering by score left the leftovers looking exactly
        // like the targeted picks: a machine learning posting would fill its
        // spare credits with deep learning for biomedical signals and solid
        // mechanics with AI, none of which answered anything, all of which read
        // as "why is this whole degree machine learning". So filler spreads
        // across departments instead, which is what a spare elective is for.
        if (!best) {
          const dept = new Map<string, number>();
          const subject = new Map<string, number>();
          // The required courses count. Counting only the other fillers is how
          // a page ended up telling a student that Intro to Information Science
          // was "the first COMS course in the plan" while two COMS courses sat
          // directly above it in the same semester. The plan is the plan.
          for (const p of [...requiredSoFar, ...picks, ...pickedAll]) {
            dept.set(p.code.split(/\s+/)[0], (dept.get(p.code.split(/\s+/)[0]) ?? 0) + 1);
            for (const sub of p.subjects) subject.set(sub, (subject.get(sub) ?? 0) + 1);
          }
          const eligible = pool.filter((o) =>
            !seenHere.has(o.courseId) && !taken.has(o.courseId) && filled + o.credits <= need + 1);
          if (!eligible.length) break;

          // Diversifying by department alone was not enough, because a catalog
          // this size has a machine learning course in almost every department:
          // machine learning for biomolecular applications, for civil
          // engineering, for environmental science. Spread by department and it
          // still reads as one subject. So the subject tags count too, and a
          // course whose subjects are already all over the plan loses to one
          // that brings something the plan has never seen.
          // Title words count too. A course carrying no catalog skill tags
          // scored as maximally novel under subjects alone, which is how
          // "Comp Solid Mechanics With Ai" and "Deep Learning for Biomedical
          // Signal Processing" kept landing in a plan that was already full of
          // machine learning and answered neither.
          const words = (t: string) =>
            t.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? [];
          const titleWord = new Map<string, number>();
          for (const p of [...requiredSoFar, ...picks, ...pickedAll]) {
            for (const w of words(p.title)) titleWord.set(w, (titleWord.get(w) ?? 0) + 1);
          }
          // The reader's consideration order first, taste second. A course
          // the reader shortlisted for THIS posting and could not pin to a
          // part is still a measured "next best thing"; a course it never
          // considered is filler by taste, and the two must not be shuffled
          // together as if the metric did not exist.
          const consider = (o: ElectiveOption) => args.shortlistRank?.[o.courseId] ?? Number.MAX_SAFE_INTEGER;
          const cost = (o: ElectiveOption) => {
            const d = o.code.split(/\s+/)[0];
            return (
              (dept.get(d) ?? 0) * 2 +
              o.subjects.reduce((n, sub) => n + (subject.get(sub) ?? 0), 0) +
              words(o.title).reduce((n, w) => n + (titleWord.get(w) ?? 0), 0) +
              // A large, flat penalty, so an unrelated department is only
              // reached for once everything sensible has been used up.
              (HOME_DEPARTMENTS.has(d) ? 0 : 50) +
              // And prefer breadth over specialism when a course answers
              // nothing. A student filling spare credits is better served by a
              // broad course than by a narrow one: System-on-Chip Platforms is
              // a fine course and a strange thing to hand someone whose plan is
              // about content governance. Higher catalog numbers are narrower,
              // so they cost more when there is no job reason to take them.
              //
              // This used to divide by 200, which made it almost inert: a
              // 3100 level specialism cost 0.53 against a repeated department
              // worth 2. So Applied Machine Learning kept winning slots in a
              // content governance plan on the grounds that nothing else in
              // the plan covered machine learning, which is novelty for its
              // own sake and precisely the thing that made these plans read as
              // "why is this whole degree about AI". A level is a step, not a
              // gradient, so it is scored as one.
              (o.teaches.length === 0 ? levelCost(o.code) : 0)
            );
          };
          eligible.sort((a, b) =>
            consider(a) - consider(b) || cost(a) - cost(b) || a.code.localeCompare(b.code));
          best = eligible[0];

          // Say what actually won it the slot, out of the things that were
          // weighed. "Adds a subject the plan does not have" was printed next
          // to courses whose every subject was already in the plan, because it
          // was never checked, only assumed.
          const d = best.code.split(/\s+/)[0];
          const newSubjects = best.subjects.filter((sub) => !subject.get(sub));
          const num = parseInt(best.code.replace(/[^0-9]/g, ""), 10) || 0;
          const reasons: string[] = [];
          const cRank = args.shortlistRank?.[best.courseId];
          if (cRank != null) {
            const total = Object.keys(args.shortlistRank ?? {}).length;
            reasons.push(
              cRank < (args.shortlistCount ?? total)
                ? `the reader weighed it for this posting and placed it ${cRank + 1} of ${total} courses considered, even though it proves no single part`
                : `of everything the reader passed over, its catalog text sits closest to your posting, rank ${cRank + 1} of ${total}`,
            );
          }
          if (!dept.get(d)) reasons.push(`it is the first ${d} course in the plan`);
          if (newSubjects.length) {
            reasons.push(
              `it is the only one bringing ${newSubjects.slice(0, 2).join(" and ")}, which nothing else here covers`,
            );
          }
          if (num && num < 3000) {
            reasons.push("it is an introductory course rather than a specialism, which is the safer thing to put in a slot the job does not ask for");
          }
          if (!reasons.length) {
            reasons.push(`it repeats less of what the plan already has than the other ${eligible.length - 1} did`);
          }
          best = {
            ...best,
            fillerRank: 1,
            fillerPool: eligible.length,
            fillerReason: reasons.join(", and "),
          };
        }
        // Every pick, matched or filler, carries its place on the one scale
        // the page ranks by, so the row can wear its number instead of a
        // shrug.
        picks.push({ ...best, consideredPos: args.shortlistRank?.[best.courseId] });
        seenHere.add(best.courseId);
        taken.add(best.courseId);
        // And everything it rules out, immediately. Propagating conflicts only
        // at the end of a semester meant the two courses the bulletin forbids
        // together could both be picked inside one semester, because the second
        // pick was filtered against a set the first had not been added to yet.
        for (const other of conflicts.get(best.courseId) ?? []) taken.add(other);
        for (const t of best.teaches) {
          answered.add(t.toLowerCase());
          depth.set(t.toLowerCase(), (depth.get(t.toLowerCase()) ?? 0) + 1);
        }
        picked.push(best.teaches);
        pickedAll.push(best);
        filled += best.credits;
      }
    }

    for (const p of picks) {
      committedBefore.add(p.courseId);
      for (const other of conflicts.get(p.courseId) ?? []) taken.add(other);
    }
    out.push({ term: t, creditsNeeded: need, picks, shortfall: Math.max(0, need - filled) });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Telling two plans apart.
//
// This used to be one sentence built by joining course codes with commas, fixed
// against the best plan forever. Reading "COMS W4113, COMS W4118 instead of
// COMS W4733 · +1 skill" tells you almost nothing, and it kept comparing against
// the best plan even after you had switched to option 2, which is the wrong
// baseline the moment you switch.
//
// So the comparison is computed against whichever plan you are actually looking
// at, and it comes back as separate facts rather than one run-on line.
// ─────────────────────────────────────────────────────────────────────────────

export interface PlanDiff {
  /** Courses this plan has that the baseline does not, paired where one clearly replaces another. */
  swaps: { out: { code: string; title: string } | null; in: { code: string; title: string } | null }[];
  /** Requirements this plan answers that the baseline does not. */
  gains: string[];
  /** Requirements the baseline answers that this plan does not. */
  losses: string[];
  creditDelta: number;
  termDelta: number;
  /** True when only the timetable moved. */
  sameCourses: boolean;
}

export function describeDiff(baseline: Plan, other: Plan, catalog: Map<string, Course>): PlanDiff {
  const a = new Set(baseline.placements.map((p) => p.courseId));
  const b = new Set(other.placements.map((p) => p.courseId));
  const added = [...b].filter((x) => !a.has(x));
  const removed = [...a].filter((x) => !b.has(x));

  const nameOf = (id: string) => {
    const c = catalog.get(id);
    return c ? { code: c.code, title: c.title } : { code: id, title: id };
  };

  // Pair an addition with the removal it actually replaced.
  //
  // This used to pair them by array index, `added[i]` against `removed[i]`, and
  // the two lists have no relationship to each other at all: they are whatever
  // order two Sets happened to iterate in. So the page announced substitutions
  // that never happened, telling a student a course had replaced Computer
  // Vision II when it had replaced something else entirely, or nothing.
  //
  // A real substitution is one requirement slot with two candidates, so that is
  // what is matched on: the same requirement, preferring the same semester.
  // Anything left over is reported as an addition or a removal on its own,
  // because that is what it is.
  const slotOf = (plan: Plan, id: string) => plan.placements.find((p) => p.courseId === id);
  const swaps: PlanDiff["swaps"] = [];
  const unmatched = new Set(added);

  for (const out of removed) {
    const from = slotOf(baseline, out);
    const sameBucket = [...unmatched].filter((x) => slotOf(other, x)?.bucketId === from?.bucketId);
    const pick =
      sameBucket.find((x) => slotOf(other, x)?.term === from?.term) ?? sameBucket[0];
    if (pick) {
      unmatched.delete(pick);
      swaps.push({ out: nameOf(out), in: nameOf(pick) });
    } else {
      swaps.push({ out: nameOf(out), in: null });
    }
  }
  for (const id of unmatched) swaps.push({ out: null, in: nameOf(id) });

  const baseSkills = new Set(baseline.skillsCovered);
  const otherSkills = new Set(other.skillsCovered);

  return {
    swaps,
    gains: other.skillsCovered.filter((s) => !baseSkills.has(s)),
    losses: baseline.skillsCovered.filter((s) => !otherSkills.has(s)),
    creditDelta: other.totalCredits - baseline.totalCredits,
    termDelta: other.termsUsed - baseline.termsUsed,
    sameCourses: added.length === 0 && removed.length === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Courses that cannot both count.
//
// The bulletin says so itself, in the course's own description: "Due to
// significant overlap, students may only receive credit for either COMS W3134
// or COMS W3136", "Students may receive credit for only one of the following
// two courses". A plan that schedules both is not merely inelegant, it charges
// the student four credits that will not count toward the hundred and twenty
// four, and it does it in their final semester where there is no time left to
// fix it.
//
// The rule is read off the text rather than hand-listed, because the text is
// what the university published and a hand-list goes stale the moment a course
// is added.
// ─────────────────────────────────────────────────────────────────────────────

export function overlapGroups(catalog: Course[]): Map<string, Set<string>> {
  const known = new Set(catalog.map((c) => c.id));
  const conflicts = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b || !known.has(a) || !known.has(b)) return;
    if (!conflicts.has(a)) conflicts.set(a, new Set());
    if (!conflicts.has(b)) conflicts.set(b, new Set());
    conflicts.get(a)!.add(b);
    conflicts.get(b)!.add(a);
  };
  // Declared by the bulletin and captured at ingest, rather than re-derived
  // from prose here: the codes sit outside the description paragraph, so the
  // only place they can be read reliably is the committed snapshot.
  for (const c of catalog) for (const other of c.overlapsWith ?? []) link(c.id, other);
  return conflicts;
}


/**
 * Last line of defence: no plan leaves the solver holding a course whose
 * prerequisite is nowhere in it.
 *
 * Worth being exact about what this is and is not. The broken plan that
 * prompted it was NOT produced by the solver: solve() refuses that input
 * outright, returning "Computer Science core can't be reached in time"
 * rather than a plan. It was produced afterwards, by a hand edit that took
 * a course out of a finished plan and left what depended on it behind. That
 * cause is fixed where it happens, in the store's own remove path.
 *
 * So this guards an invariant rather than patching a known escape. Every
 * rung of the ladder below returns through it, and if some future search
 * path ever does emit such a plan, it is repaired or refused here instead
 * of reaching a student. It is deliberately not the place to explain the
 * bug above.
 *
 * Where the missing course can legally be added — an earlier term exists,
 * offering it, under the credit cap — it is added, and nothing else moves.
 * Two situations cannot be closed that way, and are handled differently:
 *
 * - The missing course is on the student's own excluded list. Adding it
 *   back would silently override a choice the student made on purpose
 *   (already covered elsewhere, refuses to take it); the honest move is to
 *   drop the course that depends on it instead, since it can never be
 *   taken as scheduled.
 * - No legal term exists for the missing course either. Leaving the gap
 *   in place would ship a plan with a course sitting on an unmet
 *   prerequisite, which is the exact failure this function exists to
 *   prevent; dropping the dependent course is the only remaining option.
 *
 * Any add or drop changes which requirements the board meets, so bucket
 * satisfaction is recounted from the final placement list by the same rule
 * solve() used, rather than left describing the plan as it was.
 */
function repairMissingPrerequisites(
  result: SolveResponse,
  req: SolveRequest,
): SolveResponse {
  if (!result.ok || !result.plans.length) return result;
  const school = getSchool(req.schoolId);
  const program = getProgram(req.schoolId, req.programId);
  if (!school || !program) return result;
  const byId = new Map(school.courses.map((c) => [c.id, c]));
  const termKinds = termKindsFor(req.student.startTerm as Term, result.plans[0]?.termCredits.length ?? 0);
  const done = new Set(req.student.completed ?? []);
  const excluded = new Set(req.student.excluded ?? []);

  const findMissing = (node: import("@/lib/types").PrereqNode | null, have: Set<string>): string | null => {
    if (!node) return null;
    if (node.op === "COURSE") return have.has(node.courseId) ? null : node.courseId;
    if (node.op === "UNVERIFIABLE") return null;
    if (node.op === "AND") { for (const c of node.children) { const m = findMissing(c, have); if (m) return m; } return null; }
    if (node.op === "OR") {
      if (node.children.some((c) => prereqSatisfied(c, have))) return null;
      for (const c of node.children) { const m = findMissing(c, have); if (m) return m; }
      return null;
    }
    return null;
  };

  const plans = result.plans.map((plan) => {
    const placements = [...plan.placements];
    const termCredits = [...plan.termCredits];
    // A course dropped here because ITS OWN prerequisite can never be met
    // must stay dropped: without this, a later pass sees whatever depended
    // on it newly broken, and "fixes" that by adding the very course just
    // removed back in — an add/drop oscillation that never terminates
    // cleanly. Anything recorded here is never reinstated, only cascaded.
    const permanentlyGone = new Set<string>();
    let guard = 0;
    while (guard++ < 8) {
      const have = new Set([...done, ...placements.map((p) => p.courseId)]);
      let fixed = false;
      for (const p of placements) {
        const c = byId.get(p.courseId);
        if (!c?.prereq) continue;
        const before = new Set(done);
        for (const q of placements) if (q.term < p.term) before.add(q.courseId);
        if (prereqSatisfied(c.prereq, before)) continue;
        const missingId = findMissing(c.prereq, before);
        const missing = missingId ? byId.get(missingId) : null;
        if (!missing || have.has(missing.id)) continue; // already placed too late; the live panel's Move covers that case
        const drop = () => {
          const idx = placements.indexOf(p);
          if (idx >= 0) placements.splice(idx, 1);
          termCredits[p.term] = Math.max(0, (termCredits[p.term] ?? 0) - (c.credits ?? 0));
          permanentlyGone.add(p.courseId);
        };
        if (excluded.has(missing.id) || permanentlyGone.has(missing.id)) { drop(); fixed = true; break; }
        const term = termKinds.findIndex((k: Term, t: number) =>
          t < p.term
          && missing.termsOffered.includes(k)
          && (termCredits[t] ?? 0) + missing.credits <= program.maxCreditsPerTerm);
        if (term < 0) { drop(); fixed = true; break; }
        placements.push({
          courseId: missing.id, term, bucketId: "", locked: false,
          needsAdvisorCheck: false, unverifiableText: [], covers: [], unlocks: [c.code],
          earliestTerm: term, earliestReason: `prerequisite for ${c.code}, added automatically`,
        });
        termCredits[term] = (termCredits[term] ?? 0) + missing.credits;
        fixed = true;
        break; // recompute `have`/`before` before checking the next course
      }
      if (!fixed) break;
    }
    // Placements changed above, so bucket satisfaction was computed against a
    // list that no longer exists. Recounted by the same rule the plan was
    // built with, double counting included: Columbia's bulletin lets MATH
    // UN2015 answer linear algebra and probability at once, and a recount
    // that ignored that would report a met requirement as short.
    const eligibleOf = new Map(program.buckets.map((b) => [b.id, new Set(b.eligible)]));
    const buckets = plan.buckets.map((b) => {
      let fromPlan = 0;
      for (const p of placements) {
        const counts = p.bucketId === b.bucketId
          || (b.allowDoubleCount.includes(p.bucketId) && (eligibleOf.get(b.bucketId)?.has(p.courseId) ?? false));
        if (counts) fromPlan += b.unit === "credits" ? (byId.get(p.courseId)?.credits ?? 0) : 1;
      }
      return {
        ...b,
        fromPlan: Math.min(fromPlan, Math.max(0, b.need - b.fromCompleted)),
        satisfied: b.fromCompleted + fromPlan >= b.need,
      };
    });
    return { ...plan, placements, termCredits, buckets };
  });
  return { ...result, plans };
}

/**
 * solve(), with a way out of the corner solve() cannot leave.
 *
 * Some postings hand the optimizer a course that is technically placeable
 * but so schedule-constrained (one offered term, a deep prerequisite chain,
 * a short horizon) that proving whether the best plan includes it exhausts
 * any node budget. The honest escape is to shed exactly that course and
 * answer the posting a little less completely: every attempt is bounded,
 * the ladder always terminates, and what was shed is reported so the UI
 * never pretends the posting had nothing more to say.
 */
export function solveResilient(req: SolveRequest, budgetMs: number): SolveResponse & { shedForTime?: string[] } {
  // Every rung below returns through here, so a plan can never reach a
  // student, or the health panel, with a gap this function can close itself.
  const done = (r: SolveResponse, shed?: string[]) => ({ ...repairMissingPrerequisites(r, req), ...(shed ? { shedForTime: shed } : {}) });

  let result = solve(req, budgetMs);
  if (result.ok || !result.infeasibility?.timedOut) return done(result);

  result = solve(req, 20000, 2_000_000);
  if (result.ok || !result.infeasibility?.timedOut) return done(result);

  const school = getSchool(req.schoolId);
  const byId = new Map((school?.courses ?? []).map((c) => [c.id, c]));
  const leaves = (n: import("@/lib/types").PrereqNode | null): number => {
    if (!n) return 0;
    if (n.op === "COURSE") return 1;
    if (n.op === "AND" || n.op === "OR") return n.children.reduce((s, c) => s + leaves(c), 0);
    return 0;
  };
  // Most constrained first: fewest offered terms, then heaviest prereq tree.
  const order = Object.keys(req.relevance ?? {})
    .filter((id) => byId.has(id))
    .sort((a, b) => {
      const ca = byId.get(a)!, cb = byId.get(b)!;
      return ca.termsOffered.length - cb.termsOffered.length || leaves(cb.prereq) - leaves(ca.prereq);
    });

  const shed: string[] = [];
  let relevance = { ...(req.relevance ?? {}) };
  for (const id of order.slice(0, 4)) {
    delete relevance[id];
    shed.push(byId.get(id)?.code ?? id);
    const attempt = solve({ ...req, relevance }, 12000, 3_000_000);
    if (attempt.ok || !attempt.infeasibility?.timedOut) return done(attempt, shed);
  }
  // Last rung: the plain degree plan, which a sane catalog always has.
  const bare = solve({ ...req, relevance: {} }, 12000, 3_000_000);
  return done(bare, shed);
}
