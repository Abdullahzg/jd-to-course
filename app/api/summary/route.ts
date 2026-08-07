import { NextResponse } from "next/server";
import { getActiveKey } from "@/lib/ai/keystore";
import { HaikuError, haikuStream } from "@/lib/ai/haiku";
import { noDashes } from "@/lib/no-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// BUILD_SPEC §5, allowed live use: explanation rendering. The model is given
// the finished plan and nothing else, and writes it up. It cannot add a course
// or a claim, because it is only ever shown what the solver already decided.

const SYSTEM = `You explain a finished university course plan to the student it belongs to.

You are given the plan as JSON. Every fact you state must come from it.

Write exactly TWO short paragraphs. No headings and no bullets. The only markup
allowed is **bold**, and you use it on course titles and on the two counts, so a
reader can find them without reading the whole paragraph. Nothing else.

PARAGRAPH ONE, what this job actually wants. Read "partsOfTheJob". These are the
parts of the work the plan is built against, and they are exactly what the page
shows the student, so use THESE NAMES and no others. Say what the job is in one
sentence, then say which parts the plan answers and which it does not, using
"answeredByThisPlan".

Then, in one sentence, deal with "alsoWantedButNotPlannedAgainst". Anything whose
reason says an issuing body grants it is a hard stop and you name it plainly. For
anything the posting wants practised, say that the subject is teachable but the
posting also wants it done, and do NOT describe it as something no course
provides, because that is false and the page says otherwise.

PARAGRAPH TWO, what this plan does about it. Two numbers have to appear:
"chosenForThisJob" is how many courses were picked because of this posting, and
"requiredByDegreeAnyway" is how many the degree demands whatever job you want.
State both, because a reader looking at a list of courses assumes every one of
them was chosen for them. Then name, by title, the courses whose "whyItIsHere"
says they were chosen for this posting, and say what they answer. Finish with
one sentence on what the plan does not reach and how that gets picked up
instead.

Rules:
- Never name a course that is not in the JSON. Use titles, not bare codes.
- Never invent a name for a part of the job. Copy them from "partsOfTheJob".
- Never describe the plan as being about a subject that "chosenForThisJob" does
  not support. If two courses out of fourteen were picked for the job, this is a
  computer science degree with two courses aimed at that job, and writing that
  it "focuses on" that subject is false.
- Never say a course is good, easy, popular, or worth taking.
- NEVER LIST COURSES THAT ALL DO THE SAME THING ONE BY ONE. A run of "X, which
  teaches this; Y, which does the same; Z, which addresses it" is unreadable and
  says nothing. When several courses answer one part of the job, group them:
  "Causal Inference, Introduction to Databases and Computer Systems for Data
  Science all speak to measuring whether a policy change worked." Then say what
  is DIFFERENT about the strongest one, in a few words.
- If the plan only reaches one part of the job, say that plainly as a limitation
  rather than dressing five courses around it.
- Never suggest a different plan. The plan is already decided.
- At most four sentences per paragraph. Shorter is better.
- Plain words. Never use an em dash or an en dash.
- Address the student as "you". No preamble, start with the first sentence.`;


export async function POST(req: Request) {
  const { key } = await getActiveKey();
  if (!key) {
    return NextResponse.json({ ok: false, error: "No API key connected." }, { status: 400 });
  }

  let plan: unknown;
  try {
    ({ plan } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Send a `plan`." }, { status: 400 });
  }
  if (!plan) return NextResponse.json({ ok: false, error: "No plan to summarise." }, { status: 400 });

  // Streamed, because this is the last thing between a student and their plan.
  // It starts the moment the solver returns, which is while the loader is still
  // up, and the words land on the page as they are written rather than after.
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try {
        const { text, costUsd } = await haikuStream({
          key,
          purpose: "plan summary",
          system: SYSTEM,
          user: JSON.stringify(plan).slice(0, 14000),
          maxTokens: 480,
          temperature: 0.25,
          onDelta: (d) => send({ type: "delta", text: noDashes(d) }),
        });
        send({ type: "done", ok: true, text: noDashes(text.trim()), costUsd });
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
