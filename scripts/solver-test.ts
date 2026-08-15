/**
 * Solver test harness. Run: npx tsx scripts/solver-test.ts
 *
 * This is the negative feedback loop for the solver: every assertion here is a
 * way the solver could silently produce a wrong plan. A plan that violates a
 * prerequisite or a credit cap is worse than no plan, because a student would
 * act on it.
 */
import { solve, solveResilient, fillOpenCredits } from "@/lib/solver";
import { buildModel, prereqSatisfied } from "@/lib/solver/core";
import { SCHOOLS, DEMO_STUDENT, getProgram, getSchool, DEMO_JD_ML, DEMO_JD_BACKEND, DEMO_JD_SECURITY } from "@/data";
import type { SolveRequest, Plan, Course, Term } from "@/lib/types";
import { termKindsFor, verifyPlan } from "@/lib/verify";
import { earliestLegalTerm, latePrereq, legalMoves, studentForNewPosting, type BoardView } from "@/lib/plan-edits";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) console.log(`  [32mPASS[0m ${name}`);
  else { console.log(`  [31mFAIL[0m ${name}${detail ? ` — ${detail}` : ""}`); failures++; }
};

const ML_SKILLS = [
  "PyTorch", "Machine learning", "Deep learning", "Distributed systems",
  "Python", "Kubernetes", "SQL", "Linux", "Containers", "Model serving",
  "Data engineering", "3 years of production experience", "Shipped ML systems at scale",
];

function auditPlan(label: string, req: SolveRequest, plan: Plan) {
  const school = getSchool(req.schoolId)!;
  const program = getProgram(req.schoolId, req.programId)!;
  const m = buildModel(school, program, req.student, req.targetSkills, req.relax ?? {});

  // Constraint 1 — each course at most once.
  const ids = plan.placements.map((p) => p.courseId);
  check(`${label}: no course appears twice`, new Set(ids).size === ids.length);

  // Constraint 1b — never re-take something already completed.
  check(`${label}: no completed course is re-planned`,
    ids.every((id) => !m.completed.has(id)),
    ids.filter((id) => m.completed.has(id)).join(", "));

  // Constraint 2 — term credit cap.
  const overCap = plan.termCredits.filter((c) => c > m.maxCredits);
  check(`${label}: no term exceeds the ${m.maxCredits}-credit cap`, overCap.length === 0,
    `terms at ${overCap.join(", ")}`);

  // Constraint 5 — availability.
  const badTerm = plan.placements.filter((p) => {
    const c = m.catalog.get(p.courseId)!;
    return !c.termsOffered.includes(m.termKinds[p.term]);
  });
  check(`${label}: every course is placed in a term it is offered`, badTerm.length === 0,
    badTerm.map((p) => `${m.catalog.get(p.courseId)!.code}@T${p.term}`).join(", "));

  // Constraint 4 — prerequisites satisfied strictly earlier.
  const badPrereq = plan.placements.filter((p) => {
    const before = new Set<string>(m.completed);
    for (const q of plan.placements) if (q.term < p.term) before.add(q.courseId);
    return !prereqSatisfied(m.catalog.get(p.courseId)!.prereq, before);
  });
  check(`${label}: every prerequisite is satisfied before the course`, badPrereq.length === 0,
    badPrereq.map((p) => m.catalog.get(p.courseId)!.code).join(", "));

  // Constraint 6 — every bucket satisfied.
  const unmet = plan.buckets.filter((b) => !b.satisfied);
  check(`${label}: every requirement bucket is satisfied`, unmet.length === 0,
    unmet.map((b) => `${b.label} ${b.fromCompleted + b.fromPlan}/${b.need}`).join("; "));

  // Horizon.
  check(`${label}: nothing is placed past the horizon`,
    plan.placements.every((p) => p.term >= 0 && p.term < m.T));

  // Every rule carries a citation (§6.0).
  check(`${label}: every requirement bucket cites a source`,
    plan.buckets.every((b) => b.source?.url && b.source.quote && b.source.retrievedAt));

  // Constraint 7 — single-count, for completed coursework as well as the plan.
  // Overlapping eligible lists (Columbia's elective rule textually contains the
  // core) must not let one finished course satisfy two requirements.
  const doubleCountable = program.buckets.filter((b) =>
    b.allowDoubleCount.some((o) => program.buckets.find((x) => x.id === o)?.allowDoubleCount.includes(b.id)),
  ).length;
  const creditedFromCompleted = plan.buckets.reduce((s, b) => s + b.fromCompleted, 0);
  check(`${label}: completed courses are counted once each`,
    creditedFromCompleted <= req.student.completed.length + doubleCountable,
    `${creditedFromCompleted} credits from ${req.student.completed.length} completed courses`);

  // No two courses the bulletin says cannot both count.
  //
  // Added after a plan was found holding Linear Algebra and Honors Linear
  // Algebra together, which Columbia's own page for the second one forbids in
  // the sentence directly under its title. The rule was in the snapshot, the
  // parser could not read it, and nothing here was looking, so it shipped.
  const planned = new Set(plan.placements.map((x) => x.courseId));
  const clashes: string[] = [];
  for (const p of plan.placements) {
    const c = catalogOf(req.schoolId).get(p.courseId);
    for (const other of c?.overlapsWith ?? []) {
      if (planned.has(other) && p.courseId < other) {
        clashes.push(`${c!.code} + ${catalogOf(req.schoolId).get(other)?.code ?? other}`);
      }
    }
  }
  check(`${label}: no two courses that cannot both count`, clashes.length === 0, clashes.join("; "));

  // Each planned course serves exactly one bucket.
  const byBucket = new Map<string, number>();
  for (const p of plan.placements) byBucket.set(p.bucketId, (byBucket.get(p.bucketId) ?? 0) + 1);
  check(`${label}: each planned course serves exactly one requirement`,
    plan.placements.length === [...byBucket.values()].reduce((a, b) => a + b, 0));
}

