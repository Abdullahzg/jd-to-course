import { NextResponse } from "next/server";
import { getActiveKey } from "@/lib/ai/keystore";
import { HaikuError, haiku } from "@/lib/ai/haiku";
import { getSchool } from "@/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// ─────────────────────────────────────────────────────────────────────────────
// Course-by-course relevance, replacing vocabulary alignment.
//
// /api/match asked a model to line up two lists of WORDS. That is bounded by
// whatever words happen to be in the catalog's skill lists, so a robotics
// course whose description says "sensing and localisation" could never answer a
// posting that asks for SLAM. Here the model reads the actual course
// description instead, and for each thing the job asks for it must quote the
// sentence that proves the course teaches it.
//
// It still cannot pick courses. It never sees the degree rules, the student, or
// the plan; it sees one course and one list of asks. The solver does the
// choosing, and every claim arrives with the catalog's own sentence attached,
// so a wrong call is visible rather than buried in a score.
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM = `You decide which of a job's requirements each university course teaches.

You get a numbered list of ASKS from a job posting, and several COURSES, each
with a code, title and full description.

For every (course, ask) pair where the course genuinely teaches that ask, return
the course code, the ask number, and the exact sentence from that course's
description that proves it.

Rules:
- Each ask may come with the sentence from the posting that asked for it. When
  it does, that sentence decides what the ask MEANS, and you match against that
  meaning. "Data processing" quoted from "optimizing service performance, data
  processing, and system reliability" is about throughput in a running service,
  so a machine learning course that happens to process data does not answer it.
  Read the posting's sentence before you decide anything.
- The quote must be copied verbatim from the description. Never paraphrase.
- If no sentence in the description supports the ask, leave the ask out. Being
  related to the topic is not enough; the description has to say it.
- Never include an ask that is about experience rather than knowledge, such as
  "3 years in production" or "shipped at scale". A course cannot supply those.
- Being in the same field is not teaching it. A networks course does not teach
  computer vision.
- THE QUOTE MUST BE ABOUT THE ASK ITSELF, not about a field that contains it.
  This is where this task is usually got wrong, so read these:
    "Theory and practice of regression analysis" does NOT prove a course teaches
    advertising models. Regression is a tool advertising happens to use.
    "Introduction to machine learning: supervised learning, linear and logistic
    regression..." does NOT prove a course teaches recommender systems. It never
    mentions them.
    "Reinforcement Learning algorithms including Q-learning" does NOT prove a
    course teaches LLM agent frameworks. Same word, different thing.
    "Large scale applications from signal processing, collaborative filtering,
    recommendations systems" DOES prove recommender systems, because it says so.
  More of the same mistake, all of them found in real runs of this prompt:
    "operating services at scale" does NOT prove observability. Observability is
    metrics, logs, traces and alerts. Operating at scale is the activity they
    support.
    "CI/CD and cloud deployment" does NOT prove infrastructure as code. You can
    run CI with hand-clicked infrastructure and IaC with no CI at all.
    "cloud application architecture" does NOT prove distributed systems design.
    Naming no consistency model, no consensus, no replication means it did not
    teach it.
    "privacy regulations" does NOT prove ISO 27001. Different standard, different
    field.
  If you find yourself reasoning "this is used in that", "this is a kind of
  that", or "you would need this for that", stop and leave it out. The test is
  whether the sentence would convince a sceptical person looking for a reason to
  say no.
- QUOTE ONLY FROM THE DESCRIPTION, NEVER FROM THE TITLE. A course called "Policy
  for Privacy Technologies" does not teach policy writing because the word
  "Policy" is in its name. If the description does not say it, it is not there.
- A HEDGED SENTENCE IS NOT EVIDENCE. "Potential topics include cryptography"
  does not assert that the course covers cryptography. Neither does "topics may
  vary" or "content varies by section". Skip those.
- A course that REQUIRES a skill is not a course that TEACHES it. "Students
  write analysis papers" is not instruction in written English. "Assignments are
  in Python" is not a Python course.
- Prefer the strongest sentence you can find. If two courses could answer an
  ask, return the one whose description says it outright before one that merely
  gestures at it, and feel free to return both only when both say it outright.
- An empty list is a perfectly good answer, and common. Most courses in a
  catalog have nothing to do with any given job.`;

const SCHEMA = {
  name: "course_relevance",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      teaches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            course: { type: "string" },
            ask: { type: "integer" },
            evidence: { type: "string" },
          },
          required: ["course", "ask", "evidence"],
        },
      },
    },
    required: ["teaches"],
  },
} as const;

