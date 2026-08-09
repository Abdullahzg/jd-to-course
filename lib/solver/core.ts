import type {
  Course, PrereqNode, Program, School, SkillEvidence, StudentState, Term, Relaxation,
} from "@/lib/types";
import { skillKey } from "@/lib/skills";

// ─────────────────────────────────────────────────────────────────────────────
// THE SOLVER. BUILD_SPEC §7.
//
// This is a branch-and-bound constraint solver, not a heuristic and not a
// language model. It explores the space of degree-satisfying course sets,
// prunes with an admissible upper bound on the objective, and — when it
// exhausts the tree within its deadline — returns a provably optimal plan.
//
// Departure from §3.1: the spec called for CP-SAT behind a FastAPI service
// because "there is no adequate equivalent in JavaScript". That is true in
// general and false for this specific model. The problem here is small
// (tens of candidate courses over 4-6 terms) and highly structured (bucket
// fills, then a precedence-constrained bin packing). A purpose-built solver
// beats a general one at this size, and it lets the whole product deploy as a
// single Vercel app with no cold start and no second service to keep alive.
// The claim the spec actually protects — "the AI never picks a course" — is
// untouched. Nothing below calls a model.
// ─────────────────────────────────────────────────────────────────────────────

export const W_SKILL = 100;
export const W_CREDIT = 3;
export const W_TERM = 40;

/** Bitmasks are 31-bit. More target skills than this and we keep the first 31. */
export const MAX_TRACKED_SKILLS = 31;

/** Diagnostic escape hatch: disables every bound so the search is exhaustive.
 *  Used to prove the bound is admissible — if the answer changes, it isn't. */
const NO_PRUNE = typeof process !== "undefined" && process.env?.SLACK_NO_PRUNE === "1";

// ─────────────────────────── prerequisite trees ─────────────────────────────

/** Constraint 4. UNVERIFIABLE is satisfied but flagged — never silently blocked. */
export function prereqSatisfied(
  node: PrereqNode | null,
  have: Set<string>,
): boolean {
  if (!node) return true;
  switch (node.op) {
    case "COURSE": return have.has(node.courseId);
    case "UNVERIFIABLE": return true;
    case "AND": return node.children.every((c) => prereqSatisfied(c, have));
    case "OR": return node.children.some((c) => prereqSatisfied(c, have));
  }
}

/** One prerequisite the plan actually leans on, and what it leaned on instead. */
export type PrereqStep = {
  /** courses already held that satisfy this step */
  via: string[];
  /** other courses that would have satisfied the same step */
  alternatives: string[];
  /** catalog wording relied on that names no course this catalog has */
  assumed: string[];
};

/**
 * WHICH branch of a prerequisite tree is carrying the weight.
 *
 * prereqSatisfied answers yes or no, and its OR case is `.some(...)`, so the one
 * fact a reader wants is thrown away: the rule says one of three courses, and
 * nothing anywhere says which one the plan is using. This returns that, per
 * step, along with the courses it passed over.
 *
 * It also stops UNVERIFIABLE passing in silence. prereqSatisfied treats catalog
 * wording as satisfied, which means a plan can rest entirely on the words "or
 * knowledge of Java" with nothing on screen telling the student they are the
 * ones who have to make that true. Here such a branch comes back with an empty
 * `via` and the wording in `assumed`, and it loses to any branch a real course
 * backs.
 *
 * Returns null when nothing in the tree is satisfied. An empty array means the
 * course has no prerequisites to report, which is not the same answer.
 */