/** The merged catalog for a school, by course id. */
const catalogCache = new Map<string, Map<string, Course>>();
function catalogOf(schoolId: string): Map<string, Course> {
  let m = catalogCache.get(schoolId);
  if (!m) {
    m = new Map((getSchool(schoolId)?.courses ?? []).map((c) => [c.id, c]));
    catalogCache.set(schoolId, m);
  }
  return m;
}

/**
 * The same check, over the courses that fill the open credits.
 *
 * The solver's own placements were clean and the plan on screen still held both
 * Linear Algebra and Honors Linear Algebra, because the clash was between two
 * fillers and the filler runs after the solver. A check that stops at
 * `plan.placements` therefore proves nothing about what the student sees.
 */
function auditFiller(label: string, req: SolveRequest, plan: Plan) {
  const cat = catalogOf(req.schoolId);
  const terms = fillOpenCredits({
    catalog: getSchool(req.schoolId)?.courses ?? [],
    plan,
    completed: req.student.completed,
    termKinds: Array.from({ length: plan.termCredits.length },
      (_, i) => (i % 2 === 0 ? "FA" : "SP")) as Term[],
  });
  const all = [
    ...plan.placements.map((p) => p.courseId),
    ...terms.flatMap((t) => t.picks.map((o) => o.courseId)),
  ];
  const seen = new Set(all);
  const clashes: string[] = [];
  for (const id of seen) {
    for (const other of cat.get(id)?.overlapsWith ?? []) {
      if (seen.has(other) && id < other) {
        clashes.push(`${cat.get(id)?.code} + ${cat.get(other)?.code}`);
      }
    }
  }
  check(`${label}: filled plan holds no two courses that cannot both count`,
    clashes.length === 0, clashes.join("; "));

  // And nothing appears twice across the whole filled plan.
  const dupes = all.filter((id, i) => all.indexOf(id) !== i)
    .map((id) => cat.get(id)?.code ?? id);
  check(`${label}: filled plan schedules no course twice`,
    dupes.length === 0, [...new Set(dupes)].join(", "));
}

