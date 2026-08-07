import { NextResponse } from "next/server";
import { TavilyError, tavilyKey, tavilySearch, tavilyUsage } from "@/lib/tavily";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// People who did this degree.
//
// The first version searched for the degree AND the job at once and verified
// neither, so it returned a biomedical informatics PhD student at the
// University of Utah, the founder of LinkedIn, and a block of "People Also
// Viewed" furniture presented as somebody's job title. Not one of them had been
// to Columbia. A list of strangers is worse than no list, because the entire
// point is that a student writes to them.
//
// Two things changed. The search is for graduates of the PROGRAMME, not for the
// job: there are far more alumni of a degree than alumni of a degree in one
// particular role, and any of them can say which courses were worth taking. And
// every row now has to prove the school appears on the profile before it is
// shown at all.
//
// Photographs: the search API returns none, so the card shows initials. Rather
// than hotlink somebody's picture off LinkedIn or invent one, the interface
// says what it has.
// ─────────────────────────────────────────────────────────────────────────────

function tidy(s: string): string {
  return s
    .replace(/[#*_`>]+/g, " ")
    .replace(/\s*\|\s*LinkedIn\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Columbia University" also appears as plain "Columbia". */
function schoolTokens(school: string): string[] {
  const base = school.replace(/university|college|the/gi, "").trim();
  return [school, base].filter((x) => x.length > 2);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pull the facts a student actually wants: when they graduated, what they read,
 * and where they are now. Anything not found is left blank rather than guessed.
 */
function readProfile(title: string, content: string, url: string, school: string) {
  const t = tidy(title);
  const body = tidy(content);
  const both = `${t} ${body}`;

  // The school has to be on the profile. This is the check that was missing,
  // and its absence is why a University of Utah student appeared in a list of
  // Columbia graduates.
  const onProfile = schoolTokens(school).some((tok) =>
    new RegExp(`\\b${esc(tok)}\\b`, "i").test(both),
  );

  const parts = t.split(/\s+[-–—|]\s+/).map((x) => x.trim()).filter(Boolean);
  const name = parts[0] ?? "";

  // A graduation year, not just any four digits in the page.
  //
  // Taking the first number found produced "class of 2030" for people who had
  // already graduated, because the body of a scraped profile is full of years:
  // other people's dates, post timestamps, course numbers. So only the two
  // phrasings that actually mean a class year are read, they are read from the
  // TITLE first where the headline lives, and anything implausible is dropped.
  const thisYear = new Date().getFullYear();
  const plausible = (y: number) => y >= 1960 && y <= thisYear + 6;
  const pickYear = (text: string): string => {
    const m =
      text.match(/\bclass of\s*[’']?((?:19|20)?\d{2})\b/i) ??
      text.match(/['’](\d{2})\b/);
    if (!m) return "";
    let y = m[1];
    if (y.length === 2) y = (Number(y) > 40 ? "19" : "20") + y;
    return plausible(Number(y)) ? y : "";
  };
  const classOf = pickYear(t) || pickYear(body);

  // Which degree they did there. A plan for a bachelors should not be
  // illustrated entirely by people who came to the school for a masters or a
  // doctorate: their route through the course catalog was a different one.
  const degreeMatch = both.match(/\b(BA|BS|BSc|AB|MS|MSc|MEng|MBA|PhD|Masters?|Bachelors?|Doctoral)\b/i);
  const degree = degreeMatch ? degreeMatch[1].toUpperCase() : "";
  const isGrad = /^(MS|MSC|MENG|MBA|PHD|MASTER|MASTERS|DOCTORAL)$/.test(degree);

  const studyMatch = both.match(
    /\b(computer science|electrical engineering|applied mathematics|applied math|data science|operations research|statistics|mathematics|information science|computer engineering)\b/i,
  );
  const studied = studyMatch
    ? studyMatch[1].replace(/\b\w/g, (c) => c.toUpperCase())
    : "";

  // Where they are now: the first chunk of the headline that is not the school
  // and not page furniture.
  let nowAt = "";
  const chunks = [
    ...parts.slice(1),
    ...body.split(/\s+[-–—|·]\s+|\s{2,}/).map((x) => x.trim()),
  ];
  for (const p of chunks) {
    if (schoolTokens(school).some((tok) => new RegExp(esc(tok), "i").test(p))) continue;
    // Scraped profile pages are mostly furniture: "Languages N/A", activity
    // timestamps, "500+ connections", sports scores from a post. A role reads
    // like a role, so anything that does not is left blank rather than printed
    // as if it were somebody's job.
    if (/people also viewed|connections|followers|greater .*area|united states|experience|education|class of|linkedin|languages|organizations|activity|n\/a|view my|profile/i.test(p)) continue;
    if (/^[\d•·\-.,!?"'\[]/.test(p) || /\b(19|20)\d{2}\b/.test(p)) continue;
    // Post text, not a headline: prose reads with sentence punctuation and
    // first person, and truncation markers mean a paragraph was cut.
    if (/\[\.\.\.\]|\.\.\.$|[.!?]\s|\b(I|my|we|our|instant|chills|congrat)\b/i.test(p)) continue;
    // A role names a job or a place: it has at least two words and no stray
    // punctuation runs.
    if (p.split(/\s+/).length < 2 || /[|]{1,}/.test(p)) continue;
    if (p.length > 5 && p.length < 70) { nowAt = p; break; }
  }

  const isProfile = /linkedin\.com\/in\/[^/?#]+/i.test(url);
  const looksLikePerson =
    !!name &&
    name.split(/\s+/).length <= 4 &&
    !/[.:;!?]/.test(name) &&
    !/university|department|school|college|alumni|graduates/i.test(name);

  return {
    name,
    classOf,
    studied,
    degree,
    isGrad,
    nowAt,
    url,
    // A row with a name and nothing else is not worth a student's attention.
    // It has to carry at least one fact: what they read, when they finished, or
    // what they are doing now.
    ok: isProfile && looksLikePerson && onProfile && Boolean(studied || classOf || nowAt),
    initials: name.split(/\s+/).filter(Boolean).slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "").join(""),
  };
}

export async function POST(req: Request) {
  const key = tavilyKey();
  if (!key) return NextResponse.json({ ok: false, error: "No Tavily key configured." }, { status: 400 });

  let school = "";
  let program = "";
  try {
    ({ school, program } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Send `school` and `program`." }, { status: 400 });
  }
  school = (school ?? "").trim();
  program = (program ?? "").trim();
  if (!school) return NextResponse.json({ ok: false, error: "Need a school." }, { status: 400 });

  // "Computer Science, BA" searches badly. The subject alone searches well.
  const subject = program.replace(/,?\s*\b(BA|BS|BSc|AS|MS|MEng|PhD)\b.*$/i, "").trim() || program;
  // A bachelors plan wants bachelors graduates. The search cannot filter on it,
  // so it is asked for in the query and preferred in the ordering.
  const wantUndergrad = /\b(BA|BS|BSc|AS|AB|bachelor)\b/i.test(program);

  try {
    const [a, b] = await Promise.all([
      tavilySearch({
        key,
        query: `"${school}" "Class of" ${subject}${wantUndergrad ? " BA undergraduate" : ""} linkedin profile`,
        includeDomains: ["linkedin.com"],
        maxResults: 12,
      }),
      tavilySearch({
        key,
        query: `linkedin profile ${subject} at ${school} graduated now working`,
        includeDomains: ["linkedin.com"],
        maxResults: 12,
      }),
    ]);

    const seen = new Set<string>();
    const people = [...a, ...b]
      .map((r) => readProfile(r.title ?? "", r.content ?? "", r.url ?? "", school))
      .filter((p) => {
        if (!p.ok) return false;
        const k = p.url.toLowerCase().replace(/[?#].*$/, "");
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      // Undergraduates first when the plan is an undergraduate one, then rows
      // that carry a class year, because those are the useful kind.
      .sort((x, y) => {
        if (wantUndergrad && x.isGrad !== y.isGrad) return x.isGrad ? 1 : -1;
        return (y.classOf ? 1 : 0) - (x.classOf ? 1 : 0);
      })
      .slice(0, 10);

    let usage = null;
    try { usage = await tavilyUsage(key); } catch { /* the people are the point */ }

    return NextResponse.json({
      ok: true,
      people,
      usage,
      searchedFor: `${subject} at ${school}`,
      note: "Found by public web search. The school had to appear on the profile to be listed, but nothing else is verified, so check before writing to anyone.",
    });
  } catch (e) {
    const err = e as TavilyError;
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status ?? 502 });
  }
}

export async function GET() {
  const key = tavilyKey();
  if (!key) return NextResponse.json({ ok: false, error: "No Tavily key configured." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, usage: await tavilyUsage(key) });
  } catch (e) {
    const err = e as TavilyError;
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status ?? 502 });
  }
}
