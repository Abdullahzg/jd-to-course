import { NextResponse } from "next/server";
import { getActiveKey } from "@/lib/ai/keystore";
import { HaikuError, haikuStream } from "@/lib/ai/haiku";
import { noDashes } from "@/lib/no-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// BUILD_SPEC §5, allowed live use #4: chat → constraint translation.
// The model emits a constraint patch as JSON. The solver re-runs. The UI
// renders the solver's answer. The model never states a result — and it
// structurally cannot, because the only field it can put a plan in doesn't
// exist in the schema.

const SYSTEM = `You turn a student's sentence into a constraint change for a scheduling solver.

You are given the current plan as JSON and a message. You may:

1. Answer a question about the plan using ONLY facts in the JSON.
2. Explain WHY the plan looks the way it does, using the reasoning fields the
   solver has already put in the JSON for you. This is the most common question
   and you must actually answer it. Do not say you cannot explain the solver's
   reasoning: it handed you the reasoning. The fields are
     "whyItIsInThePlan"                    why this course is here at all
     "answersFromThePosting"               which requirements it answers, each
                                           with the catalog sentence proving it
     "whyThisSemesterAndNotEarlier"        what was holding it back
     "otherCoursesThatFitTheSameSlot"      what else could have gone here and
                                           what that would have cost
   When asked "why this course", say what requirement of the degree it fills,
   what it answers from the posting, and quote the catalog sentence. If there
   were alternatives, name one and say what taking it instead would change.
3. When a student asks why something from the posting is missing, answer from
   "partsOfTheJobWithNoCourse" and from nothing else.
     If it names "aCourseThatWouldCoverIt", say which course would cover it,
     which course in the plan it would take the place of, and what the swap
     costs in credits.
     If it gives a "whyNoCourseCovers" reason instead, give that reason plainly.
     If the part is not in that list, first check "partsOfTheJob" and the
     placements. If a course answers it, name that course. If the phrase is not
     anywhere in the posting's parts either, say plainly that this posting did
     not ask for it, and name the parts it did ask for. Do not conclude from
     absence alone that the plan covers it: asked about roadmap prioritisation
     on a security posting, that inference produced "a course in your plan
     already answers it, however I cannot find which one", which is a guess
     wearing the clothes of an answer.
   Never answer this question with "I can only tell you what is in your plan".
   The reason a thing is missing lives in the courses that were read and not
   chosen, and those are in the JSON now.
4. Propose ONE constraint change, which the student confirms before it runs.

You may never:
- State what the new plan would be. You do not know. The solver decides after
  the change is applied, not you.
- Say a course is good, bad, easy, hard, popular, or worth taking.
- Name a course that is not in the JSON you were given.
- Claim a requirement is or is not satisfied unless the JSON says so.

Patch kinds:
- "exclude": the student does not want specific courses. Fill courseIds.
- "lock": the student wants a course in a specific term. Fill courseIds
               with exactly one id, and term with the 0-based term index.
- "horizon": the student wants more or fewer terms. Fill horizonTerms.
- "none": this is a question, or you cannot map it to a constraint.

Set "label" to a short confirm-button sentence in the student's own terms, e.g.
"Exclude COMS W4118" or "Plan across 5 terms". Leave it empty when kind is none.

"reply" is 1-4 sentences for a question about the plan, and may quote the
catalog sentence when explaining why a course is there. If you are proposing a change, say what the change is
and that the solver will re-run. Never say what the result will be.

Never use an em dash or an en dash in your reply. Use a comma, a colon, or a
full stop instead.

You may use **bold** on a course title or a number so it can be found in a
paragraph. No other markup: no headings, no bullets, no links, no tables.

FORMAT. Write your answer as prose, and nothing before it. If, and only if, you
are proposing a constraint change, finish with a single final line of exactly
this shape and nothing after it:

PATCH: {"kind":"exclude","courseIds":["COLUMBIA:COMSW4118"],"term":null,"horizonTerms":null,"label":"Exclude Operating Systems I"}

kind is one of exclude, lock, horizon. Omit the whole PATCH line when you are
only answering a question, which is most of the time. The line is machine read,
so it must be valid JSON on one line, and the student never sees it.`;