console.log("\n[1mSOLVER TEST[0m\n");

// ── 1. Columbia, ML persona ──────────────────────────────────────────────────
console.log("Columbia CS BA — ML engineer target, 4 terms");
const req1: SolveRequest = {
  schoolId: "COLUMBIA",
  programId: "COLUMBIA:CS_BA",
  student: DEMO_STUDENT,
  targetSkills: ML_SKILLS,
  k: 3,
};
const r1 = solve(req1, 6000);
check("returns a plan", r1.ok && r1.plans.length > 0, r1.infeasibility?.message ?? "");
if (r1.ok) {
  auditPlan("columbia", req1, r1.plans[0]);
  auditFiller("columbia", req1, r1.plans[0]);
  check("returns more than one alternative plan (K-best)", r1.plans.length > 1,
    `got ${r1.plans.length}`);
  check("alternative plans are genuinely different course sets",
    r1.plans.length < 2 || r1.plans.slice(1).every((p) => {
      const a = new Set(r1.plans[0].placements.map((x) => x.courseId));
      const b = new Set(p.placements.map((x) => x.courseId));
      return a.size !== b.size || [...a].some((x) => !b.has(x));
    }));
  check("coverage has a 'coursework cannot give you' bucket",
    (r1.coverage?.courseworkCannotGive.length ?? 0) > 0);
  check("the experience requirements land in that third bucket",
    !!r1.coverage?.courseworkCannotGive.some((c) => /years|scale/i.test(c.skill)),
    JSON.stringify(r1.coverage?.courseworkCannotGive.map((c) => c.skill)));
  check("counterfactuals were computed", r1.counterfactuals.length === 3);
  // A number next to a percent sign, which is what fake precision looks like.
  // A bare "%" also matches the percent encoding in a bulletin URL
  // (?P=COMS%20W4771), so the looser test started failing the moment every
  // course got its own link, for a reason that has nothing to do with the rule.
  // Nothing offered as an equal choice may cost the student anything.
  //
  // The dropdown printed "Just as good for this job. No reason to prefer
  // either." whenever an alternative ADDED nothing, which is exactly what a
  // course answering nothing at all looks like. Measured on a product manager
  // posting, 28 of 40 alternatives were saying it while losing a part of the
  // job or leaving a degree requirement short.
  {
    const lying: string[] = [];
    for (const p of r1.plans) {
      for (const sc of p.slotChoices) {
        for (const a of sc.alternatives) {
          if (!a.sameClass) continue;
          if (a.losesSkills.length || a.stopsSatisfying.length || a.extraPrereqCredits || a.deltaCredits) {
            lying.push(`${sc.chosen} -> ${a.courseId}`);
          }
        }
      }
    }
    check("nothing called interchangeable actually costs the student something",
      lying.length === 0, lying.slice(0, 5).join("; "));
  }

  // Percent encoding in a bulletin URL (?P=COMS%20W4771) is not a percentage,
  // and this check started failing the moment every course got its own link.
  // The triplets come out first, then the original rule applies unchanged: any
  // remaining percent sign is fake precision.
  check("no percentage figure is quoted anywhere in the coverage report",
    !JSON.stringify(r1.coverage).replace(/%[0-9A-Fa-f]{2}/g, "").includes("%"));

  console.log(`\n  plan A: ${r1.plans[0].placements.length} courses, ${r1.plans[0].totalCredits} cr, ` +
    `${r1.plans[0].termsUsed} terms, covers ${r1.plans[0].skillsCovered.length}/${ML_SKILLS.length} skills`);
  for (let t = 0; t < r1.plans[0].termCredits.length; t++) {
    const inTerm = r1.plans[0].placements.filter((p) => p.term === t);
    if (!inTerm.length) continue;
    const school = getSchool("COLUMBIA")!;
    const cat = new Map(school.courses.map((c) => [c.id, c]));
    console.log(`    T${t} (${r1.plans[0].termCredits[t]} cr): ` +
      inTerm.map((p) => cat.get(p.courseId)!.code + (p.needsAdvisorCheck ? " ⚠" : "")).join(", "));
  }
  console.log(`  covers: ${r1.plans[0].skillsCovered.join(", ")}`);
  console.log(`  cannot give: ${r1.coverage?.courseworkCannotGive.map((c) => c.skill).join(", ")}`);
  console.log(`  swaps available: ${r1.coverage?.availableIfYouSwap.map((s) => s.skill).join(", ") || "none"}`);
  for (const cf of r1.counterfactuals) {
    console.log(`  counterfactual: ${cf.change} → ${cf.feasible
      ? `${cf.deltaSkills >= 0 ? "+" : ""}${cf.deltaSkills} skills, ${cf.deltaCredits >= 0 ? "+" : ""}${cf.deltaCredits} cr, ${cf.deltaTerms >= 0 ? "+" : ""}${cf.deltaTerms} terms`
      : "no plan"}`);
  }
  console.log(`  stats: ${r1.stats.nodesExplored} nodes, ${r1.stats.ms}ms, provedOptimal=${r1.stats.provedOptimal}, ` +
    `${r1.stats.candidateCourses} candidates → ${r1.stats.symmetryClasses} symmetry classes`);
}