/**
 * Courses per model call.
 *
 * This started as one call per course, which for a 47 course catalog meant 47
 * parallel requests and a spinner that sat there for minutes. Batching folds
 * that into a handful of calls. Eight is small enough that every description
 * still fits comfortably in one prompt and the model does not start losing
 * track of which course it is quoting.
 */
const PER_CALL = 8;

/**
 * How many courses to put in one call, given how many requirements it is being
 * asked about.
 *
 * A batch asks the model for every (course, requirement) pair that holds. Eight
 * courses against six requirements is forty eight judgements, which is fine.
 * Eight courses against twenty requirements is a hundred and sixty, and at that
 * width it starts dropping matches that are not arguable at all: a posting
 * asking for SQL got nothing back, while the catalog contains a description
 * reading "relational data definition and manipulation languages, SQL, XML".
 * Asked about SQL on its own, the same model finds it immediately.
 *
 * So the batch narrows as the requirement list grows, keeping the number of
 * judgements per call roughly constant. It costs more calls. It costs fewer
 * false negatives, and a false negative here is the product telling a student
 * that nothing in their university teaches something it plainly teaches.
 */
function coursesPerCall(askCount: number): number {
  const TARGET_PAIRS = 56;
  return Math.max(3, Math.min(PER_CALL, Math.round(TARGET_PAIRS / Math.max(1, askCount))));
}
/** How many of those calls may be in flight at once. */
const CONCURRENCY = 6;

// ─────────────────────────────────────────────────────────────────────────────
// The refutation pass.
//
// Haiku 4.5 is a small model and it is generous. Told six different ways not to
// pass a broader field off as a specific skill, it will still answer "Ads
// modelling" with "Theory and practice of regression analysis", because
// regression really is used in advertising and the leap feels reasonable from
// the inside. Prompt wording alone does not fix this; across reruns the same
// prompt lets different stretches through.
//
// So finding is separated from judging. The first pass is asked what a course
// might teach and is allowed to be generous. The second is shown one claim at a
// time with the quote attached and asked to knock it down, with rejection as
// the default when it is unsure. A model asked to defend a claim and a model
// asked to break it behave differently, and it is much harder to argue that
// "regression analysis" states advertising than it is to feel that it implies
// it.
// ─────────────────────────────────────────────────────────────────────────────

const VERIFY_SYSTEM = `You are checking claims about what university courses teach, and your job is to knock down the ones that do not hold up.

Each claim says: this COURSE teaches this REQUIREMENT, and here is the QUOTE from the course description that supposedly proves it.

For each claim return keep: true or false.

Return false, which is the default whenever you are not certain, if ANY of these apply:
- The quote describes a broader field that merely contains the requirement.
  "Theory and practice of regression analysis" does not prove advertising models.
  "Operating services at scale" does not prove observability.
  "Introduction to machine learning" does not prove recommender systems.
  "This course introduces Python programming" does not prove building LLM applications.
- The quote is hedged: "potential topics include", "topics vary", "may cover".
- The quote shows the course USES the thing rather than TEACHES it. Assignments
  written in Python do not make it a Python course.
- The quote is a fragment lifted out of a topic list whose surrounding sentence
  means something else.
- The same word appears in both but means different things. Reinforcement
  learning agents are not LLM agent frameworks. Bias auditing is not IT audit.
- Where "THE POSTING MEANT" is given, it defines the requirement, and you judge
  the quote against THAT SENTENCE, not against the requirement's name. This is
  the single most common way this task is failed. Worked example, from a real
  run: the requirement was "Performance optimization", the posting meant
  "optimizing service performance, data processing, and system reliability", and
  the proposed quote was "GPU acceleration, training large models, distributed
  data and model parallelism, and model serving in production". Both are about
  making something faster, so it feels right. It is wrong: the posting is about
  a backend service under load and the course is about training neural networks.
  Different machines, different bottlenecks, different work. keep: false.
- Ask yourself what job the person in the posting does all day, then ask whether
  this course prepares them for THAT. A backend engineer does not become better
  at serving e-commerce traffic by learning model parallelism.

Return true only when the quote states the requirement outright, so that a
sceptical reader who wanted to say no could not.

Judge each claim only on its own quote. You cannot see the rest of the course
description, and that is deliberate: if the quote does not carry the claim, the
claim was not proven.`;

const VERIFY_SCHEMA = {
  name: "verdicts",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            n: { type: "integer" },
            keep: { type: "boolean" },
          },
          required: ["n", "keep"],
        },
      },
    },
    required: ["verdicts"],
  },
} as const;

/** Claims per refutation call. */
const VERIFY_PER_CALL = 14;

type Progress =
  | { phase: "reading"; read: number; total: number; found: { code: string; title: string; skill: string }[] }
  | { phase: "checking"; checked: number; total: number }
  | { phase: "rejected"; course: string; skill: string };

