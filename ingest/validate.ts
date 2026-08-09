/**
 * BUILD_SPEC §6.0 — the provenance validator.
 *
 * "Build a validator that fails the ingest if any bucket, credit cap, or
 *  prerequisite lacks a resolvable source. Run it in CI. A rule with no
 *  citation is a bug, not a shortcut."
 *
 * It also regenerates /data/SOURCES.md from the data, so that file can never
 * drift from what the solver actually enforces.
 *
 * Run: npx tsx ingest/validate.ts          (add --check to fail on a stale file)
 */
import { writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { SCHOOLS } from "@/data";
import type { PrereqNode } from "@/lib/types";

const problems: string[] = [];
const warnings: string[] = [];
const snapshotCache = new Map<string, string>();

const fail = (m: string) => problems.push(m);
const warn = (m: string) => warnings.push(m);

// ─────────────────────────────────────────────────────────────────────────────
// Every sentence the page attributes to the catalog must be ON the catalog page.
//
// The plan page prints, under each course's evidence, "Every sentence above is
// copied from that page. If one is not there, this claim is wrong and should be
// reported." That promise was false for 38 courses. The hand written entries in
// data/columbia.ts were paraphrases written from memory, not quotations, and
// they override the ingested rows that really are verbatim. COMS W4152 was
// shown quoting "monitoring, and A/B testing" as the catalog's words; Columbia's
// page for that course does not contain either phrase.
//
// Checked against the committed HTML, not against anything derived from it,
// because the derived data is what was wrong.
// ─────────────────────────────────────────────────────────────────────────────
{
  const dir = join(process.cwd(), "data/snapshots/courses");
  const flat = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  for (const school of SCHOOLS) {
    for (const c of school.courses) {
      const f = join(dir, `${c.code.replace(/\s+/g, "")}.html`);
      if (!existsSync(f)) continue;
      const page = flat(
        readFileSync(f, "utf8").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " "),
      );
      // A prefix rather than the whole string: the bulletin wraps lines and the
      // parser normalises punctuation, so an exact match would fail on
      // formatting rather than on substance.
      const head = (s: string, n: number) => flat(s).slice(0, n);
      if (c.description && head(c.description, 60) && !page.includes(head(c.description, 60))) {
        fail(
          `${school.shortName} ${c.code}: the description shown to students is not on its own ` +
          `catalog page. Ours starts "${c.description.slice(0, 60)}"`,
        );
      }
      for (const s of c.skills ?? []) {
        if (s.evidence && !page.includes(head(s.evidence, 45))) {
          fail(
            `${school.shortName} ${c.code}: quotes "${s.evidence.slice(0, 60)}" as proof it ` +
            `teaches ${s.skill}, and that sentence is not on the page`,
          );
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Every "cannot both count" rule the snapshots state must be encoded.
//
// This is checked against the committed HTML rather than against the catalog,
// because a check that reads the rules from the same place the planner does
// proves nothing: when Honors Linear Algebra lost its rule, a check of that
// shape passed, since there was no rule left to violate. The bulletin page is
// the independent witness, so the bulletin page is what is read.
//
// The failure this catches is a real one. Columbia's page for MATH UN2020 says
// "Not to be taken in addition to MATH UN2010" directly under the title, the
// parser could not see it because it only recognised the old one-letter course
// numbers, and a plan shipped holding both.
// ─────────────────────────────────────────────────────────────────────────────
{
  const dir = join(process.cwd(), "data/snapshots/courses");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".html")) : [];
  const byId = new Map(SCHOOLS.flatMap((s) => s.courses).map((c) => [c.id, c]));
  const cid = (code: string) => `COLUMBIA:${code.replace(/\s+/g, "")}`;
  const STATES =
    /(?:may (?:only |not )?(?:receive|be given) credit for(?: only)?(?: one of| either| both)?|credit for only one|not to be taken in addition to)([^.]{0,180})/i;

  let stated = 0;
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8")
      .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ");
    const self = text.match(/\b([A-Z]{4})\s+([A-Z]{1,2}\d{4})\b/);
    if (!self) continue;
    const selfId = cid(`${self[1]} ${self[2]}`);
    const course = byId.get(selfId);
    // Only courses this catalog actually holds can be expected to carry a rule.
    if (!course) continue;

    const m = text.match(STATES);
    if (!m) continue;
    const tail = m[1].split(/\b(?:Fall|Spring|Summer)\s+\d{4}/)[0];
    for (const hit of tail.match(/\b([A-Z]{4}\s+[A-Z]{1,2}\d{4}|[A-Z]{1,2}\d{4})\b/g) ?? []) {
      const other = cid(hit.includes(" ") ? hit : `${self[1]} ${hit}`);
      if (other === selfId || !byId.has(other)) continue;
      stated++;
      const encoded = (course.overlapsWith ?? []).includes(other) ||
        (byId.get(other)!.overlapsWith ?? []).includes(selfId);
      if (!encoded) {
        fail(
          `${course.code} (${f}) says it cannot be counted with ${byId.get(other)!.code}, ` +
          `but neither course carries that in overlapsWith — a plan can hold both`,
        );
      }
    }
  }
  if (files.length && !stated) {
    warn("no snapshot states a 'cannot both count' rule, which is unlikely across a whole bulletin");
  }
}

for (const school of SCHOOLS) {
  const catalogIds = new Set(school.courses.map((c) => c.id));

  // ── every course fact is clickable back to the catalog ────────────────────
  for (const c of school.courses) {
    if (!c.sourceUrl?.startsWith("http")) fail(`${school.shortName} ${c.code}: no source URL`);
    if (!c.description?.trim()) fail(`${school.shortName} ${c.code}: no description`);
    if (c.credits <= 0) fail(`${school.shortName} ${c.code}: credits must be positive`);
    if (!c.termsOffered.length) fail(`${school.shortName} ${c.code}: offered in no term — it can never be placed`);
    if (!c.verified) warn(`${school.shortName} ${c.code}: prerequisite parse not human-reviewed`);

    // A skill with no verbatim evidence sentence is an inference, and §5
    // forbids inference. No sentence, no skill.
    for (const s of c.skills) {
      if (!s.evidence?.trim()) {
        fail(`${school.shortName} ${c.code}: skill "${s.skill}" has no evidence sentence`);
      } else if (!c.description.includes(s.evidence)) {
        fail(`${school.shortName} ${c.code}: evidence for "${s.skill}" is not a verbatim sentence from the description`);
      }
    }

    // A prerequisite must point at a course this catalog actually contains,
    // or the solver will silently treat the branch as unreachable.
    walk(c.prereq, (n) => {
      if (n.op === "COURSE" && !catalogIds.has(n.courseId)) {
        fail(`${school.shortName} ${c.code}: prerequisite points at ${n.courseId}, which is not in the catalog`);
      }
      if (n.op === "UNVERIFIABLE" && !n.text.trim()) {
        fail(`${school.shortName} ${c.code}: UNVERIFIABLE node with no wording — the student would see an empty warning`);
      }
    });
  }

  // ── every rule the solver enforces carries a citation ─────────────────────
  for (const program of school.programs) {
    if (!program.sources.length) fail(`${school.shortName}/${program.name}: no degree-wide sources`);
    if (!program.sources.some((s) => /credit|point/i.test(s.quote))) {
      fail(`${school.shortName}/${program.name}: the credit cap is enforced but not cited`);
    }
    if (program.maxCreditsPerTerm <= program.minCreditsPerTerm) {
      fail(`${school.shortName}/${program.name}: credit cap is not above the floor`);
    }

    for (const b of program.buckets) {
      const s = b.source;
      if (!s) { fail(`${school.shortName} bucket ${b.id}: no source at all`); continue; }
      if (!s.url?.startsWith("http")) fail(`${school.shortName} bucket ${b.id}: source URL is not resolvable`);
      if (!s.quote?.trim()) fail(`${school.shortName} bucket ${b.id}: no verbatim quote`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.retrievedAt ?? "")) {
        fail(`${school.shortName} bucket ${b.id}: retrievedAt is not an ISO date`);
      }
      if (!s.snapshotPath) fail(`${school.shortName} bucket ${b.id}: no committed snapshot path`);
      else checkSnapshot(`${school.shortName} bucket ${b.id}`, s.snapshotPath, s.quote);

      const need = b.needCredits ?? b.needCourses ?? 0;
      if (need <= 0) fail(`${school.shortName} bucket ${b.id}: requires nothing`);
      if (!b.eligible.length) fail(`${school.shortName} bucket ${b.id}: no eligible courses`);

      const dangling = b.eligible.filter((id) => !catalogIds.has(id));
      if (dangling.length) {
        fail(`${school.shortName} bucket ${b.id}: eligible list references missing courses — ${dangling.join(", ")}`);
      }

      // A bucket that asks for more courses than exist can never be satisfied.
      if (b.needCourses != null && b.needCourses > b.eligible.length) {
        fail(`${school.shortName} bucket ${b.id}: needs ${b.needCourses} courses but only ${b.eligible.length} are eligible`);
      }

      // allowDoubleCount must name a bucket that exists, or the permission is
      // silently inert — the worst kind of wrong, because it looks fine.
      for (const other of b.allowDoubleCount) {
        if (!program.buckets.some((x) => x.id === other)) {
          fail(`${school.shortName} bucket ${b.id}: allowDoubleCount names ${other}, which is not a bucket in this program`);
        } else if (!program.buckets.find((x) => x.id === other)!.allowDoubleCount.includes(b.id)) {
          warn(`${school.shortName} bucket ${b.id}: double-count with ${other} is one-way, so the solver ignores it`);
        }
      }
    }
  }
}

/**
 * The point of committing a snapshot (§6.0) is that catalogs get edited. If a
 * page changes between build and judging, the citation still resolves — but
 * only if the quote was actually on the page we saved. This checks that it was.
 */
function snapshotText(path: string): string | null {
  if (snapshotCache.has(path)) return snapshotCache.get(path)!;
  const abs = join(process.cwd(), path.replace(/^\//, ""));
  if (!existsSync(abs)) return null;
  const text = readFileSync(abs, "utf8")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .toLowerCase();
  snapshotCache.set(path, text);
  return text;
}

function checkSnapshot(who: string, path: string, quote: string): void {
  const text = snapshotText(path);
  if (text === null) {
    fail(`${who}: snapshot ${path} is not committed — the citation cannot survive a catalog edit`);
    return;
  }
  // Some quotes are assembled from a table (a list of required courses spread
  // over rows). Check the parts, and require every one of them to be present.
  const parts = quote.split(/;\s*/).map((p) => p.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);
  const missing = parts.filter((p) => !text.includes(p));
  if (missing.length) {
    fail(`${who}: quote not found in snapshot ${path} — ${missing.map((m) => `"${m.slice(0, 60)}…"`).join(", ")}`);
  }
}

function walk(n: PrereqNode | null, fn: (n: PrereqNode) => void, depth = 0): void {
  if (!n || depth > 20) return;
  fn(n);
  if (n.op === "AND" || n.op === "OR") n.children.forEach((c) => walk(c, fn, depth + 1));
}

// ─────────────────────────── generate SOURCES.md ────────────────────────────

const lines: string[] = [
  "# Sources",
  "",
  "> Generated by `npx tsx ingest/validate.ts`. Do not edit by hand — this file is",
  "> derived from the same data the solver runs on, so it cannot drift from the",
  "> rules actually enforced.",
  "",
  "Every requirement below was encoded **by hand** from the page cited, not extracted",
  "by a language model. BUILD_SPEC §6 step 4: degree requirements are few, high-stakes",
  "and structured, and they deserve manual care.",
  "",
];

for (const school of SCHOOLS) {
  lines.push(`## ${school.name}`, "", `${school.structureNote}`, "");
  for (const program of school.programs) {
    lines.push(`### ${program.name}`, "");
    lines.push("| Rule | As the catalog states it | Source | Retrieved |");
    lines.push("|---|---|---|---|");
    for (const b of program.buckets) {
      lines.push(`| ${b.label} | ${esc(b.source.quote)} | [link](${b.source.url}) | ${b.source.retrievedAt} |`);
    }
    for (const s of program.sources) {
      lines.push(`| Degree-wide policy | ${esc(s.quote)} | [link](${s.url}) | ${s.retrievedAt} |`);
    }
    lines.push("");
  }

  const unverified = school.courses.filter((c) => !c.verified);
  lines.push(
    `**Courses in this catalog:** ${school.courses.length} · ` +
    `**prerequisite parses reviewed by a human:** ${school.courses.length - unverified.length} of ${school.courses.length}`,
    "",
  );
  if (unverified.length) {
    lines.push(
      "Not yet reviewed (the board marks anything depending on these as *check with your advisor*):",
      "",
      unverified.map((c) => `\`${c.code}\``).join(", "),
      "",
    );
  }
}

const md = lines.join("\n");
const out = join(process.cwd(), "data", "SOURCES.md");

if (process.argv.includes("--check")) {
  const existing = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (existing.trim() !== md.trim()) {
    fail("data/SOURCES.md is out of date — run `npx tsx ingest/validate.ts` and commit the result");
  }
} else {
  writeFileSync(out, md + "\n");
}

// ─────────────────────────── report ─────────────────────────────────────────

console.log("\n\x1b[1mINGEST VALIDATOR\x1b[0m\n");
const courseCount = SCHOOLS.reduce((n, s) => n + s.courses.length, 0);
const bucketCount = SCHOOLS.reduce((n, s) => n + s.programs.reduce((m, p) => m + p.buckets.length, 0), 0);
console.log(`  ${SCHOOLS.length} schools · ${courseCount} courses · ${bucketCount} cited requirement rules`);

if (warnings.length) {
  console.log(`\n  \x1b[33m${warnings.length} warning(s)\x1b[0m — surfaced in the UI, not blocking:`);
  for (const w of warnings.slice(0, 8)) console.log(`    · ${w}`);
  if (warnings.length > 8) console.log(`    · …and ${warnings.length - 8} more`);
}

if (problems.length) {
  console.log(`\n  \x1b[31m${problems.length} problem(s):\x1b[0m`);
  for (const p of problems) console.log(`    ✗ ${p}`);
  console.log("\n\x1b[31m✗ ingest failed — a rule without a citation is a bug, not a shortcut\x1b[0m\n");
  process.exit(1);
}

console.log("\n\x1b[32m✓ every rule the solver enforces carries a resolvable citation\x1b[0m");
console.log(`\x1b[32m✓ data/SOURCES.md ${process.argv.includes("--check") ? "is current" : "regenerated"}\x1b[0m\n`);

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