// ── 2. (BMCC adapter test removed: the product ships Columbia only, by request) ──

// ── 3. Infeasibility must explain itself, never blank ────────────────────────
console.log("\nInfeasible case — 1 term for a whole major");
const r3 = solve({ ...req1, student: { ...DEMO_STUDENT, horizonTerms: 1 }, k: 1 }, 5000);
check("reports not-ok", !r3.ok);
check("has a student-facing message", !!r3.infeasibility?.message);
check("never says the word 'infeasible'", !/infeasible/i.test(r3.infeasibility?.message ?? ""));
check("names at least one blocking requirement or explains why not",
  (r3.infeasibility?.blockingBuckets.length ?? 0) > 0 || !!r3.infeasibility?.message);
console.log(`  message: ${r3.infeasibility?.message}`);
for (const b of r3.infeasibility?.blockingBuckets ?? []) console.log(`    · ${b.label}: ${b.detail}`);

// ── 4. Locks (constraint 8) ──────────────────────────────────────────────────
console.log("\nLock a course into a term");
if (r1.ok) {
  const target = r1.plans[0].placements.find((p) => p.term > 0);
  if (target) {
    const r4 = solve({
      ...req1,
      student: { ...DEMO_STUDENT, locked: [{ courseId: target.courseId, term: target.term }] },
      k: 1,
    }, 5000);
    check("solves with a lock", r4.ok);
    check("the locked course is where it was pinned",
      !!r4.plans[0]?.placements.find((p) => p.courseId === target.courseId && p.term === target.term));
    check("the locked course is flagged as locked",
      !!r4.plans[0]?.placements.find((p) => p.courseId === target.courseId)?.locked);
    if (r4.ok) auditPlan("locked", { ...req1, student: { ...DEMO_STUDENT, locked: [{ courseId: target.courseId, term: target.term }] } }, r4.plans[0]);
  }
}

// ── 5. Exclusions (constraint 9) ─────────────────────────────────────────────
// Excluding a course from a bucket with no slack (Columbia's core is 5-of-5)
// SHOULD be reported as having no plan — that is the solver being right, not
// wrong. Pick from a bucket that genuinely has alternatives.
console.log("\nExclude a course the solver wanted");
if (r1.ok) {
  const slackBuckets = new Set(["COLUMBIA:CS_BA:AREA_FOUNDATION", "COLUMBIA:CS_BA:CS_ELECTIVE"]);
  const victim = r1.plans[0].placements.find((p) => slackBuckets.has(p.bucketId))!;
  const r5 = solve({
    ...req1,
    student: { ...DEMO_STUDENT, excluded: [victim.courseId] },
    k: 1,
  }, 5000);
  check("still solves after an exclusion", r5.ok, r5.infeasibility?.message ?? "");
  check("the excluded course is gone",
    !r5.plans[0]?.placements.some((p) => p.courseId === victim.courseId));
  if (r5.ok) auditPlan("excluded", { ...req1, student: { ...DEMO_STUDENT, excluded: [victim.courseId] } }, r5.plans[0]);
}

