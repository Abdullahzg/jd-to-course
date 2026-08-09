// Canonical, university-agnostic data model. BUILD_SPEC §4.
// Per-university code lives ONLY in /data adapters. Nothing here knows about
// Columbia or BMCC.

export type Term = "FA" | "SP" | "SU";

/** BUILD_SPEC §4.1 — UNVERIFIABLE is a feature, not a gap. */
export type PrereqNode =
  | { op: "AND"; children: PrereqNode[] }
  | { op: "OR"; children: PrereqNode[] }
  | { op: "COURSE"; courseId: string }
  | { op: "UNVERIFIABLE"; text: string };

/** BUILD_SPEC §6.0 — nothing enters the model without a citation. */
export type Source = {
  /** the exact page, not the catalog homepage */
  url: string;
  /** verbatim sentence stating this rule */
  quote: string;
  /** ISO date — catalogs change */
  retrievedAt: string;
  /** committed raw capture under /data/snapshots */
  snapshotPath: string;
};

export type SkillEvidence = {
  /**
   * How much this course matters for the requirement, from the fit pass.
   * Computed for every course and then thrown away for a while, which is how a
   * plan came to skip four courses its own reader called central in favour of
   * one it called merely useful.
   */
  strength?: "central" | "useful" | "tangential";
  skill: string;
  /** verbatim sentence from the course description. No sentence -> no skill. */
  evidence: string;
  /** The ranking pass's one line: why THIS course for this part, next to its rivals. */
  why?: string;
};

export type Course = {
  id: string; // "COLUMBIA:COMSW4995"
  code: string; // "COMS W4995"
  title: string;
  credits: number;
  description: string;
  prereq: PrereqNode | null;
  coreq: string[];
  termsOffered: Term[];
  level: "UG" | "GR";
  /** free text, surfaced as warnings, never enforced silently */
  restrictions: string[];
  /**
   * Courses that cannot both count toward the degree, from the bulletin's own
   * "students may only receive credit for either" sentence. Enforced, because
   * the alternative is charging a student for credits that will not count.
   */
  overlapsWith?: string[];
  /** false = a human has not reviewed the parse */
  verified: boolean;
  sourceUrl: string;
  skills: SkillEvidence[];
};

export type RequirementBucket = {
  id: string; // "COLUMBIA:CS_BA:AREA_FOUNDATION"
  label: string;
  needCredits?: number;
  needCourses?: number;
  eligible: string[];
  allowDoubleCount: string[];
  source: Source; // REQUIRED
};

export type Program = {
  id: string;
  name: string;
  level: "UG" | "GR";
  school: string;
  /** total credits for the whole degree, incl. requirements outside the major */
  totalCredits: number;
  /** credits governed by the buckets below */
  majorCredits: number;
  maxCreditsPerTerm: number;
  minCreditsPerTerm: number;
  buckets: RequirementBucket[];
  sources: Source[];
};

export type School = {
  id: string;
  name: string;
  shortName: string;
  /** what makes this school structurally different — drives the scale story */
  structureNote: string;
  catalogUrl: string;
  programs: Program[];
  courses: Course[];
};

export type StudentState = {
  completed: string[];
  program: string;
  startTerm: Term;
  horizonTerms: number;
  locked: { courseId: string; term: number }[];
  excluded: string[];
  /** credits already earned toward totalCredits */
  completedCredits: number;
};

// ─────────────────────────── solver I/O ───────────────────────────

export type SolveRequest = {
  schoolId: string;
  programId: string;
  student: StudentState;
  /** flat skill strings from the job description (AI-extracted, §5 use 3) */
  targetSkills: string[];
  /**
   * targetSkill -> the catalog's own words for the same thing, aligned by
   * /api/match. Absent means fall back to exact wording plus the static table.
   */
  skillMatches?: Record<string, string[]>;
  /**
   * courseId -> what a model found this course teaches, each with the verbatim
   * sentence from the description that proves it (/api/relevance). When this is
   * present it REPLACES the catalog's hand written skill lists, because it was
   * derived by reading the description against this specific job.
   */
  relevance?: Record<string, { skill: string; evidence: string; strength?: "central" | "useful" | "tangential"; why?: string; rank?: number }[]>;
  /**
   * How much each part of the work matters to this job: core, supporting or
   * incidental. Multiplied by how rare the part is in the catalog to decide
   * what a plan covering it is actually worth.
   */
  centrality?: Record<string, string>;
  /** how many alternative plans to return */
  k?: number;
  /** relaxations applied — used by counterfactuals */
  relax?: Relaxation;
};

export type Relaxation = {
  extraTerms?: number;
  extraCreditsPerTerm?: number;
  allowSummer?: boolean;
};

