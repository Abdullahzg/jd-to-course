// The matcher's regression gate. Expectations are not my taste: every rule
// below is a documented complaint from real output. Run against a dev server:
//   node scripts/fit-fixtures.mjs <dir-with-jd-files>
const DIR = process.argv[2];
if (!DIR) { console.error("pass the directory holding the jd .txt files"); process.exit(1); }
import { readFileSync } from "node:fs";

const FIXTURES = [
  {
    name: "product manager (TikTok)", file: "jd_tiktok_ai.txt",
    // POLS/IEOR: another field's ML. GU4244: the engineer's course, not the
    // PM's. W4111 claiming content analysis: storage is not analysis.
    mustNotMatch: ["POLS GU4728", "IEOR E4212", "STAT GU4244"],
    neverCentral: ["COMS W4731", "COMS W4726", "COMS W4111", "COMS W4113"],
    mustMatch: ["STAT UN1201|ECON UN3412|STAT GU4001"],
    forbiddenClaims: [["COMS W4111", /content|classif/i]],
  },
  {
    name: "backend engineer", file: "jd_backend.txt",
    mustMatch: ["COMS W4113", "COMS W4111", "COMS W4118|COMS W4152|COMS W4156"],
    mustNotMatch: ["POLS GU4728", "IEOR E4212"],
    neverCentral: [],
    forbiddenClaims: [],
  },
  {
    name: "ward nurse (control)", file: "nurse_jd.txt",
    maxMatches: 1, mustMatch: [], mustNotMatch: [], neverCentral: [], forbiddenClaims: [],
  },
  {
    name: "security engineer", file: "sec_jd.txt",
    mustMatch: ["COMS W4181|COMS W4182|COMS W4187"],
    mustNotMatch: ["POLS GU4728"], neverCentral: [], forbiddenClaims: [],
  },
  {
    name: "game developer", file: "game_jd.txt",
    mustMatch: ["COMS W4160|COMS W4167|COMS E4995"],
    mustNotMatch: ["IEOR E4212"], neverCentral: [], forbiddenClaims: [],
  },
  {
    name: "content governance (nontechnical)", file: "jd_gov.txt",
    // The posting that started everything: Computer Vision was sold as
    // preparation for a governance analyst.
    neverCentral: ["COMS W4731", "COMS W4732", "COMS W4726", "POLS GU4728"],
    mustNotMatch: [], mustMatch: [], forbiddenClaims: [],
  },
  {
    name: "frontend engineer", file: "jd_fe.txt",
    mustMatch: ["COMS W4170|COMS W4160|COMS W3107"],
    mustNotMatch: ["CBMF W4761"], neverCentral: [], forbiddenClaims: [],
  },
  {
    name: "site reliability engineer", file: "sre_jd.txt",
    mustMatch: ["COMS W4113|COMS W4118|COMS W4119"],
    mustNotMatch: ["POLS GU4728"], neverCentral: [], forbiddenClaims: [],
  },
  {
    name: "compliance analyst", file: "jd_compliance.txt",
    // Coordination heavy and nontechnical: deep learning may never glow here.
    neverCentral: ["COMS W4726", "COMS W4771", "COMS W4732"],
    mustMatch: [], mustNotMatch: [], forbiddenClaims: [],
  },
  {
    name: "bakery manager (control)", file: "jd_control.txt",
    maxMatches: 1, mustMatch: [], mustNotMatch: [], neverCentral: [], forbiddenClaims: [],
  },
];

// ── stability: the same request twice must land on mostly the same courses ──
// The union-of-two-draws shortlist exists exactly for this; the check keeps it
// honest. Jaccard under 0.5 means a student refreshing the page gets a
// different answer to the same question, which is the machine changing its
// mind, not the student changing theirs.
async function stability(dir) {
  const jd = readFileSync(`${dir}/sec_jd.txt`, "utf8");
  const skText = await (await fetch("http://localhost:3000/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jd }) })).text();
  let sk = {}; for (const l of skText.trim().split("\n")) { try { sk = { ...sk, ...JSON.parse(l) }; } catch { /* partial */ } }
  const once = async () => {
    const r = await (await fetch("http://localhost:3000/api/fit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jd, schoolId: "COLUMBIA", courseIds: ids, facets: sk.facets ?? [], stream: false }) })).json();
    return new Set((r.fits ?? []).map((f) => f.code));
  };
  const [a, b] = [await once(), await once()];
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  const j = union ? inter / union : 1;
  console.log(`stability (security, run twice): ${a.size} vs ${b.size} matches, agreement ${(j * 100).toFixed(0)}%`);
  return j;
}

const ids = JSON.parse(readFileSync(new URL("../node_modules/.fixture-ids.json", import.meta.url), "utf8"));
let pass = 0, fail = 0; const failures = [];
for (const fx of FIXTURES) {
  let jd; try { jd = readFileSync(`${DIR}/${fx.file}`, "utf8"); } catch { console.log(`SKIP ${fx.name}: no ${fx.file}`); continue; }
  const skText = await (await fetch("http://localhost:3000/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jd }) })).text();
  let sk = {}; for (const l of skText.trim().split("\n")) { try { sk = { ...sk, ...JSON.parse(l) }; } catch { /* partial */ } }
  const t0 = Date.now();
  const fit = await (await fetch("http://localhost:3000/api/fit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jd, schoolId: "COLUMBIA", courseIds: ids, facets: sk.facets ?? [], stream: false }) })).json();
  const fits = fit.fits ?? [];
  const has = (spec) => spec.split("|").some((c) => fits.some((f) => f.code === c));
  const central = (code) => fits.some((f) => f.code === code && f.strength === "central");
  const claims = (code) => fits.filter((f) => f.code === code).flatMap((f) => f.aspects);
  const check = (ok, label) => { if (ok) pass++; else { fail++; failures.push(`${fx.name}: ${label}`); } };

  for (const m of fx.mustMatch) check(has(m), `must match ${m}, absent`);
  for (const m of fx.mustNotMatch) check(!has(m), `must NOT match ${m}, present`);
  for (const m of fx.neverCentral) check(!central(m), `${m} may never be central here`);
  for (const [code, re] of fx.forbiddenClaims) check(!claims(code).some((a) => re.test(a)), `${code} claims a forbidden part`);
  if (fx.maxMatches != null) check(fits.length <= fx.maxMatches, `${fits.length} matches, cap ${fx.maxMatches}`);
  const actors = (sk.facets ?? []).map((f) => `${f.actor ?? "?"}:${f.name.slice(0, 28)}`).join(" | ");
  console.log(`${fx.name}: ${fits.length} matches, $${(fit.costUsd ?? 0).toFixed(3)}, ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`   actors: ${actors}`);
  console.log(`   ${fits.map((f) => `${f.code}[${f.strength[0]}]`).join(" ")}`);
}
const j = await stability(DIR);
if (j >= 0.5) pass++; else { fail++; failures.push(`stability: agreement ${(j * 100).toFixed(0)}% is below 50%`); }

console.log(`\n${pass} passed, ${fail} failed`);
failures.forEach((f) => console.log("  FAIL " + f));
process.exit(fail ? 1 : 0);