// ── 6. No job description at all ─────────────────────────────────────────────
console.log("\nNo target skills (empty job description)");
const r6 = solve({ ...req1, targetSkills: [], k: 1 }, 5000);
check("still produces a valid degree plan", r6.ok, r6.infeasibility?.message ?? "");
if (r6.ok) {
  auditPlan("no-jd", { ...req1, targetSkills: [] }, r6.plans[0]);
  auditFiller("no-jd", { ...req1, targetSkills: [] }, r6.plans[0]);
}

// ── 6b. Monotonicity — more room must never buy you less ─────────────────────
// A longer horizon is a strictly weaker constraint, so the best plan under it
// can never cover fewer skills. When this fails it means the search is quietly
// discarding candidates (a scheduling timeout read as infeasibility, say) while
// still reporting that it proved optimality.
console.log("\nMonotonicity — a longer horizon can never cover fewer skills");
{
  const fresh = {
    program: "COLUMBIA:CS_BA", completed: [], startTerm: "FA" as const,
    horizonTerms: 4, locked: [], excluded: [], completedCredits: 0,
  };
  let previous = -1;
  let previousT = 0;
  let ok = true;
  const line: string[] = [];
  for (const T of [4, 5, 6, 7, 8]) {
    const r = solve({
      schoolId: "COLUMBIA", programId: "COLUMBIA:CS_BA",
      student: { ...fresh, horizonTerms: T }, targetSkills: ML_SKILLS, k: 1,
    }, 8000);
    const n = r.ok ? r.plans[0].skillsCovered.length : -1;
    line.push(`${T}t→${n < 0 ? "none" : n}`);
    if (previous >= 0 && n < previous) {
      ok = false;
      console.log(`  [31m  ${previousT} terms covered ${previous}, ${T} terms covered ${n}[0m`);
    }
    previous = n;
    previousT = T;
  }
  check(`a brand-new undergraduate gets a plan at every horizon`, previous >= 0);
  check(`skills covered never decrease as the horizon grows (${line.join(" ")})`, ok);
}

// ── 7. Provenance validator (§6.0) ───────────────────────────────────────────
console.log("\nProvenance — every rule carries a resolvable citation");
for (const school of SCHOOLS) {
  for (const program of school.programs) {
    const bad = program.buckets.filter(
      (b) => !b.source?.url?.startsWith("http") || !b.source.quote || !b.source.retrievedAt,
    );
    check(`${school.shortName}/${program.name}: all buckets cited`, bad.length === 0,
      bad.map((b) => b.label).join(", "));
    check(`${school.shortName}/${program.name}: credit cap cited`,
      program.sources.some((s) => /credit|point/i.test(s.quote)));
    const emptyPools = program.buckets.filter((b) => b.eligible.length === 0);
    check(`${school.shortName}/${program.name}: no bucket has an empty eligible list`,
      emptyPools.length === 0, emptyPools.map((b) => b.label).join(", "));
    const catalogIds = new Set(school.courses.map((c) => c.id));
    const dangling = program.buckets.flatMap((b) =>
      b.eligible.filter((id) => !catalogIds.has(id)).map((id) => `${b.label}:${id}`));
    check(`${school.shortName}/${program.name}: no bucket references a missing course`,
      dangling.length === 0, dangling.join(", "));
  }
  // Prereq trees may only reference courses that exist in this catalog.
  const ids = new Set(school.courses.map((c) => c.id));
  const danglingPrereq: string[] = [];
  const walk = (n: any, code: string) => {
    if (!n) return;
    if (n.op === "COURSE" && !ids.has(n.courseId)) danglingPrereq.push(`${code} → ${n.courseId}`);
    if (n.children) n.children.forEach((c: any) => walk(c, code));
  };
  school.courses.forEach((c) => walk(c.prereq, c.code));
  check(`${school.shortName}: no prerequisite points at a course outside the catalog`,
    danglingPrereq.length === 0, danglingPrereq.join(", "));
}

