/* SWEEP_quant: try to falsify each suspected defect. */
import fs from "node:fs";
import { fillOpenCredits } from "./lib/solver";
import { termKindsFor } from "./lib/verify";
import { getSchool, getProgram } from "./data";

const DIR = "/private/tmp/claude-501/-Users-macbook2019-Documents-JD-to-course/fd4fc49f-10de-438b-94fb-b63f605983ee/scratchpad/SWEEP_quant";
const out = JSON.parse(fs.readFileSync(`${DIR}/quant_plan_out_SWEEPQUANT.json`, "utf8"));
const fit = JSON.parse(fs.readFileSync(`${DIR}/quant_fit_SWEEPQUANT.json`, "utf8"));
const res = out.res;
const plan = res.plans[0];
const school = getSchool("COLUMBIA")!;
const program = getProgram("COLUMBIA", "COLUMBIA:CS_BA")!;
const catalog = new Map(school.courses.map((c) => [c.id, c]));

// 1. Which facets does the output declare unteachable, and are any of them
//    taught by a course the same output puts in the plan?
const cannot: string[] = (res.coverage?.courseworkCannotGive ?? []).map((c: any) => c.skill);
const inPlanIds = new Set<string>(plan.placements.map((p: any) => p.courseId));
for (const ft of out.filled) for (const p of ft.picks) inPlanIds.add(p.courseId);

console.log("DECLARED UNTEACHABLE:", JSON.stringify(cannot, null, 1));
console.log("\nCOURSES IN THE PLAN (placements + open credit fill):", inPlanIds.size);

console.log("\n### CONTRADICTION TEST: unteachable facet vs a course in the plan that claims it");
for (const skill of cannot) {
  const guilty = fit.fits.filter((f: any) => f.aspects.includes(skill) && inPlanIds.has(f.courseId));
  if (!guilty.length) { console.log(`  OK   "${skill}" - nothing in the plan claims it`); continue; }
  console.log(`  FAIL "${skill}" - ${guilty.length} course(s) IN THE PLAN claim to teach it:`);
  for (const g of guilty) {
    const ft = out.filled.find((x: any) => x.picks.some((p: any) => p.courseId === g.courseId));
    console.log(`        ${g.code} ${g.title} [${g.strength}]  semester ${ft ? ft.term + 1 : "?"} (open-credit fill)`);
    console.log(`          catalog sentence: "${g.courseQuote}"`);
  }
}

// 2. Why is coverage blind to them? Bucket pool membership.
console.log("\n### WHY: is each fit-matched course inside any degree requirement pool?");
const pools = new Map<string, string[]>();
for (const b of program.buckets) pools.set(b.id, b.eligible);
for (const f of fit.fits) {
  const where = [...pools.entries()].filter(([, e]) => e.includes(f.courseId)).map(([id]) => id);
  console.log(`  ${f.code.padEnd(12)} buckets: ${where.length ? where.join(", ") : "NONE (reachable only as an open-credit elective)"}`);
}

// 3. Near-identical content, opposite verdicts.
console.log("\n### CONTENT TWIN TEST: IEOR E3658 (central) vs STAT GU4203 (filler, teaches nothing)");
for (const id of ["COLUMBIA:IEORE3658", "COLUMBIA:STATGU4203"]) {
  const c = catalog.get(id)!;
  const inPlan = inPlanIds.has(id);
  const claimed = fit.fits.find((f: any) => f.courseId === id);
  console.log(`  ${c.code} | in plan: ${inPlan} | fit verdict: ${claimed ? claimed.strength + " -> " + claimed.aspects.join(", ") : "no claim survived"}`);
  console.log(`     "${c.description.trim().slice(0, 260)}"`);
}

// 4. Data quality: descriptions that are not descriptions.
console.log("\n### DATA TEST: course descriptions that are a bare URL or a prerequisite fragment");
for (const c of school.courses) {
  const d = c.description.trim();
  if (/^https?:\/\//.test(d) || /^[,.)]/.test(d)) console.log(`  ${c.code.padEnd(12)} ${c.title.slice(0, 40).padEnd(40)} :: ${d.slice(0, 110)}`);
}

// 5. Does the plan actually cover the job's core parts?
const facets = JSON.parse(fs.readFileSync(`${DIR}/quant_skills_SWEEPQUANT.json`, "utf8")).facets;
const core = facets.filter((f: any) => f.weight === "core");
console.log(`\n### COVERAGE: plan.skillsCovered = ${JSON.stringify(plan.skillsCovered)}`);
console.log(`  core facets: ${core.length}, covered by solver placements: ${core.filter((f: any) => plan.skillsCovered.includes(f.name)).length}`);
const fillCovers = new Set<string>();
for (const ft of out.filled) for (const p of ft.picks) for (const t of p.teaches) fillCovers.add(t);
console.log(`  additionally claimed by the open-credit fill: ${JSON.stringify([...fillCovers])}`);
void fillOpenCredits; void termKindsFor;