export type Placement = {
  courseId: string;
  term: number;
  /** bucket this course was assigned to satisfy (constraint 7: single-count) */
  bucketId: string;
  locked: boolean;
  /** prereq tree contained an UNVERIFIABLE node -> needs advisor check */
  needsAdvisorCheck: boolean;
  unverifiableText: string[];
  /** The prerequisite tree was parsed, not read by a person. Said in the app's
   *  own voice, never quoted as if the catalog had written it. */
  parseUnreviewed?: boolean;
  /** target skills this course covers, with evidence */
  covers: SkillEvidence[];
  /** why the solver could not place it earlier */
  earliestTerm: number;
  earliestReason: string;
  /**
   * When this course satisfies no requirement of its own, the planned courses
   * whose prerequisites it unlocks. "Prerequisite for COMS W4995" is a reason;
   * a bare "extra" is not.
   */
  unlocks: string[];
};

export type BucketStatus = {
  bucketId: string;
  label: string;
  need: number;
  /** unit of `need` */
  unit: "courses" | "credits";
  fromCompleted: number;
  /** exactly which finished courses were credited here, one course one slot */
  fromCompletedCourses: string[];
  fromPlan: number;
  satisfied: boolean;
  source: Source;
  eligibleCount: number;
  allowDoubleCount: string[];
};

/**
 * One course that could take the same slot, and what changes if it does.
 *
 * The page used to be handed only `deltaSkills`, meaning what a swap would ADD.
 * Nothing measured what it would REMOVE, so a course answering nothing at all
 * arrived with an empty gains list and was printed as "just as good for this
 * job, no reason to prefer either" next to a course that answered the posting.
 * On a product manager posting that sentence appeared beside Operating Systems
 * and Graph Theory. Both directions are measured now.
 */
export type SlotAlternative = {
  courseId: string;
  /** Job parts this one answers that the chosen course does not. */
  deltaSkills: string[];
  /** Job parts the chosen course answers that this one does not. */
  losesSkills: string[];
  /** The subset of `losesSkills` no other course now in the plan answers. */
  lossesNoOtherPlannedCourseAnswers: string[];
  deltaCredits: number;
  /**
   * Credits of prerequisites this course needs that the rest of the plan does
   * not already supply. Comparing the two courses' own credit lines reports
   * "same credits" for a swap that quietly drags in three more courses.
   */
  extraPrereqCredits: number;
  /** Requirements that would fall short if this swap were made. */
  stopsSatisfying: string[];
  /**
   * True only when the solver proved the two interchangeable: identical job
   * skills, credits, terms offered and prerequisite tree. This is the only
   * thing that may ever be described as an equal choice.
   */
  sameClass: boolean;
  /** The judge's strongest-first position for this course. Lower is better. */
  rank?: number;
};

/** Where a bucket has several legal fillers, the interface asks. §9.3 */
export type SlotChoice = {
  bucketId: string;
  term: number;
  chosen: string;
  alternatives: SlotAlternative[];
};

export type Plan = {
  id: string;
  label: string;
  placements: Placement[];
  buckets: BucketStatus[];
  termCredits: number[];
  /** open (non-major) credits needed to reach the full-time floor, per term */
  openCreditsNeeded: number[];
  /** terms that land under the full-time floor even after open credits */
  belowFullTime: number[];
  /** terms the student must enrol for anyway to finish the degree */
  minTermsRequired: number;
  objective: number;
  skillsCovered: string[];
  totalCredits: number;
  termsUsed: number;
  slotChoices: SlotChoice[];
  /** one-line diff vs. Plan A */
  diffFromBest: string;
};

export type Counterfactual = {
  change: string;
  deltaSkills: number;
  deltaCredits: number;
  deltaTerms: number;
  newSkills: string[];
  feasible: boolean;
};

export type CoverageReport = {
  covered: { skill: string; courseId: string; courseCode: string; evidence: string; sourceUrl: string }[];
  availableIfYouSwap: {
    skill: string;
    courseId: string;
    courseCode: string;
    replaces: string;
    replacesCode: string;
    bucketId: string;
    extraCredits: number;
    evidence: string;
  }[];
  courseworkCannotGive: { skill: string; reason: string }[];
};

export type Infeasibility = {
  /** student-facing, never the word "infeasible" */
  message: string;
  blockingBuckets: { bucketId: string; label: string; detail: string }[];
  suggestions: Counterfactual[];
  /**
   * The search was cut off before it finished. This is not a statement that no
   * plan exists, and the page must not present it as one.
   */
  timedOut?: boolean;
};

export type SolveResponse = {
  ok: boolean;
  plans: Plan[];
  coverage: CoverageReport | null;
  counterfactuals: Counterfactual[];
  infeasibility: Infeasibility | null;
  stats: {
    nodesExplored: number;
    ms: number;
    /** true = search space exhausted, the plan is provably optimal */
    provedOptimal: boolean;
    candidateCourses: number;
    symmetryClasses: number;
  };
};