// ── Hand edits: a term is only an answer if the prerequisites are behind it ──
// Both of these shipped wrong once. The panel told a student to put Data
// Structures in Fall 2026 to repair a course that needed it, when Fall 2026
// sits in front of the Programming in Java that Data Structures itself
// requires; and it offered seven "Move to ..." buttons for a course stranded
// in front of its own prerequisite, the first of them EARLIER still.
{
  console.log("\nHand edits \u2014 a legal term has the prerequisites behind it");
  const school = getSchool("COLUMBIA")!;
  const courses = new Map(school.courses.map((c) => [c.id, c]));
  const termKinds = termKindsFor("FA" as Term, 8);
  const W1004 = "COLUMBIA:COMSW1004";  // Programming in Java
  const W3134 = "COLUMBIA:COMSW3134";  // Data Structures in Java, needs W1004
  const W3157 = "COLUMBIA:COMSW3157";  // Advanced Programming, needs W3134

  check("the fixture matches the real catalog (W3134 depends on W1004)",
    JSON.stringify(courses.get(W3134)?.prereq ?? null).includes("COMSW1004"),
    JSON.stringify(courses.get(W3134)?.prereq ?? null));

  // W1004 in Spring 2027 (term 1), W3157 in Spring 2028 (term 3).
  const board: BoardView = {
    courses, termKinds, completed: new Set<string>(),
    termOf: new Map([[W1004, 1], [W3157, 3]]),
  };

  // Repairing W3157 by adding W3134: it must land before term 3, but not
  // before W1004 has happened. Term 2 is the only right answer.
  const t = earliestLegalTerm(courses.get(W3134)!, 3, board);
  check("adding a missing prerequisite lands after ITS own prerequisite", t === 2, `got term ${t}`);
  check("and not merely in the first semester it is offered", t !== 0, `got term ${t}`);

  // Same board, but W3134 wrongly sharing a semester with W1004.
  const stranded: BoardView = { ...board, termOf: new Map([[W1004, 1], [W3134, 1], [W3157, 3]]) };
  const late = latePrereq(W3134, stranded);
  check("a prerequisite in the SAME semester is reported, not counted as met",
    late?.course.id === W1004 && late?.term === 1, JSON.stringify(late?.course.code ?? null));

  const moves = legalMoves(W3134, stranded);
  check("no offered move leaves the violation standing", moves.every((k) => k > 1), `got ${moves.join(",")}`);
  check("moving it EARLIER is never offered", !moves.includes(0), `got ${moves.join(",")}`);
  check("the moves that do settle it are offered", moves.length > 0, `got ${moves.join(",")}`);

  // A prerequisite that is nowhere on the board has no legal earlier term at
  // all, and saying so is better than naming one that cannot work.
  const orphan: BoardView = { ...board, termOf: new Map([[W3157, 3]]) };
  check("with the prerequisite absent, no legal term is invented",
    earliestLegalTerm(courses.get(W3134)!, 1, orphan) === -1);
}

