import { NextResponse } from "next/server";
import { getActiveKey } from "@/lib/ai/keystore";
import { HaikuError, haikuStream } from "@/lib/ai/haiku";
import { noDashes } from "@/lib/no-dashes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// BUILD_SPEC §5, allowed live use: explanation rendering. The model is given
// the finished plan and nothing else, and writes it up. It cannot add a course
// or a claim, because it is only ever shown what the solver already decided.
//
// That includes the course it names for a part the plan skipped. The prompt now
// reads a three way "status" per part of the job instead of a boolean, because
// a boolean has no way to say "the catalog teaches this, the plan had no room",
// and the model filled the gap by inventing a reason. It shipped "prioritizing
// the roadmap and gathering customer feedback are not teachable in a classroom
// and will come from your internship", while COMS W4170 User Interface Design
// sat in the catalog, eligible, its description naming evaluation and user
// studies. The solver already separates those cases, in coverage.covered,
// coverage.availableIfYouSwap and coverage.courseworkCannotGive, so the status
// is a fact being passed through rather than a judgement being made here.

const SYSTEM = `You explain a finished university course plan to the student it belongs to.

You are given the plan as JSON. Every fact you state must come from it.

Write exactly TWO short paragraphs. No headings and no bullets. The only markup
allowed is **bold**, and you use it on course titles and on the two counts, so a
reader can find them without reading the whole paragraph. Nothing else.

THE THREE STATES. Read this before anything else, because it is the thing this
task gets wrong. Every entry in "partsOfTheJob" carries a "status", and that
field is the ONLY thing that decides what you may say about that part. Do not
work the state out yourself from the rest of the JSON, and do not treat "the
plan does not do it" and "nothing here teaches it" as the same sentence. They
are different facts and a student acts on them differently.

  status "inPlan"
      A course in this plan does it. Name the courses, from "coursesThatDoIt".

  status "inCatalogNotInPlan"
      This catalog teaches it and the plan had no room for it. Name the course
      that does it, from "couldBeTaughtBy", and say the plan spent that slot on
      other courses, so this is a swap the student could make. This part IS
      taught here. Calling it something a classroom cannot teach, or something
      that has to come from an internship, or something no course covers, is
      false, and the page is showing the student that very course while you say
      it.

  status "notInCatalog"
      No course in this catalog does it. Say that every course description was
      read against this posting and none of them covers it, and say it in that
      form. "Nothing here covers it" claims less than this system actually
      knows, and it leaves a student no way to tell whether anyone looked. This
      is the ONLY status that may be described as not taught here.

If any other field looks like it also answers "is this part handled", ignore it.
"status" is the authority.

PARAGRAPH ONE, what this job actually wants. Read "partsOfTheJob". These are the
parts of the work the plan is built against, and they are exactly what the page
shows the student, so use THESE NAMES and no others. Say what the job is in one
sentence, then say which parts are "inPlan" and which are not, keeping the two
kinds of "not" apart as above.

Then deal with "alsoWantedButNotPlannedAgainst". These are not parts of the
work, they have no status, and you read "kind" on each one, or "why" if "kind"
is missing:
  - "credential": an issuing body grants it, so it is a hard stop and you name
    it plainly. No course in any catalog issues one.
  - "experience": the posting wants the subject practised. Say in one clause
    that the subject is taught here, and in a separate clause that the years of
    having done it are the part a course cannot supply. Two clauses, so a
    reader can tell which half is which. Never fuse them into "which courses
    can teach but which you will need to develop through work experience",
    because nobody reading that can say whether a course covers the subject.
Never put a credential and a practised subject in the same list. They fail for
opposite reasons and joining them makes both unreadable. And never fold a
credential into a sentence about the parts of the job. "Prioritising the roadmap
and the AWS certification are the parts this plan does not reach, and both come
from your first year in the role" is wrong twice: a certification is not a part
of this job, and no amount of time in the role issues one.

PARAGRAPH TWO, what this plan does about it. Two numbers have to appear:
"chosenForThisJob" is how many courses were picked because of this posting, and
"requiredByDegreeAnyway" is how many the degree demands whatever job you want.
State both, because a reader looking at a list of courses assumes every one of
them was chosen for them. Then name, by title, the courses whose "whyItIsHere"
says they were chosen for this posting, and say what they answer. Finish with
the parts this plan does not reach, and let the status decide how: an
"inCatalogNotInPlan" part is a swap and you name the course for it, and only a
"notInCatalog" part gets sent to an internship or the first year of the job. If
there are none of either, say the plan reaches all of them and stop.

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
- Never suggest a different plan. The plan is already decided. Naming the course
  behind an "inCatalogNotInPlan" part is not suggesting a plan, it is reporting
  a status the JSON already carries.
- At most five sentences in paragraph one and four in paragraph two. Shorter is
  better. Paragraph one gets the extra sentence because the parts of the job can
  land in three states and squeezing them together is what produced the false
  claim in the first place. If it still will not fit, cut detail from the parts
  that are "inPlan", never from the two kinds of not.
- Plain words. Never use an em dash or an en dash.
- Address the student as "you". No preamble, start with the first sentence.

WORKED EXAMPLES, one per status and then the two ways they get mixed up. Every
"NOT" below is a sentence this system has actually shipped.

EXAMPLE 1, status "inPlan".
  THE JSON: { "part": "Building dashboards and running SQL queries",
              "status": "inPlan",
              "coursesThatDoIt": ["Introduction to Databases"] }
  WRITE: "Your plan answers building dashboards and running SQL queries through
  **Introduction to Databases**."
  NOT: any hedge about how much of it a course really covers. The course is in
  the plan and the student is taking it.

EXAMPLE 2, status "inCatalogNotInPlan".
  THE JSON: { "part": "Gathering customer feedback",
              "status": "inCatalogNotInPlan",
              "couldBeTaughtBy": [{ "title": "User Interface Design",
                                    "replacesTitle": "an elective",
                                    "extraCredits": 0 }] }
  WRITE: "Gathering customer feedback is taught here, by **User Interface
  Design**. Your plan used that slot for other courses, so it is a swap you
  could make."
  NOT: "Gathering customer feedback is not teachable in a classroom and will
  come from your internship." User Interface Design is in this catalog, is
  eligible, and teaches evaluation and user studies. Read the status.

EXAMPLE 3, status "notInCatalog".
  THE JSON: { "part": "Prioritising the roadmap", "status": "notInCatalog" }
  WRITE: "Every course description in this catalog was read against this
  posting and none of them covers prioritising the roadmap, so that one comes
  from the work itself."
  NOT: naming a course for it or calling it a swap. There is no course to name.

EXAMPLE 4, two statuses in one sentence, which is where this goes wrong.
  THE JSON: "Gathering customer feedback" is "inCatalogNotInPlan" and
  "Prioritising the roadmap" is "notInCatalog".
  WRITE: "Two parts sit outside the plan, for different reasons. **User
  Interface Design** teaches gathering customer feedback and your plan chose
  other courses, so that one is a swap. Prioritising the roadmap is the one
  nothing in this catalog covers, and it comes from the job itself."
  NOT: "The two parts of the job your plan does not reach, prioritizing the
  roadmap and gathering customer feedback, are not teachable in a classroom and
  will come from your internship and early career work." That bundles two
  states into one claim, and the half about customer feedback is false.

EXAMPLE 5, "alsoWantedButNotPlannedAgainst" with kind "experience".
  THE JSON: [{ "thing": "Cross-functional collaboration", "kind": "experience" },
             { "thing": "Customer communication", "kind": "experience" }]
  WRITE: "The posting also wants cross-functional collaboration and customer
  communication practised rather than only studied: courses here teach both
  subjects, and what they cannot hand you is the years of having done them."
  One sentence, two clauses. The reader can tell which half is which and it
  still fits the budget.
  NOT: "which courses can teach but which you will need to develop through work
  experience." A reader cannot tell from that whether a course covers it.`;


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