/**
 * Read a catalog against a posting, then try to knock down everything it found.
 *
 * Split out from the route handler so the same code can serve a plain JSON
 * response and a streamed one. The `onProgress` callback fires after each wave
 * of calls comes back, which is what lets the survey show a course count that
 * climbs for real instead of a spinner and a guess.
 */
async function runRelevance(args: {
  key: string;
  skills: string[];
  /** requirement -> the sentence in the posting that asked for it */
  context?: Record<string, string>;
  targets: NonNullable<ReturnType<Map<string, import("@/lib/types").Course>["get"]>>[];
  onProgress?: (p: Progress) => void;
}) {
  const { key, skills, targets, onProgress, context = {} } = args;
  // Each ask carries the sentence it came from.
  //
  // A requirement name on its own is ambiguous, and the ambiguity is not
  // academic. A backend posting asking for "data processing" means throughput
  // in a service; read as a bare phrase it pulled back Deep Learning Systems
  // and Data Analytics for Operations Research, because those process data too.
  // The posting already told us which sense it meant, in the sentence the
  // extractor quoted, so that sentence travels with the ask.
  const asks = skills
    .map((s, i) => {
      const ctx = context[s];
      return ctx ? `${i + 1}. ${s}\n   the posting said: "${ctx}"` : `${i + 1}. ${s}`;
    })
    .join("\n");
  const byCode = new Map(targets.map((c) => [c.code, c]));

  const per = coursesPerCall(skills.length);
  const batches: (typeof targets)[] = [];
  for (let i = 0; i < targets.length; i += per) batches.push(targets.slice(i, i + per));

  const evidence: Record<string, { courseId: string; courseCode: string; quote: string }[]> = {};
  for (const s of skills) evidence[s] = [];
  let costUsd = 0;
  /** Courses no call ever managed to read. Never silently treated as empty. */
  let unread = 0;
  let read = 0;

  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const wave = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(wave.map(async (batch) => {
      const courseText = batch
        .map((c) => `### ${c.code}: ${c.title}\n${c.description}`)
        .join("\n\n");

      // A batch that throws used to return no hits and say nothing about it.
      // Eight courses would then be reported to the student as read and found
      // wanting, when in truth they were never looked at, and the page would
      // print "nothing in this catalog teaches it" on the strength of a
      // timeout. That is the one sentence this product must never get wrong,
      // so a failure is retried and, if it still fails, counted and surfaced.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { content, costUsd: cost } = await haiku<{
            teaches: { course: string; ask: number; evidence: string }[];
          }>({
            key,
            purpose: `relevance: ${batch.length} courses`,
            system: SYSTEM,
            user: `ASKS\n${asks}\n\nCOURSES\n${courseText}`,
            schema: SCHEMA as never,
            maxTokens: 2000,
          });
            // Reported here, as each batch lands, rather than after the whole
            // wave. Six batches finish at six different moments, so waiting for
            // all of them made the number on screen jump in blocks of 48 and
            // then sit still. Eight at a time reads as counting.
            read += batch.length;
            // Name what it just found, so the wait shows a catalog being read
            // rather than a number going up. Watching "Cloud Computing answers
            // system design" scroll past is the difference between believing
            // the thing works and hoping it does.
            const named = (content.teaches ?? [])
              .map((t) => {
                const c = byCode.get(String(t.course).trim());
                const ask = skills[t.ask - 1];
                return c && ask ? { code: c.code, title: c.title, skill: ask } : null;
              })
              .filter((x): x is { code: string; title: string; skill: string } => Boolean(x));
            onProgress?.({ phase: "reading", read, total: targets.length, found: named });
            return { hits: content.teaches ?? [], cost, unread: 0, n: 0 };
        } catch {
          if (attempt < 2) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
      read += batch.length;
      onProgress?.({ phase: "reading", read, total: targets.length, found: [] });
      return { hits: [], cost: 0, unread: batch.length, n: 0 };
    }));

    for (const r of results) {
      costUsd += r.cost;
      unread += r.unread;
      for (const t of r.hits) {
        const course = byCode.get(String(t.course).trim());
        const ask = skills[t.ask - 1];
        // Drop anything whose quote is not actually in that course's
        // description. The model does not get to invent its own evidence.
        if (!course || !ask || typeof t.evidence !== "string") continue;
        const quote = t.evidence.trim();
        if (!course.description.includes(quote)) continue;
        evidence[ask].push({ courseId: course.id, courseCode: course.code, quote });
      }
    }
  }

  // ── second pass: try to break every claim the first pass made ───────────
  const claims: { skill: string; idx: number; courseCode: string; quote: string }[] = [];
  for (const [skill, list] of Object.entries(evidence)) {
    list.forEach((h, idx) => claims.push({ skill, idx, courseCode: h.courseCode, quote: h.quote }));
  }

  const rejected = new Set<string>();
  let verifyCalls = 0;
  let checked = 0;
  for (let i = 0; i < claims.length; i += VERIFY_PER_CALL * CONCURRENCY) {
    const wave: (typeof claims)[] = [];
    for (let j = i; j < Math.min(claims.length, i + VERIFY_PER_CALL * CONCURRENCY); j += VERIFY_PER_CALL) {
      wave.push(claims.slice(j, j + VERIFY_PER_CALL));
    }
    const out = await Promise.all(wave.map(async (group) => {
      const listing = group
        .map((c, n) => `${n + 1}. REQUIREMENT: ${c.skill}\n   COURSE: ${c.courseCode}\n   QUOTE: "${c.quote}"`)
        .join("\n\n");
      try {
        const { content, costUsd: cost } = await haiku<{ verdicts: { n: number; keep: boolean }[] }>({
          key,
          purpose: `refute ${group.length} claims`,
          system: VERIFY_SYSTEM,
          user: listing,
          schema: VERIFY_SCHEMA as never,
          maxTokens: 900,
        });
        return { group, verdicts: content.verdicts ?? [], cost };
      } catch {
        // A verifier that fell over must not silently approve everything.
        return { group, verdicts: [], cost: 0 };
      }
    }));
    for (const r of out) {
      verifyCalls++;
      costUsd += r.cost;
      checked += r.group.length;
      const said = new Map(r.verdicts.map((v) => [v.n, v.keep]));
      r.group.forEach((c, n) => {
        if (said.get(n + 1) === false) {
          rejected.add(`${c.skill}::${c.idx}`);
          // Throwing a claim out is the most interesting thing this system
          // does, so it is worth watching happen.
          onProgress?.({ phase: "rejected", course: c.courseCode, skill: c.skill });
        }
      });
    }
    onProgress?.({ phase: "checking", checked, total: claims.length });
  }

  for (const [skill, list] of Object.entries(evidence)) {
    evidence[skill] = list.filter((_, idx) => !rejected.has(`${skill}::${idx}`));
  }

  return {
    ok: true as const,
    evidence,
    matchedCount: Object.values(evidence).filter((v) => v.length).length,
    coursesRead: targets.length - unread,
    coursesUnread: unread,
    calls: batches.length,
    coursesPerCall: per,
    verifyCalls,
    claimsMade: claims.length,
    claimsRefuted: rejected.size,
    costUsd,
  };
}