// ── A board a student is shown must never open already broken ───────────────
// The complaint this encodes, verbatim: "it should never start with problems,
// that shows the judges it's just not right." A fresh posting is the first
// thing anyone sees, so every one of them is solved here and put through the
// same verifier the live panel uses. Nothing may be flagged.
{
  console.log("\nA fresh posting opens with nothing flagged");
  const school = getSchool("COLUMBIA")!;
  const program = getProgram("COLUMBIA", "COLUMBIA:CS_BA")!;
  const courses = new Map(school.courses.map((c) => [c.id, c]));
  // The catalog's own skill tags that the posting actually mentions: what the
  // no-API-key path derives, and enough to steer the objective.
  const skillsOf = (jd: string) => {
    const low = jd.toLowerCase();
    const out = new Set<string>();
    for (const c of school.courses) for (const s of c.skills ?? []) {
      if (low.includes(s.skill.toLowerCase())) out.add(s.skill);
    }
    return [...out];
  };
  const postings: [string, string][] = [
    ["machine learning", DEMO_JD_ML],
    ["backend platform", DEMO_JD_BACKEND],
    ["security", DEMO_JD_SECURITY],
    ["no posting at all", ""],
  ];
  for (const [label, jd] of postings) {
    for (const horizonTerms of [8, 6, 4]) {
      const res = solveResilient({
        schoolId: "COLUMBIA", programId: "COLUMBIA:CS_BA",
        student: { program: "COLUMBIA:CS_BA", completed: [], startTerm: "FA" as Term,
                   horizonTerms, locked: [], excluded: [], completedCredits: 0 },
        targetSkills: skillsOf(jd), relevance: {},
      } as SolveRequest, 25000);
      const name = `${label}, ${horizonTerms} semesters`;
      if (!res.ok) { check(`${name}: produces a plan`, false, res.infeasibility?.message); continue; }
      const plan = res.plans[0];
      const v = verifyPlan(plan, program, courses, [], termKindsFor("FA" as Term, plan.termCredits.length));
      const failed = v.checks.filter((c) => !c.passed);
      const unmet = plan.buckets.filter((b) => !b.satisfied);
      check(`${name}: opens with nothing flagged`, failed.length === 0 && unmet.length === 0,
        [...failed.map((c) => c.problem), ...unmet.map((b) => `${b.label} short`)].join("; "));
    }
  }

  // A posting must not inherit the last plan's hand edits. This is the exact
  // shape of the state that opened a brand new board already broken.
  {
    const carried = {
      program: "COLUMBIA:CS_BA", completed: ["COLUMBIA:COMSW1004"], startTerm: "FA" as Term,
      horizonTerms: 8, completedCredits: 62,
      excluded: ["COLUMBIA:CSEEW3827"],
      locked: [{ courseId: "COLUMBIA:COMSW3134", term: 1 }],
    };
    const fresh = studentForNewPosting(carried);
    check("a new posting drops the last plan's dropped courses", fresh.excluded.length === 0,
      fresh.excluded.join(", "));
    check("a new posting drops the last plan's pinned semesters", fresh.locked.length === 0,
      JSON.stringify(fresh.locked));
    check("but keeps what is true of the student whatever they apply for",
      fresh.completed.length === 1 && fresh.horizonTerms === 8
      && fresh.startTerm === "FA" && fresh.completedCredits === 62 && fresh.program === "COLUMBIA:CS_BA");
    check("and does not mutate the plan it came from",
      carried.excluded.length === 1 && carried.locked.length === 1);
  }

  // And the reason one did not: a course dropped while looking at an EARLIER
  // posting stayed banned, so the new board could not complete its core. The
  // survey clears hand edits when it builds a plan; this is the shape of the
  // bug that made that necessary, asserted at the solver so it cannot be
  // mistaken for a solver fault again.
  const poisoned = solveResilient({
    schoolId: "COLUMBIA", programId: "COLUMBIA:CS_BA",
    student: { program: "COLUMBIA:CS_BA", completed: [], startTerm: "FA" as Term,
               horizonTerms: 8, locked: [], excluded: ["COLUMBIA:CSEEW3827"], completedCredits: 0 },
    targetSkills: [], relevance: {},
  } as SolveRequest, 25000);
  check("banning a required core course is refused outright, never half-answered",
    !poisoned.ok || poisoned.plans[0].buckets.every((b) => b.satisfied),
    poisoned.ok ? "returned ok with an unsatisfiable core" : "");
}

console.log(failures === 0
  ? "\n[32m✓ all solver checks passed[0m\n"
  : `\n[31m✗ ${failures} check(s) failed[0m\n`);
process.exit(failures === 0 ? 0 : 1);