const SCHEMA = {
  name: "constraint_patch",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: { type: "string" },
      kind: { type: "string", enum: ["exclude", "lock", "horizon", "none"] },
      courseIds: { type: "array", items: { type: "string" } },
      term: { type: ["integer", "null"] },
      horizonTerms: { type: ["integer", "null"] },
      label: { type: "string" },
    },
    required: ["reply", "kind", "courseIds", "term", "horizonTerms", "label"],
  },
} as const;

type Patch = {
  reply: string;
  kind: "exclude" | "lock" | "horizon" | "none";
  courseIds: string[];
  term: number | null;
  horizonTerms: number | null;
  label: string;
};

export async function POST(req: Request) {
  const { key } = await getActiveKey();
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "No API key connected. Add an OpenRouter or Anthropic key in the bar at the top." },
      { status: 400 },
    );
  }

  let message = "";
  let plan: unknown = null;
  try {
    ({ message, plan } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON body with a `message`." }, { status: 400 });
  }

  message = (message ?? "").trim();
  if (!message) {
    return NextResponse.json({ ok: false, error: "Type a question first." }, { status: 400 });
  }

  // The answer streams and the patch arrives at the end.
  //
  // This used to be one structured call returning {reply, kind, courseIds}. The
  // prose was therefore trapped inside a JSON field, which cannot be shown a
  // word at a time, so a question took eight silent seconds and then appeared
  // all at once. Now the model writes the answer first and appends a single
  // machine readable line, so the text can be forwarded as it arrives and the
  // patch is still parsed and validated exactly as strictly as before.
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      let full = "";
      let shown = 0;
      try {
        const { costUsd } = await haikuStream({
          key,
          purpose: "chat → answer and constraint patch",
          system: SYSTEM,
          user: `CURRENT PLAN\n${JSON.stringify(plan).slice(0, 12000)}\n\nMESSAGE\n${message.slice(0, 1200)}`,
          maxTokens: 700,
          temperature: 0.1,
          onDelta: (d) => {
            full += d;
            // Hold anything from the PATCH marker onward. Until the marker is
            // certain, keep back the last few characters so a partial "PATC"
            // is never printed to the student.
            const cut = full.indexOf("PATCH:");
            const visible = cut >= 0 ? full.slice(0, cut) : full.slice(0, Math.max(0, full.length - 6));
            if (visible.length > shown) {
              send({ type: "delta", text: visible.slice(shown) });
              shown = visible.length;
            }
          },
        });

        const cut = full.indexOf("PATCH:");
        const reply = (cut >= 0 ? full.slice(0, cut) : full).trim();
        if (reply.length > shown) send({ type: "delta", text: reply.slice(shown) });

        // The patch is validated here, not trusted. A course id the model
        // invented is dropped rather than sent to the solver.
        let patch: { kind: string; courseIds: string[]; term: number | null; horizonTerms: number | null; label: string } | null = null;
        if (cut >= 0) {
          try {
            const raw = full.slice(cut + "PATCH:".length).trim().split("\n")[0];
            const c = JSON.parse(raw) as Patch;
            const known = new Set(collectCourseIds(plan));
            const courseIds = (c.courseIds ?? []).filter((id) => known.has(id));
            let kind = c.kind ?? "none";
            if ((kind === "exclude" || kind === "lock") && courseIds.length === 0) kind = "none";
            if (kind === "lock" && (c.term == null || c.term < 0 || c.term > 7)) kind = "none";
            if (kind === "horizon" && (c.horizonTerms == null || c.horizonTerms < 1 || c.horizonTerms > 8)) kind = "none";
            if (kind !== "none") {
              patch = {
                kind,
                courseIds: kind === "lock" ? courseIds.slice(0, 1) : courseIds.slice(0, 12),
                term: c.term ?? null,
                horizonTerms: c.horizonTerms ?? null,
                label: String(c.label ?? "").slice(0, 90),
              };
            }
          } catch { /* an unparseable patch line is simply no patch */ }
        }

        send({ type: "done", ok: true, reply: reply.slice(0, 1400), patch, costUsd });
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

/**
 * Every course id the plan mentions.
 *
 * The model is only allowed to act on courses it was actually shown. Anything
 * outside this set is a hallucinated id, and a hallucinated id sent to the
 * solver would either do nothing or, worse, exclude something real by accident.
 */
function collectCourseIds(plan: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === "object") { Object.values(v as Record<string, unknown>).forEach(walk); return; }
    if (typeof v === "string" && /^[A-Z]+:[A-Z0-9]+$/.test(v)) out.push(v);
  };
  walk(plan);
  return out;
}