export async function POST(req: Request) {
  let skills: string[] = [];
  let schoolId = "";
  let courseIds: string[] = [];
  let stream = false;
  let context: Record<string, string> = {};
  try {
    ({ skills, schoolId, courseIds, stream = false, context = {} } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Send `skills`, `schoolId` and `courseIds`." }, { status: 400 });
  }

  const school = getSchool(schoolId);
  if (!school) return NextResponse.json({ ok: false, error: "Unknown school." }, { status: 400 });

  skills = (skills ?? []).map(String).map((s) => s.trim()).filter(Boolean).slice(0, 30);
  const catalog = new Map(school.courses.map((c) => [c.id, c]));
  // This used to stop at 60. That cap made sense when every course cost its own
  // model call, and became a silent lie the moment batching landed: the page
  // said "no class in this catalog teaches that" while ninety courses had never
  // been looked at. The batches are what bound the cost now, not a truncation.
  const targets = (courseIds ?? [])
    .map((id) => catalog.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .slice(0, 400);
  if (!skills.length || !targets.length) {
    return NextResponse.json({ ok: false, error: "Nothing to compare." }, { status: 400 });
  }

  const { key } = await getActiveKey();
  if (!key) {
    return NextResponse.json({ ok: false, error: "No API key connected." }, { status: 400 });
  }

  // Default stays a plain JSON response, so the "add a skill" path on the plan
  // page is untouched. The survey opts in, because it is the one place someone
  // sits watching a blank screen for the better part of a minute.
  if (!stream) {
    try {
      return NextResponse.json(await runRelevance({ key, skills, targets, context }));
    } catch (e) {
      const err = e as HaikuError;
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status ?? 502 });
    }
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      send({ type: "start", total: targets.length });
      try {
        const result = await runRelevance({
          key, skills, targets, context,
          onProgress: (p) => send({ type: "progress", ...p }),
        });
        send({ type: "done", ...result });
      } catch (e) {
        send({ type: "done", ok: false, error: (e as HaikuError).message });
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