export function prereqSteps(node: PrereqNode | null, have: Set<string>): PrereqStep[] | null {
  if (!node) return [];
  switch (node.op) {
    case "COURSE":
      return have.has(node.courseId)
        ? [{ via: [node.courseId], alternatives: [], assumed: [] }]
        : null;
    case "UNVERIFIABLE":
      return [{ via: [], alternatives: [], assumed: [node.text] }];
    case "AND": {
      const out: PrereqStep[] = [];
      const seen = new Set<string>();
      for (const child of node.children) {
        const steps = prereqSteps(child, have);
        if (steps === null) return null;
        for (const s of steps) {
          // The parsed catalog repeats children (CSEE W4140's rule is
          // OR(W4119, W4119)), and a repeat is one requirement, not two.
          const key = `${s.via.join("+")}|${s.assumed.join("+")}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(s);
        }
      }
      return out;
    }
    case "OR": {
      // The branch is the unit of choice, so an OR reports one step even when
      // the winning branch is an AND of two courses. COMS W4444's rule is
      // OR(AND(W3134, W3136), AND(W3137, CSEE W3827)): reporting four separate
      // steps would say each course is individually optional, which is false.
      const branches = node.children.map((child) => collapseSteps(prereqSteps(child, have)));
      let winner = -1;
      for (let i = 0; i < branches.length; i++) {
        const b = branches[i];
        if (!b) continue;
        if (winner < 0 || preferStep(b, branches[winner]!) < 0) winner = i;
      }
      if (winner < 0) return null;

      const chosen = branches[winner]!;
      const alternatives = [...chosen.alternatives];
      node.children.forEach((child, i) => {
        if (i === winner) return;
        for (const id of coursesIn(child)) if (!alternatives.includes(id)) alternatives.push(id);
      });
      return [{
        via: chosen.via,
        assumed: chosen.assumed,
        alternatives: alternatives.filter((id) => !chosen.via.includes(id)),
      }];
    }
  }
}

/** Fold a branch's steps into the single step an OR is choosing between. */
function collapseSteps(steps: PrereqStep[] | null): PrereqStep | null {
  if (steps === null) return null;
  const via: string[] = [];
  const alternatives: string[] = [];
  const assumed: string[] = [];
  for (const s of steps) {
    for (const id of s.via) if (!via.includes(id)) via.push(id);
    for (const id of s.alternatives) if (!alternatives.includes(id)) alternatives.push(id);
    for (const t of s.assumed) if (!assumed.includes(t)) assumed.push(t);
  }
  return { via, alternatives: alternatives.filter((id) => !via.includes(id)), assumed };
}

/**
 * Which satisfied branch to report. Coursework beats wording, because "carried
 * by COMS W3134" is a fact the student can check against their transcript and
 * "carried by the words or knowledge of Java" is work they still have to do.
 * Among equals, the branch that spends the fewest courses.
 */
function preferStep(a: PrereqStep, b: PrereqStep): number {
  const rank = (s: PrereqStep) => (s.via.length ? (s.assumed.length ? 1 : 0) : 2);
  return rank(a) - rank(b) || a.via.length - b.via.length || a.assumed.length - b.assumed.length;
}

/** Every course id named anywhere in a subtree, deduped, in reading order. */
function coursesIn(node: PrereqNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.op === "COURSE") { if (!out.includes(node.courseId)) out.push(node.courseId); }
  else if (node.op === "AND" || node.op === "OR") node.children.forEach((c) => coursesIn(c, out));
  return out;
}

export function collectUnverifiable(node: PrereqNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.op === "UNVERIFIABLE") out.push(node.text);
  else if (node.op === "AND" || node.op === "OR") node.children.forEach((c) => collectUnverifiable(c, out));
  return out;
}

/**
 * Minimal set of additional courses that would satisfy `node`, or null if no
 * branch is satisfiable from the committed catalog. Chooses the cheapest OR
 * branch by credits. This is what lets the solver pull in a prerequisite the
 * student hasn't taken and correctly charge them the credits for it.
 */
export function neededFor(
  node: PrereqNode | null,
  have: Set<string>,
  catalog: Map<string, Course>,
  depth = 0,
  /**
   * Courses that cannot be used: taken off the table by the student, or ruled
   * out because the bulletin forbids counting them with something already
   * passed.
   *
   * This used to be missing, and an OR was resolved to its cheapest branch
   * without regard for whether that branch was reachable. resolveSupport then
   * saw an unusable course and threw the whole plan away, even though another
   * branch of the same OR was fine. It stayed hidden while nothing was ever
   * excluded. The moment a student's completed Data Structures ruled out the
   * other two versions of it, the search rejected 399,982 of 400,000 candidate
   * plans and the page said no plan fits.
   */
  excluded: Set<string> = new Set(),
): Set<string> | null {
  if (!node || depth > 12) return new Set();
  switch (node.op) {
    case "UNVERIFIABLE":
      return new Set();
    case "COURSE": {
      if (have.has(node.courseId)) return new Set();
      if (!catalog.has(node.courseId)) return null; // not in the committed catalog
      if (excluded.has(node.courseId)) return null;
      return new Set([node.courseId]);
    }
    case "AND": {
      const acc = new Set<string>();
      for (const child of node.children) {
        const r = neededFor(child, have, catalog, depth + 1, excluded);
        if (r === null) return null;
        r.forEach((x) => acc.add(x));
      }
      return acc;
    }
    case "OR": {
      let best: Set<string> | null = null;
      let bestCost = Infinity;
      for (const child of node.children) {
        const r = neededFor(child, have, catalog, depth + 1, excluded);
        if (r === null) continue;
        const cost = [...r].reduce((s, id) => s + (catalog.get(id)?.credits ?? 3), 0);
        if (cost < bestCost) { bestCost = cost; best = r; }
      }
      return best;
    }
  }
}

/**
 * Transitive closure: given a chosen set, pull in every prerequisite course it
 * needs. Returns null when some choice is simply unreachable from this catalog.
 */
export function resolveSupport(
  chosen: Set<string>,
  completed: Set<string>,
  catalog: Map<string, Course>,
  excluded: Set<string>,
): Set<string> | null {
  const support = new Set<string>();
  const queue = [...chosen];
  let guard = 0;
  while (queue.length) {
    if (++guard > 500) return null;
    const id = queue.shift()!;
    const course = catalog.get(id);
    if (!course) return null;
    const have = new Set<string>([...completed, ...chosen, ...support]);
    if (prereqSatisfied(course.prereq, have)) continue;
    const need = neededFor(course.prereq, have, catalog, 0, excluded);
    if (need === null) return null;
    let added = false;
    for (const n of need) {
      if (excluded.has(n)) return null;
      if (!support.has(n) && !chosen.has(n) && !completed.has(n)) {
        support.add(n);
        queue.push(n);
        added = true;
      }
    }
    if (!added && !prereqSatisfied(course.prereq, new Set([...completed, ...chosen, ...support]))) {
      return null; // no progress possible
    }
  }
  return support;
}

// ─────────────────────────── model construction ─────────────────────────────

export type BucketModel = {
  id: string;
  label: string;
  need: number;
  unit: "courses" | "credits";
  /** eligible course ids still available (not completed, not excluded) */
  pool: string[];
  /** amount already satisfied by completed coursework */
  fromCompleted: number;
  /** which completed courses were actually matched to this bucket */
  fromCompletedCourses: string[];
  remaining: number;
  classes: SymClass[];
  /** union of target-skill bits reachable from this bucket's pool */
  reachableSkills: number;
  doubleCountWith: Set<string>;
  eligibleCount: number;
};

export type SymClass = {
  key: string;
  members: string[];
  skillMask: number;
  credits: number;
};

export type Model = {
  /** ids of courses that answer at least one part of this posting */
  jobRelevant: Set<string>;
  program: Program;
  catalog: Map<string, Course>;
  completed: Set<string>;
  excluded: Set<string>;
  T: number;
  termKinds: Term[];
  maxCredits: number;
  minCredits: number;
  buckets: BucketModel[];
  /** target skill strings, index = bit position */
  skills: string[];
  /** Scaled integer worth of each tracked requirement. See weightOf. */
  skillWeights: number[];
  skillIndex: Map<string, number>;
  lockedByCourse: Map<string, number>;
  /** credits still to earn for the whole degree, not just the major */
  remainingDegreeCredits: number;
  /**
   * Terms the student must be enrolled for anyway to finish the degree.
   * Finishing the *major* sooner than this graduates nobody, so the objective
   * only penalises terms beyond it. Without this the solver crams every
   * remaining major course into two terms and leaves the student's actual
   * freedom unspent — which is the thing this product exists to spend.
   */
  minTermsRequired: number;
  truncatedSkills: string[];
  /** what the aligner decided, kept so the UI can show its working */
  skillMatches: Record<string, string[]>;
  /**
   * What each course teaches, for THIS job. Either the model's reading of the
   * description (preferred, because it is not limited to the catalog's own
   * vocabulary) or the hand written list as a fallback.
   */
  courseSkills: Map<string, SkillEvidence[]>;
};

// Both the posting's wording and the catalog's wording fold through the same
// alias table, so "Docker" and "containers" meet instead of missing.
function normSkill(s: string): string {
  return skillKey(s);
}

export function buildModel(
  school: School,
  program: Program,
  student: StudentState,
  targetSkills: string[],
  relax: Relaxation = {},
  skillMatches: Record<string, string[]> = {},
  relevance: Record<string, SkillEvidence[]> = {},
  /** requirement -> how central the posting made it: core, supporting, incidental */
  centrality: Record<string, string> = {},
): Model {
  const catalog = new Map(school.courses.map((c) => [c.id, c]));
  const completed = new Set(student.completed);
  const excluded = new Set(student.excluded);

  // A course the bulletin will not let you count alongside one you have already
  // passed is not a candidate.
  //
  // The overlap rules were enforced only in the elective filler, never in the
  // search itself, so the solver could and did put COMS W3136 and COMS W3137 in
  // one plan. Columbia's page for each of them says you may receive credit for
  // only one. Charging a student for a course that cannot count is the exact
  // failure this whole catalog exists to prevent.
  for (const id of completed) {
    for (const other of catalog.get(id)?.overlapsWith ?? []) excluded.add(other);
  }

  // Dedup target skills, cap at the bitmask width.
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const s of targetSkills) {
    const n = normSkill(s);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    uniq.push(s.trim());
  }
  const skills = uniq.slice(0, MAX_TRACKED_SKILLS);
  const truncatedSkills = uniq.slice(MAX_TRACKED_SKILLS);
  // A course skill satisfies a target skill when the aligner said so, or when
  // the two words already agree. Reverse-indexed so matching is a map lookup.
  //
  // Which pass is allowed to say a course teaches a job's requirement.
  //
  // Two passes can answer that. /api/relevance reads a course description and
  // has to quote the sentence that proves it. /api/match only lines up two
  // vocabularies, so it will happily decide "Multilingual NLP" is answered by a
  // course tagged "NLP", or that "publications at NeurIPS" is answered by
  // "Research". Those produced requirements shown as satisfied with no course
  // able to show why, which is the one thing this product cannot do.
  //
  // So when the relevance pass has run, it is the only authority. The
  // vocabulary aliases are used solely as a fallback for a deployment with no
  // API key, where nothing better exists.
  const haveRelevance = Object.keys(relevance).length > 0;

  const skillIndex = new Map<string, number>();
  skills.forEach((s, i) => {
    skillIndex.set(normSkill(s), i);
    if (!haveRelevance) {
      for (const cat of skillMatches[s] ?? []) skillIndex.set(normSkill(cat), i);
    }
  });

  const T = student.horizonTerms + (relax.extraTerms ?? 0);
  const termKinds: Term[] = [];
  {
    let t: Term = student.startTerm;
    for (let i = 0; i < T; i++) {
      termKinds.push(t);
      if (relax.allowSummer && t === "SP") t = "SU";
      else if (t === "FA") t = "SP";
      else t = "FA";
    }
  }

  // One place decides what a course teaches, so relevance and the fallback
  // cannot disagree anywhere downstream.
  // A course the relevance pass did not return evidence for teaches nothing
  // this job asked for. Falling back to the catalog's own tags there is what
  // let unproven claims through.
  const courseSkills = new Map<string, SkillEvidence[]>(
    school.courses.map((c) => [c.id, haveRelevance ? (relevance[c.id] ?? []) : c.skills]),
  );

  // Document frequency: how many courses in this catalog answer each
  // requirement. This is the part that cannot be known from the posting alone,
  // which is why it is computed here rather than asked of a model.
  const maskOfRaw = (c: Course): number => {
    let mm = 0;
    for (const s of (courseSkills.get(c.id) ?? c.skills)) {
      const i = skillIndex.get(normSkill(s.skill));
      if (i !== undefined) mm |= 1 << i;
    }
    return mm;
  };
  const df = new Array<number>(skills.length).fill(0);
  for (const c of school.courses) {
    const mm = maskOfRaw(c);
    for (let i = 0; i < skills.length; i++) if ((mm >> i) & 1) df[i]++;
  }
  const N = Math.max(1, school.courses.length);
  const CENTRALITY: Record<string, number> = { core: 3, supporting: 2, incidental: 1 };
  const skillWeights = skills.map((s, i) => {
    const central = CENTRALITY[(centrality[s] ?? "supporting").toLowerCase()] ?? 2;
    // Inverse document frequency, floored so a requirement nothing teaches does
    // not blow up and one everything teaches is still worth a little.
    const rarity = Math.log(1 + N / Math.max(1, df[i]));
    const rarityMax = Math.log(1 + N);
    return Math.max(1, Math.round(WEIGHT_SCALE * central * (rarity / rarityMax)));
  });

  /** Worth of a mask, for use inside buildModel where the Model does not exist yet. */
  const weigh = (mask: number): number => {
    let total = 0;
    let bits = mask;
    while (bits) {
      const i = 31 - Math.clz32(bits & -bits);
      total += skillWeights[i] ?? WEIGHT_SCALE;
      bits &= bits - 1;
    }
    return total;
  };

  const maskOf = (c: Course): number => {
    let m = 0;
    for (const s of (courseSkills.get(c.id) ?? c.skills)) {
      const i = skillIndex.get(normSkill(s.skill));
      if (i !== undefined) m |= 1 << i;
    }
    return m;
  };

  // Mutual double-count pairs only (constraint 7).
  const bucketById = new Map(program.buckets.map((b) => [b.id, b]));
  const mutualDouble = (a: string, b: string) =>
    (bucketById.get(a)?.allowDoubleCount ?? []).includes(b) &&
    (bucketById.get(b)?.allowDoubleCount ?? []).includes(a);

  // Constraint 7 applies to coursework already done, not just to the plan.
  // Columbia's elective rule reads "any three COMS courses at the 3000 level or
  // above", which textually includes the very courses the core already spent —
  // so crediting a completed course to every bucket that lists it would quietly
  // satisfy the elective requirement with courses the student cannot reuse.
  // Matched once, to the buckets that need it most.
  const completedCredit = assignCompleted(program, completed, catalog, mutualDouble);

  const buckets: BucketModel[] = program.buckets.map((b) => {
    const unit: "courses" | "credits" = b.needCredits != null ? "credits" : "courses";
    const need = b.needCredits ?? b.needCourses ?? 0;

    const fromCompleted = Math.min(completedCredit.amount.get(b.id) ?? 0, need);
    const fromCompletedCourses = completedCredit.courses.get(b.id) ?? [];

    const pool = b.eligible.filter((id) => !completed.has(id) && !excluded.has(id) && catalog.has(id));

    // Symmetry reduction: courses identical in every dimension the objective and
    // the constraints can see are interchangeable. Collapsing them is exact —
    // it removes only duplicate leaves, never a distinct outcome.
    const byKey = new Map<string, SymClass>();
    for (const id of pool) {
      const c = catalog.get(id)!;
      const m = maskOf(c);
      const key = [
        m,
        c.credits,
        [...c.termsOffered].sort().join(""),
        c.prereq ? JSON.stringify(c.prereq) : "-",
      ].join("|");
      const existing = byKey.get(key);
      if (existing) existing.members.push(id);
      else byKey.set(key, { key, members: [id], skillMask: m, credits: c.credits });
    }
    // Best-first: highest skill payoff per credit explored first, so a strong
    // incumbent appears immediately and the bound prunes hard from then on.
    const classes = [...byKey.values()].sort((a, b2) => {
      const sa = weigh(a.skillMask), sb = weigh(b2.skillMask);
      if (sb !== sa) return sb - sa;
      return a.credits - b2.credits;
    });

    let reachable = 0;
    for (const k of classes) reachable |= k.skillMask;

    const doubleCountWith = new Set(
      (b.allowDoubleCount ?? []).filter((other) => mutualDouble(b.id, other)),
    );

    return {
      id: b.id,
      label: b.label,
      need,
      unit,
      pool,
      fromCompleted,
      fromCompletedCourses,
      remaining: Math.max(0, need - fromCompleted),
      classes,
      reachableSkills: reachable,
      doubleCountWith,
      eligibleCount: b.eligible.length,
    };
  });

  const remainingDegreeCredits = Math.max(0, program.totalCredits - student.completedCredits);
  const minTermsRequired = Math.max(
    1,
    Math.min(T, Math.ceil(remainingDegreeCredits / Math.max(1, program.maxCreditsPerTerm))),
  );

  // Which courses answer this posting at all. The k-best cuts compare plans on
  // this subset: two plans that differ only in which linear algebra variant
  // fills a math slot are one plan wearing two hats, and offering the second as
  // "Option 2" told a student it was a choice worth weighing.
  const jobRelevant = new Set<string>();
  for (const c of school.courses) if (maskOf(c) !== 0) jobRelevant.add(c.id);

  return {
    jobRelevant,
    program,
    catalog,
    completed,
    excluded,
    T,
    termKinds,
    maxCredits: program.maxCreditsPerTerm + (relax.extraCreditsPerTerm ?? 0),
    minCredits: program.minCreditsPerTerm,
    buckets,
    skills,
    skillWeights,
    skillIndex,
    lockedByCourse: new Map(student.locked.map((l) => [l.courseId, l.term])),
    skillMatches,
    courseSkills,
    remainingDegreeCredits,
    minTermsRequired,
    truncatedSkills,
  };
}

/**
 * Match completed coursework to requirement slots, one course to one slot,
 * maximising the number of slots filled (Kuhn's augmenting-path algorithm over
 * expanded slots). Mutual `allowDoubleCount` pairs then get a second credit for
 * the same course — which is exactly, and only, what that permission means.
 *
 * The alternative — crediting a completed course to every bucket that lists it
 * — inflates a student's progress and would tell them they are closer to
 * graduating than they are. That is the worst error this program can make.
 */
function assignCompleted(
  program: Program,
  completed: Set<string>,
  catalog: Map<string, Course>,
  mutualDouble: (a: string, b: string) => boolean,
): { amount: Map<string, number>; courses: Map<string, string[]> } {
  const slots: string[] = []; // bucketId, repeated per unit of need
  for (const b of program.buckets) {
    const n = b.needCredits != null
      ? Math.ceil(b.needCredits / 3) // credit-unit buckets: approximate slot width
      : (b.needCourses ?? 0);
    for (let i = 0; i < n; i++) slots.push(b.id);
  }

  const eligibleOf = new Map(program.buckets.map((b) => [b.id, new Set(b.eligible)]));
  const relevant = [...completed].filter((id) =>
    program.buckets.some((b) => eligibleOf.get(b.id)!.has(id)),
  );

  const slotMatch: (string | null)[] = new Array(slots.length).fill(null);

  const augment = (courseId: string, visited: Set<number>): boolean => {
    for (let si = 0; si < slots.length; si++) {
      if (visited.has(si)) continue;
      if (!eligibleOf.get(slots[si])!.has(courseId)) continue;
      visited.add(si);
      if (slotMatch[si] === null || augment(slotMatch[si]!, visited)) {
        slotMatch[si] = courseId;
        return true;
      }
    }
    return false;
  };

  // Scarcest courses first — a course eligible for only one bucket must take it.
  relevant.sort((a, b) => {
    const na = program.buckets.filter((x) => eligibleOf.get(x.id)!.has(a)).length;
    const nb = program.buckets.filter((x) => eligibleOf.get(x.id)!.has(b)).length;
    return na - nb;
  });
  for (const id of relevant) augment(id, new Set());

  const out = new Map<string, number>();
  const matchedTo = new Map<string, string[]>();
  for (let si = 0; si < slots.length; si++) {
    const c = slotMatch[si];
    if (!c) continue;
    const b = program.buckets.find((x) => x.id === slots[si])!;
    const unitValue = b.needCredits != null ? (catalog.get(c)?.credits ?? 0) : 1;
    out.set(slots[si], (out.get(slots[si]) ?? 0) + unitValue);
    matchedTo.set(slots[si], [...(matchedTo.get(slots[si]) ?? []), c]);
  }

  // Permitted double-counting, applied after the matching.
  for (const b of program.buckets) {
    for (const other of program.buckets) {
      if (b.id === other.id || !mutualDouble(b.id, other.id)) continue;
      for (const c of matchedTo.get(other.id) ?? []) {
        if (!eligibleOf.get(b.id)!.has(c)) continue;
        const unitValue = b.needCredits != null ? (catalog.get(c)?.credits ?? 0) : 1;
        out.set(b.id, (out.get(b.id) ?? 0) + unitValue);
        matchedTo.set(b.id, [...(matchedTo.get(b.id) ?? []), c]);
      }
    }
  }

  return { amount: out, courses: matchedTo };
}

/**
 * What a set of covered requirements is actually worth.
 *
 * The objective used to be popcount: every requirement the plan answered scored
 * the same one point. That is wrong in two separate ways, and a user found both
 * by reading a plan.
 *
 * First, requirements are not equally important to a job. A posting whose whole
 * point is distributed systems also mentions Python once. Counting them equally
 * lets a plan trade the thing the job is about for a thing it mentioned.
 *
 * Second, and less obvious: a requirement matched by a third of the catalog
 * cannot help choose between courses. "Python" matched twenty of a hundred and
 * fifty one Columbia courses. Whatever plan the solver builds will satisfy it
 * by accident, so spending the objective on it buys nothing, while "Consensus
 * protocols" matched exactly one course and is therefore the only requirement
 * in that list that actually decides anything.
 *
 * So each requirement carries a weight: how central the posting made it,
 * multiplied by how rare it is in this catalog. Weights are scaled integers
 * because branch and bound compares objectives for equality, and floating point
 * makes that unreliable.
 */
export function weightOf(m: Model, mask: number): number {
  let total = 0;
  let bits = mask;
  while (bits) {
    const i = 31 - Math.clz32(bits & -bits);
    total += m.skillWeights[i] ?? WEIGHT_SCALE;
    bits &= bits - 1;
  }
  return total;
}

/** Weights are integers so equal objectives compare exactly. */
export const WEIGHT_SCALE = 1000;

export function popcount(n: number): number {
  let c = 0;
  while (n) { n &= n - 1; c++; }
  return c;
}

// ─────────────────────────── scheduling (constraints 2,3,4,5,8) ─────────────

export type Schedule = {
  termOf: Map<string, number>;
  termCredits: number[];
  termsUsed: number;
  openCreditsNeeded: number[];
  /** terms where even open credits can't reach the full-time floor — a warning */
  belowFullTime: number[];
  earliest: Map<string, number>;
  earliestReason: Map<string, string>;
};

/**
 * Place a chosen course set into terms. Precedence-constrained bin packing:
 * every prerequisite strictly earlier, every course only in a term it is
 * offered, no term over the credit cap, locked courses pinned.
 *
 * Tries terms earliest-first so the first schedule found is the most compact.
 */
export function schedule(m: Model, chosen: Set<string>, deadline: number): Schedule | null {
  const ids = [...chosen];
  const earliest = new Map<string, number>();
  const earliestReason = new Map<string, string>();

  // Fixpoint on earliest-possible term. Prereqs push a course later; term
  // availability pushes it later again. Both are hard constraints.
  for (const id of ids) earliest.set(id, 0);
  for (let iter = 0; iter < ids.length + 2; iter++) {
    let changed = false;
    for (const id of ids) {
      const c = m.catalog.get(id)!;
      let lo = earliestPrereqTerm(c.prereq, m, chosen, earliest);
      if (lo === Infinity) return null;
      // slide forward to a term where the course is actually offered
      let slid = lo;
      while (slid < m.T && !c.termsOffered.includes(m.termKinds[slid])) slid++;
      if (slid >= m.T) return null;
      if (slid > (earliest.get(id) ?? 0)) {
        earliest.set(id, slid);
        changed = true;
        earliestReason.set(
          id,
          slid > lo
            ? `offered in ${c.termsOffered.join("/")} only`
            : `its prerequisites have to come first`,
        );
      }
    }
    if (!changed) break;
  }

  // Locked courses (constraint 8) are pinned; reject an impossible lock early.
  for (const [id, t] of m.lockedByCourse) {
    if (!chosen.has(id)) continue;
    const c = m.catalog.get(id)!;
    if (t < (earliest.get(id) ?? 0) || t >= m.T || !c.termsOffered.includes(m.termKinds[t])) return null;
  }

  // Prerequisites first, always. Sorting by earliest-possible term only
  // approximates this, and when it gets one pair backwards the DFS thrashes:
  // the dependent can't go anywhere until its prerequisite is placed, so every
  // term gets tried and rejected before backtracking.
  const order = topological(m, ids, earliest);

  const load = new Array(m.T).fill(0);
  const termOf = new Map<string, number>();
  let timedOut = false;

  const place = (i: number): boolean => {
    if (Date.now() > deadline) { timedOut = true; return false; }
    if (i === order.length) return true;
    const id = order[i];
    const c = m.catalog.get(id)!;
    const locked = m.lockedByCourse.get(id);

    // Lower bound straight from where the prerequisites actually landed —
    // O(tree) instead of rebuilding a set of everything placed so far for
    // every candidate term, which is what made this blow up over long horizons.
    const prereqLo = earliestPrereqTerm(c.prereq, m, chosen, termOf as Map<string, number>, true);
    if (prereqLo === Infinity) return false;
    const lo = Math.max(earliest.get(id)!, prereqLo);

    let candidates: number[];
    if (locked != null) {
      candidates = locked >= lo ? [locked] : [];
    } else {
      candidates = [];
      for (let t = lo; t < m.T; t++) {
        if (!c.termsOffered.includes(m.termKinds[t])) continue;
        if (load[t] + c.credits > m.maxCredits) continue;
        candidates.push(t);
      }
      // Lightest term first: the student is enrolled across the whole horizon
      // anyway, so spreading beats cramming.
      candidates.sort((a, b) => load[a] - load[b] || a - b);
    }

    for (const t of candidates) {
      if (locked != null) {
        if (!c.termsOffered.includes(m.termKinds[t])) continue;
        if (load[t] + c.credits > m.maxCredits) continue;
      }
      load[t] += c.credits;
      termOf.set(id, t);
      if (place(i + 1)) return true;
      load[t] -= c.credits;
      termOf.delete(id);
      if (timedOut) return false;
    }
    return false;
  };

  if (!place(0)) {
    // A timeout is not the same answer as "no schedule exists", and conflating
    // them lets the search discard a perfectly good plan and still claim it
    // proved optimality. Say which happened.
    if (timedOut) throw new ScheduleTimeout();
    return null;
  }

  // A real semester, not just the major slice of one.
  //
  // This planner only schedules the courses the MAJOR requires: 47 of
  // Columbia's 124 credits. The other 77 are the Core Curriculum and free
  // electives, which have their own rules we have not ingested. Showing only
  // the major made a first semester with one course in it, which is not a
  // schedule any student would recognise. So the remaining degree credits are
  // spread across the horizon as explicit open slots, and every semester is
  // filled toward a normal load.
  const planCredits = ids.reduce((s, id) => s + m.catalog.get(id)!.credits, 0);
  let openBudget = Math.max(0, m.remainingDegreeCredits - planCredits);

  // A normal semester for this student: the whole remaining degree spread
  // evenly, held between the full-time floor and the registrar's cap.
  const target = Math.max(
    m.minCredits,
    Math.min(m.maxCredits, Math.round(m.remainingDegreeCredits / Math.max(1, m.T))),
  );

  const openNeeded = new Array(m.T).fill(0);
  const belowFullTime: number[] = [];

  // First pass: every semester that has major courses reaches the floor.
  for (let t = 0; t < m.T; t++) {
    if (load[t] <= 0 || load[t] >= m.minCredits) continue;
    const short = m.minCredits - load[t];
    const give = Math.min(short, openBudget);
    openNeeded[t] += give;
    openBudget -= give;
    if (give < short) belowFullTime.push(t);
  }
  // Second pass: top every semester up toward a normal load, so the board
  // shows the student's actual term rather than a third of it.
  for (let t = 0; t < m.T && openBudget > 0; t++) {
    const have = load[t] + openNeeded[t];
    if (have >= target) continue;
    const give = Math.min(target - have, openBudget, m.maxCredits - have);
    openNeeded[t] += give;
    openBudget -= give;
  }

  return {
    termOf,
    termCredits: load,
    termsUsed: load.filter((l) => l > 0).length,
    openCreditsNeeded: openNeeded,
    belowFullTime,
    earliest,
    earliestReason,
  };
}

/** Raised when the packing DFS runs out of time — distinct from infeasible. */
export class ScheduleTimeout extends Error {
  constructor() { super("schedule search timed out"); }
}

/**
 * Earliest term a course could occupy given its prerequisite tree.
 * AND takes the max, OR the min, UNVERIFIABLE is free (§4.1).
 *
 * With `placed` = true, `terms` holds where prerequisites actually landed and
 * an unplaced prerequisite means "not yet, keep looking" rather than
 * "impossible" — the caller is mid-DFS and will place it later.
 */
function earliestPrereqTerm(
  node: PrereqNode | null,
  m: Model,
  chosen: Set<string>,
  terms: Map<string, number>,
  placed = false,
): number {
  if (!node) return 0;
  switch (node.op) {
    case "UNVERIFIABLE": return 0;
    case "COURSE": {
      if (m.completed.has(node.courseId)) return 0;
      if (terms.has(node.courseId)) return terms.get(node.courseId)! + 1;
      if (placed && chosen.has(node.courseId)) return Infinity; // not placed yet
      if (chosen.has(node.courseId)) return 1;
      return Infinity;
    }
    case "AND": {
      let mx = 0;
      for (const c of node.children) {
        const v = earliestPrereqTerm(c, m, chosen, terms, placed);
        if (v === Infinity) return Infinity;
        mx = Math.max(mx, v);
      }
      return mx;
    }
    case "OR": {
      let mn = Infinity;
      for (const c of node.children) {
        mn = Math.min(mn, earliestPrereqTerm(c, m, chosen, terms, placed));
      }
      return mn;
    }
  }
}

/** Kahn's algorithm over the prerequisite DAG, restricted to the chosen set. */
function topological(m: Model, ids: string[], earliest: Map<string, number>): string[] {
  const set = new Set(ids);
  const deps = new Map<string, Set<string>>();
  for (const id of ids) {
    const need = new Set<string>();
    const walk = (n: PrereqNode | null) => {
      if (!n) return;
      if (n.op === "COURSE") { if (set.has(n.courseId)) need.add(n.courseId); }
      else if (n.op === "AND" || n.op === "OR") n.children.forEach(walk);
    };
    walk(m.catalog.get(id)!.prereq);
    need.delete(id);
    deps.set(id, need);
  }

  const out: string[] = [];
  const done = new Set<string>();
  const remaining = new Set(ids);
  while (remaining.size) {
    const ready = [...remaining]
      .filter((id) => [...deps.get(id)!].every((d) => done.has(d)))
      .sort((a, b) =>
        (earliest.get(a)! - earliest.get(b)!) ||
        (m.catalog.get(b)!.credits - m.catalog.get(a)!.credits) ||
        a.localeCompare(b));
    // A cycle would mean the catalog contradicts itself; fall back rather than
    // spin, and let the placement DFS reject it honestly.
    if (!ready.length) { out.push(...remaining); break; }
    const next = ready[0];
    out.push(next);
    done.add(next);
    remaining.delete(next);
  }
  return out;
}

// ─────────────────────────── branch and bound ───────────────────────────────

export type Selection = {
  /** courseId -> bucketId it was chosen to satisfy */
  assignment: Map<string, string>;
  support: Set<string>;
  schedule: Schedule;
  skillMask: number;
  credits: number;
  objective: number;
};

export type SearchResult = {
  best: Selection | null;
  nodes: number;
  provedOptimal: boolean;
  /**
   * True when the search finished looking rather than running out of time.
   * Without this, "I found nothing" and "I did not finish" are the same
   * answer, and a busy server tells a student their degree is impossible.
   */
  exhausted: boolean;
};

/**
 * Depth-first over buckets, most-constrained first, with an admissible bound:
 * the most skills still winnable is the union of everything reachable from the
 * buckets not yet filled. If even that optimistic count cannot beat the
 * incumbent, the whole subtree is dead.
 */
export function search(
  m: Model,
  forbidden: Set<string>[],
  deadline: number,
  nodeLimit = 400_000,
): SearchResult {
  const active = m.buckets.filter((b) => b.remaining > 0);
  // Forced buckets first (no choice to make, so make it and move on), then the
  // skill-densest. Filling the high-payoff buckets early makes `suffixReach`
  // collapse fast, which is what gives the bound its teeth.
  const order = active.slice().sort((a, b) => {
    const fa = waysToFill(a) <= 1 ? 0 : 1;
    const fb = waysToFill(b) <= 1 ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const sa = weightOf(m, a.reachableSkills), sb = weightOf(m, b.reachableSkills);
    if (sb !== sa) return sb - sa;
    return waysToFill(a) - waysToFill(b);
  });

  // Skills a prerequisite dragged into the plan can carry. These courses are
  // not in any bucket pool, so leaving them out of the optimistic term makes
  // the bound too tight and lets it prune a genuinely better plan.
  let supportReach = 0;
  for (const b of m.buckets) {
    for (const id of b.pool) {
      const walk = (n: PrereqNode | null) => {
        if (!n) return;
        if (n.op === "COURSE") {
          const pc = m.catalog.get(n.courseId);
          if (pc) for (const s of (m.courseSkills.get(pc.id) ?? pc.skills)) {
            const i = m.skillIndex.get(normSkill(s.skill));
            if (i !== undefined) supportReach |= 1 << i;
          }
        } else if (n.op === "AND" || n.op === "OR") n.children.forEach(walk);
      };
      walk(m.catalog.get(id)?.prereq ?? null);
    }
  }

  const suffixReach: number[] = new Array(order.length + 1).fill(0);
  const suffixMinCredits: number[] = new Array(order.length + 1).fill(0);
  for (let i = order.length - 1; i >= 0; i--) {
    suffixReach[i] = suffixReach[i + 1] | order[i].reachableSkills;

    // Cheapest conceivable way to finish this bucket, for the credit bound.
    // A bucket that may share its course with a later one (MATH UN2015 counts
    // for both linear algebra and probability, and the bulletin says so) must
    // contribute nothing here — otherwise the bound charges twice for one
    // course, overstates the floor cost, and prunes the true optimum.
    const sharesWithLater = order
      .slice(i + 1)
      .some((later) => order[i].doubleCountWith.has(later.id) || later.doubleCountWith.has(order[i].id));

    const cheapest = order[i].classes.reduce((mn, k) => Math.min(mn, k.credits), Infinity);
    const units = sharesWithLater
      ? 0
      : order[i].unit === "credits"
        ? order[i].remaining
        : order[i].remaining * (isFinite(cheapest) ? cheapest : 0);
    suffixMinCredits[i] = suffixMinCredits[i + 1] + (isFinite(units) ? units : 0);
  }

  let best: Selection | null = null;
  let bestObj = -Infinity;
  let nodes = 0;
  let exhausted = true;

  const assignment = new Map<string, string>();

  const evaluate = () => {
    const chosenCore = new Set(assignment.keys());
    const support = resolveSupport(chosenCore, m.completed, m.catalog, m.excluded);
    if (!support) return;
    const all = new Set<string>([...chosenCore, ...support]);

    // No-good cut (§7.2): this exact course set has already been returned.
    // Compared on the job answering subset when there is one. Cutting on the
    // full course set let the next best plan differ by a symmetric math course
    // and nothing else, which produced "Honors Linear Algebra instead of
    // Linear Algebra" as a serious option on a product management posting.
    // With no posting at all every subset is empty, so the full set is the
    // only thing left to compare.
    const cutSet = m.jobRelevant.size
      ? new Set([...all].filter((id) => m.jobRelevant.has(id)))
      : all;
    for (const f of forbidden) if (sameSet(f, cutSet)) return;

    // Locked courses must appear in the plan (constraint 8).
    for (const id of m.lockedByCourse.keys()) if (!all.has(id)) return;

    // Nothing the bulletin forbids counting together.
    //
    // This was enforced only in the elective filler, so the search itself
    // returned plans holding COMS W3136 and COMS W3137 at once, which
    // Columbia's page for each of them rules out. Checked on the whole course
    // set rather than per bucket, because the two halves of a forbidden pair
    // can be credited to different requirements.
    for (const id of all) {
      const clash = m.catalog.get(id)?.overlapsWith;
      if (clash) for (const other of clash) if (all.has(other)) return;
    }

    let mask = 0;
    let credits = 0;
    for (const id of all) {
      const c = m.catalog.get(id)!;
      credits += c.credits;
      for (const s of (m.courseSkills.get(id) ?? c.skills)) {
        const i = m.skillIndex.get(normSkill(s.skill));
        if (i !== undefined) mask |= 1 << i;
      }
    }
    // Cheap bound before the expensive schedule call: the term penalty can
    // never be lower than zero, so this is the best this set could possibly do.
    const optimistic = Math.round((W_SKILL * weightOf(m, mask)) / WEIGHT_SCALE) - W_CREDIT * credits;
    if (!NO_PRUNE && optimistic <= bestObj) return;

    let sched: Schedule | null;
    try {
      sched = schedule(m, all, deadline);
    } catch (e) {
      // Out of time, not out of options. Dropping this candidate silently would
      // discard a plan that may well be the best one — and worse, would leave
      // `provedOptimal` true while it happened.
      if (e instanceof ScheduleTimeout) { exhausted = false; return; }
      throw e;
    }
    if (!sched) return;

    const obj = objectiveOf(m, mask, credits, sched.termsUsed);
    if (obj > bestObj) {
      bestObj = obj;
      best = {
        assignment: new Map(assignment),
        support,
        schedule: sched,
        skillMask: mask,
        credits,
        objective: obj,
      };
    }
  };

  const fill = (bi: number, maskSoFar: number, creditsSoFar: number) => {
    if (Date.now() > deadline || nodes > nodeLimit) { exhausted = false; return; }
    nodes++;
    if (bi === order.length) { evaluate(); return; }

    const bucket = order[bi];

    // How much of this bucket is already covered by courses picked for an
    // earlier bucket that mutually double-counts with it (constraint 7).
    let already = 0;
    for (const [cid, bid] of assignment) {
      if (bucket.doubleCountWith.has(bid) && bucket.pool.includes(cid)) {
        already += bucket.unit === "credits" ? (m.catalog.get(cid)?.credits ?? 0) : 1;
      }
    }
    const need = bucket.remaining - already;
    if (need <= 0) { fill(bi + 1, maskSoFar, creditsSoFar); return; }

    // Admissible bound. Optimistic on skills (assume every skill still
    // reachable is won), pessimistic on cost (assume the cheapest possible way
    // to finish every remaining bucket, and a zero term penalty). Nothing in
    // this subtree can score above it, so if it can't beat the incumbent the
    // whole subtree is dead.
    // Still admissible: every weight is positive, so the value of a superset
    // mask is never less than the value of any mask reachable inside it.
    const upper =
      Math.round((W_SKILL * weightOf(m, maskSoFar | suffixReach[bi] | supportReach)) / WEIGHT_SCALE) -
      W_CREDIT * (creditsSoFar + suffixMinCredits[bi]);
    if (!NO_PRUNE && upper <= bestObj) return;

    const picked: string[] = [];

    const chooseFrom = (ci: number, left: number, credAcc: number, maskAcc: number) => {
      if (Date.now() > deadline || nodes > nodeLimit) { exhausted = false; return; }
      if (left <= 0) {
        fill(bi + 1, maskSoFar | maskAcc, creditsSoFar + credAcc);
        return;
      }
      if (ci >= bucket.classes.length) return;

      // Bound again inside the bucket — cost accumulates as we commit courses.
      const remainingHere = bucket.classes.slice(ci).reduce((mn, k) => Math.min(mn, k.credits), Infinity);
      const sharesLater = order.slice(bi + 1).some(
        (later) => bucket.doubleCountWith.has(later.id) || later.doubleCountWith.has(bucket.id));
      const floorCost = sharesLater || !isFinite(remainingHere)
        ? 0
        : (bucket.unit === "credits" ? left : left * remainingHere);
      const innerUpper =
        Math.round((W_SKILL * weightOf(m, maskSoFar | maskAcc | suffixReach[bi] | supportReach)) / WEIGHT_SCALE) -
        W_CREDIT * (creditsSoFar + credAcc + floorCost + suffixMinCredits[bi + 1]);
      if (!NO_PRUNE && innerUpper <= bestObj) return;

      const klass = bucket.classes[ci];
      // Courses that can actually be taken together, in order.
      //
      // Two things are being avoided. A member that clashes with something
      // already committed on this branch, and a member that clashes with an
      // earlier member of this same list. The second one matters more than it
      // looks: with no job description every course has an empty skill mask, so
      // a symmetry class can hold COMS W3134, W3136 and W3137 at once, and
      // taking the first two off the front produced a pair the bulletin
      // forbids on every single branch. The set was thrown out at the end each
      // time, so the search burned two million nodes and reported that a
      // perfectly ordinary four term plan was impossible.
      const available: string[] = [];
      for (const id of klass.members) {
        if (assignment.has(id)) continue;
        const clash = m.catalog.get(id)?.overlapsWith;
        if (clash && clash.some((o) => assignment.has(o) || available.includes(o))) continue;
        available.push(id);
      }
      const unitSize = bucket.unit === "credits" ? klass.credits : 1;
      const maxTake = Math.min(available.length, Math.ceil(left / unitSize));

      for (let take = maxTake; take >= 0; take--) {
        const chosenIds = available.slice(0, take);
        chosenIds.forEach((id) => { assignment.set(id, bucket.id); picked.push(id); });
        chooseFrom(
          ci + 1,
          left - take * unitSize,
          credAcc + take * klass.credits,
          maskAcc | (take > 0 ? klass.skillMask : 0),
        );
        chosenIds.forEach((id) => { assignment.delete(id); picked.pop(); });
        // The two sibling checks above both record that the search was cut
        // short. This one did not, so hitting the node cap here reported "no
        // plan fits in 4 terms" for a plan that fits perfectly well.
        if (Date.now() > deadline || nodes > nodeLimit) { exhausted = false; return; }
      }
    };

    chooseFrom(0, need, 0, 0);
  };

  // Warm start: take the greedy best-first pick in every bucket and evaluate
  // it once. It costs one schedule call and gives the bound something real to
  // prune against from the very first node instead of -Infinity.
  greedyWarmStart(m, order, assignment, evaluate);

  fill(0, 0, 0);
  // `exhausted` is the difference between "there is no plan" and "I did not
  // finish looking". Reporting the second as the first tells a student their
  // degree is impossible because a server was busy.
  return { best, nodes, provedOptimal: exhausted && best !== null, exhausted };
}

/**
 * maximise  W_skill · (distinct skills covered) − W_credit · (credits taken)
 *
 * Terms are a CONSTRAINT here, not a cost, and BUILD_SPEC §7.1's `W_term` is
 * deliberately not applied. The horizon is the student's own statement of how
 * long they will be enrolled; finishing the major inside it two terms early
 * graduates nobody, it just leaves the freedom this product exists to spend
 * sitting unused. Charging for it also broke the search outright: because the
 * packer spreads across the whole horizon, `termsUsed` was always exactly `T`,
 * so the penalty was a constant that lowered every candidate equally — no plan
 * could ever avoid it — while dragging the incumbent down far enough that
 * pruning collapsed. An eight-term horizon went from 22 nodes to 2,115 and
 * timed out on a plan a four-term horizon solved instantly, which is how a
 * longer horizon ended up covering *fewer* skills than a shorter one.
 *
 * With terms out of the objective the score no longer depends on `T` at all,
 * so a longer horizon is a strictly weaker constraint and can never do worse.
 * `scripts/solver-test.ts` asserts exactly that.
 */
export function objectiveOf(m: Model, mask: number, credits: number, _termsUsed: number): number {
  // W_SKILL is applied per unit of weight rather than per requirement, so a
  // plan that answers one decisive requirement can beat one that answers three
  // requirements every course in the catalog already satisfies.
  return Math.round((W_SKILL * weightOf(m, mask)) / WEIGHT_SCALE) - W_CREDIT * credits;
}

function greedyWarmStart(
  m: Model,
  order: BucketModel[],
  assignment: Map<string, string>,
  evaluate: () => void,
) {
  for (const bucket of order) {
    let left = bucket.remaining;
    for (const klass of bucket.classes) {
      if (left <= 0) break;
      const unitSize = bucket.unit === "credits" ? klass.credits : 1;
      for (const id of klass.members) {
        if (left <= 0) break;
        if (assignment.has(id)) continue;
        assignment.set(id, bucket.id);
        left -= unitSize;
      }
    }
  }
  evaluate();
  assignment.clear();
}

function maskOfCourse(m: Model, id: string): number {
  const c = m.catalog.get(id);
  if (!c) return 0;
  let mask = 0;
  for (const s of (m.courseSkills.get(id) ?? c.skills)) {
    const i = m.skillIndex.get(normSkill(s.skill));
    if (i !== undefined) mask |= 1 << i;
  }
  return mask;
}

function waysToFill(b: BucketModel): number {
  const n = b.classes.length;
  const k = Math.min(b.remaining, n);
  if (k <= 0) return 1;
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
