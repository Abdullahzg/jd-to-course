import { NextResponse } from "next/server";
import { getActiveKey } from "@/lib/ai/keystore";
import { HaikuError, haiku } from "@/lib/ai/haiku";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// BUILD_SPEC §5, allowed live use #3: job description → skill list.
//
// Unstructured input, so it has to run live. The model does not see the
// catalog, does not see the student, and cannot name a course, because there is
// no course anywhere in its context to name.
//
// Two things changed here after a user looked at a machine learning posting and
// reasonably asked whether the machine learning skills were hardcoded.
//
// First, every skill now has to arrive with the sentence from the posting that
// asked for it, copied out word for word, and the sentence is checked against
// the posting before it is returned. A claim you can trace to a line you wrote
// is not a claim you have to trust.
//
// Second, the prompt used to illustrate the output format with "PyTorch",
// "Distributed systems", "SQL", "Computer networks". Four examples, all of them
// software, sitting in front of every posting the product ever reads. That is a
// thumb on the scale even when the extraction is otherwise honest, so the
// examples now span unrelated trades and none of them is a machine learning
// term.

const REQ_SYSTEM = `You extract requirements from a job posting, and for each one you
quote the sentence that asked for it.

For every requirement, return three things:

1. "skill" - the SUBJECT being asked for, named the way a syllabus or a
   practitioner would name it. Examples from unrelated fields, to show the
   register only: "Venepuncture", "Double entry bookkeeping", "HACCP
   documentation", "Kiln firing", "Lease drafting", "Kubernetes".
   Name the subject, never the wrapper around it. "Modelling experience in
   recommender systems" is the subject "Recommender systems". "5 years managing
   kitchens" is the subject "Kitchen management". "Publications at NeurIPS" is
   the subject "Machine learning research". The wrapper is what "kind" is for,
   and putting it in the name twice makes the subject unsearchable.

2. "evidence" - the sentence from the posting that asks for it, copied out
   EXACTLY. Character for character. Do not paraphrase, do not tidy the grammar,
   do not join two sentences. If you cannot find a sentence that asks for it,
   then the posting did not ask for it, so leave the requirement out entirely.

3. "kind" - what the posting wants beyond knowing the subject:
   - "teachable": knowing the subject is what is being asked for. A course that
     covers it satisfies the requirement.
   - "experience": the posting wants the subject practised, not merely studied.
     "3 years in production", "modelling experience in", "led a team",
     "shipped at scale", "on-call". A course teaches the subject but cannot put
     the years behind you, so this is a partial answer at best.
   - "credential": a licence, certification, degree, clearance or publication
     record that an ISSUING BODY grants. "ServSafe certified", "pursuing a PhD",
     "publications at NeurIPS", "registered nurse", "active US security
     clearance", "bar admission". The test is whether some organisation issues
     it and can take it away. A SUBJECT is never a credential: "software
     engineering", "machine learning" and "data analysis" are things you know,
     not things you hold, and calling them credentials tells a student their
     degree cannot supply the thing their degree is made of.
   When you are unsure between teachable and experience, read the verb. "Have a
   solid foundation in" is teachable. "Experience with" is experience.

Rules:
- Read the whole posting. The requirements are usually spread between the team
  description, the responsibilities and the qualifications, not just the list.
- A REQUIREMENT IS NOT ONLY A TECHNOLOGY. This is the most common way to get
  this wrong. Postings ask for judgement, collaboration, domain knowledge,
  writing, regulation and commercial understanding, and they are usually the
  reason a candidate is actually hired or rejected. Extract them with the same
  seriousness as the tools. Real examples of requirements that get missed:
    "partner across disciplines with global teams"  -> Cross functional collaboration
    "grow their business understanding"             -> Business acumen
    "a strong user focus"                           -> User centred design
    "present findings to executives"                -> Technical communication
    "own food safety compliance"                    -> Regulatory compliance
    "mentor junior engineers"                       -> Mentoring
    "work with clinicians and patients"             -> Clinical communication
    "make sound ethical judgements"                 -> Professional ethics
  If the posting says it, extract it. Only skip a phrase when it is genuinely
  boilerplate rather than something the job asks of the person.
- Do not steer toward engineering because engineering postings are common. Read
  what this posting says. A curriculum planner has to work for law, nursing,
  accounting and design, so the extractor cannot assume the answer is software.
- Take the posting on its own terms. Extract what it asks for, whatever field
  that is. Do not steer toward technology because the examples above mention
  some, and do not steer away from it either.
- Never merge two distinct requirements into one entry. When one sentence lists
  several distinct things, give each its own entry and let them all quote that
  same sentence. A sentence reading "modelling experience in ads, search,
  recommender systems, NLP/CV, multimodal and agents" is six requirements, not
  one, because a course can teach one of them without touching the others.
- Never split one requirement across two entries. "PyTorch or TensorFlow" is one
  entry. "Transformers" and "Transformer models" are one entry.
- Ignore boilerplate: equal opportunity statements, benefits, pay ranges,
  accommodation notices, company mission copy, office locations.
- Never name a university course, a course code, or a degree requirement. You do
  not know the catalog and must not guess at one.
WORKED EXAMPLES of the three kinds.

  "An active US Security clearance, or eligibility to obtain one, is required."
    -> skill "US security clearance", kind credential. A government issues it.
  "ServSafe certification required."
    -> skill "ServSafe certification", kind credential.
  "Experience coding in Java, C++, Python or similar."
    -> four entries, kind experience, because the posting wants them used. They
       are NOT credentials and NOT unteachable: a class teaches Java perfectly
       well, this posting simply also wants you to have shipped with it.
  "Have a solid foundation in algorithms related to LLMs."
    -> skill "Large language model algorithms", kind teachable. "Foundation in"
       is knowledge, so this one a course can fully answer.
  "Strong publications record in top conferences."
    -> skill "Machine learning research", kind credential. A programme committee
       grants it.
  "5 years managing kitchens."
    -> skill "Kitchen management", kind experience. The subject is teachable,
       the five years are not.

- Between 8 and 22 entries. Sentence case for the skill name. No duplicates.
- Prefer the specific over the general. "Recommender systems" is more useful than
  "modelling experience", because a catalog can be searched for the first.`;

const FACET_SYSTEM = `You read a job posting and describe the work it is made of.

Return "roleSummary": one sentence, at most 25 words, saying what this job
actually is. Take it from the posting. Do not flatter it.

Finally return "facets": between three and seven PARTS OF THE WORK this job is
made of, phrased as what the person does, not as subjects. These are the buckets
everything else gets organised into, so they have to be the real shape of the
job rather than a restatement of its keywords.

  For a backend e-commerce internship, good facets are
    "keeping services up under load"
    "designing the APIs other teams build on"
    "storing and querying product and order data"
    "making requests faster"
  Bad facets are "programming", "backend", "Python", "computer science".

  For a ward nurse, good facets are "assessing a patient at the bedside",
  "giving medication safely", "recording care so the next shift can follow it".

Each facet has:
  - "name": the phrase itself, three to eight words.
  - "quote": a sentence from the posting, copied EXACTLY, that shows this is
    part of the work.
  - "weight": "core" if the job is largely this, "supporting" if it is real but
    secondary, "incidental" if the posting mentions it once in passing.
  - "actor": WHOSE HANDS do this work. "own" when the person in the posting
    does it themselves; "around" when the team around them does it and this
    person directs, measures or coordinates it. Read the verbs and the role
    title together: a product manager posting saying "build core product
    capabilities such as data pipelines" means the person SPECIFIES pipelines
    and engineers build them, so actor is "around". The same sentence in a
    backend engineer posting is "own". When you are not sure, say "own".
    This matters more than it looks: every facet you mark "around" stops
    technical courses being sold to the student as their direct preparation.
    A worked example, an AI product manager posting: "improving detection
    system accuracy" is around, engineers train the models. "Defining metrics
    and running experiments" is own, the manager decides what to measure.
    "Translating requirements into roadmaps" is own. Do not let the imperative
    grammar of job ads fool you: every bullet is written as "improve X" even
    when the reader will manage the improving, so judge from the ROLE TITLE
    first and the verb second. For manager and analyst roles, verbs like
    drive, oversee, ensure and deliver applied to a technical capability are
    "around"; verbs like define, decide, analyse, measure and write are "own".
  - "actorQuote": the verb phrase from the posting, copied exactly, that shows
    whose hands it is.

A facet must be WORK, not a disposition. "Owning projects through obstacles to
completion", "learning customer needs", "being a self-starter" and "thriving in
ambiguity" describe a person, not a task, and no course syllabus addresses them.
Every facet has to be something you could imagine a class teaching or failing to
teach. If the posting's most distinctive line is a character trait, take the
concrete work it sits next to instead.

WORKED EXAMPLES of good and bad facets.

  POSTING SAYS: "You will draft and refine the policies that govern what belongs
  on the platform, and analyse data to understand how those policies behave once
  they are live."
  GOOD: "Drafting and refining platform policies" (core), "Analysing how
  policies behave once live" (core).
  BAD: "Governance" (a field, not work), "Policy and data" (two things fused),
  "Attention to detail" (a disposition).

  POSTING SAYS: "You will own your projects through obstacles to completion and
  hold a high bar for code quality."
  GOOD: "Maintaining code quality standards".
  BAD: "Owning projects through obstacles to completion". That is a character
  trait. No syllabus teaches it and matching courses against it produces
  nonsense. Take the concrete work beside it instead.

  POSTING SAYS: "Comfortable in fast-paced customer environments."
  GOOD: nothing. This is a working style, not a task.
  BAD: "Environment handling". A later step will match that against courses
  about simulated environments in reinforcement learning, which is a different
  meaning of the word entirely.

  POSTING SAYS: "Build the data integration and visualization tools operations
  planners rely on, working across the stack from storage to interface."
  GOOD: "Integrating data from incompatible systems" (core), "Visualising
  operational data for analysts" (core).
  BAD: "Working across the stack" (too vague to match anything).

Facets must not overlap, and this is the rule most often broken. A posting that
mentions accessibility twice produced "Designing and building accessible
components" and "Owning accessibility compliance" as separate parts, which
splits one job into two and makes a catalog look as though it covers half of
what it covers. Before you answer, read your own list back and merge any two
that a single course could reasonably satisfy.`;


const FACET_SCHEMA = {
  name: "work_parts",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      roleSummary: { type: "string" },
      facets: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            quote: { type: "string" },
            weight: { type: "string", enum: ["core", "supporting", "incidental"] },
            actor: { type: "string", enum: ["own", "around"] },
            actorQuote: { type: "string" },
          },
          required: ["name", "quote", "weight", "actor"],
        },
      },
    },
    required: ["roleSummary", "facets"],
  },
} as const;

const REQ_SCHEMA = {
  name: "requirements",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      requirements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            skill: { type: "string" },
            evidence: { type: "string" },
            kind: { type: "string", enum: ["teachable", "experience", "credential"] },
          },
          required: ["skill", "evidence", "kind"],
        },
      },
    },
    required: ["requirements"],
  },
} as const;

/**
 * Does this quote really appear in the posting?
 *
 * Exact match first. Failing that, the same characters ignoring whitespace and
 * the curly quotes and non-breaking spaces that job boards are full of, since a
 * posting pasted out of a browser is rarely clean. Anything looser than that
 * would let a paraphrase through, which is the whole thing this is here to stop.
 */
function quoteIsReal(jd: string, quote: string): boolean {
  if (!quote || quote.length < 8) return false;
  if (jd.includes(quote)) return true;
  const flatten = (s: string) =>
    s
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[ ​⁠]/g, " ")
      .replace(/[‐-―]/g, "-")
      .replace(/\s+/g, "")
      .toLowerCase();
  return flatten(jd).includes(flatten(quote));
}

export async function POST(req: Request) {
  const { key } = await getActiveKey();
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No API key connected. Add one in the bar at the top, or type the skills in yourself and the solver will run without any AI at all.",
      },
      { status: 400 },
    );
  }

  let jd = "";
  try {
    ({ jd } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON body with a `jd`." }, { status: 400 });
  }

  jd = (jd ?? "").trim();
  if (jd.length < 40) {
    return NextResponse.json(
      { ok: false, error: "That's too short to read as a job posting. Paste the whole thing." },
      { status: 400 },
    );
  }

  const window = jd.slice(0, 16000);

  try {
    // Two calls, run together, rather than one that writes everything.
    //
    // Asking for the parts of the work AND twenty odd requirements, each with a
    // verbatim quote, in a single response meant two and a half thousand output
    // tokens, and output tokens are what latency is made of: a single call was
    // taking thirty five seconds while the provider itself answered a small
    // request in three. They are independent, so they no longer wait for each
    // other, and the loader can move on as soon as the shorter one lands.
    type FacetDraft = { roleSummary: string; facets: { name: string; quote: string; weight: string; actor?: string; actorQuote?: string }[] };
    const facetDraw = () => haiku<FacetDraft>({
      key,
      purpose: "job posting → the parts of the work",
      system: FACET_SYSTEM,
      user: window,
      schema: FACET_SCHEMA as never,
      maxTokens: 900,
    });
    // Everything downstream stands on the facets, so a single unlucky reading
    // there cascades: one run of a product manager posting labelled the
    // classification facet as the person's own hands, and three technical
    // courses lit up as direct preparation on the strength of that one flip.
    // Two independent readings and a reconciliation, run alongside the
    // requirements call, so the whole tree grows from a steadier root.
    const [draftA, draftB, reqRes] = await Promise.all([
      facetDraw(),
      facetDraw().catch(() => null),
      haiku<{ requirements: { skill: string; evidence: string; kind: string }[] }>({
        key,
        purpose: "job posting → requirements with quotes",
        system: REQ_SYSTEM,
        user: window,
        schema: REQ_SCHEMA as never,
        maxTokens: 1600,
      }),
    ]);
    let facetRes = draftA;
    if (draftB) {
      try {
        const merged = await haiku<FacetDraft>({
          key,
          purpose: "reconcile two facet readings",
          system: `Two independent readings of the same job posting follow, each a list of the parts of the work. Produce ONE consolidated list of three to seven parts.

Where the readings agree in substance, keep the clearer wording. Where only
one reading saw a real part of the work, keep it. For "actor", the stakes are
one sided: marking the person's own work as the team's hides good courses,
but marking the team's work as the person's sells wrong courses as direct
preparation, which is worse. So when the two readings disagree on actor,
"around" wins. Copy quotes exactly from whichever reading carried them.
Same fields, same rules as the readings themselves. Plain words, no em or en
dashes.`,
          user: `READING ONE
${JSON.stringify(draftA.content)}

READING TWO
${JSON.stringify(draftB.content)}`,
          schema: FACET_SCHEMA as never,
          maxTokens: 900,
        });
        if ((merged.content.facets ?? []).length >= 3) {
          facetRes = { content: merged.content, costUsd: draftA.costUsd + draftB.costUsd + merged.costUsd } as typeof draftA;
        }
      } catch { /* one honest reading beats a failed reconciliation */ }
    }

    const content = {
      roleSummary: facetRes.content.roleSummary,
      facets: facetRes.content.facets,
      requirements: reqRes.content.requirements,
    };
    const costUsd = facetRes.costUsd + reqRes.costUsd;

    const seen = new Set<string>();
    const skills: string[] = [];
    const evidence: Record<string, { quote: string; kind: string }> = {};
    let unquoted = 0;

    for (const r of content.requirements ?? []) {
      const skill = String(r.skill ?? "").trim();
      const quote = String(r.evidence ?? "").trim();
      const kind = ["teachable", "experience", "credential"].includes(r.kind) ? r.kind : "teachable";
      const k = skill.toLowerCase();
      if (!skill || skill.length > 90 || seen.has(k)) continue;

      // The posting is the authority on what the posting asks for. A
      // requirement the model could not point at does not get to exist.
      if (!quoteIsReal(window, quote)) {
        unquoted++;
        continue;
      }
      seen.add(k);
      skills.push(skill);
      evidence[skill] = { quote, kind };
      if (skills.length >= 24) break;
    }

    if (!skills.length) {
      return NextResponse.json(
        { ok: false, error: "Nothing in that posting could be traced to a sentence in it. Try pasting the full posting." },
        { status: 422 },
      );
    }

    // Facets are the shape of the job. They are what courses get matched
    // against, so a facet whose quote is not really in the posting is dropped
    // exactly like a requirement.
    const facets = (content.facets ?? [])
      .map((f) => ({
        name: String(f.name ?? "").trim().slice(0, 80),
        quote: String(f.quote ?? "").trim(),
        weight: (["core", "supporting", "incidental"].includes(f.weight) ? f.weight : "supporting") as string,
        // Whose hands. This survived extraction and then this very map threw
        // it away, so every facet reached the matcher actorless and the whole
        // hands test downstream ran on the default. Unknown stays "own"
        // because a silent cap is worse than a visible stretch.
        actor: (f as { actor?: string }).actor === "around" ? "around" : "own",
        actorQuote: String((f as { actorQuote?: string }).actorQuote ?? "").trim(),
      }))
      .slice(0, 8);

    // How many the model proposed, and how many had a quote we could find. A
    // facet dropped here is a part of the job the whole plan will never see, so
    // it is counted rather than silently lost.
    const facetsProposed = facets.length;
    const quotable = facets.filter((f) => f.name && quoteIsReal(window, f.quote));
    const facetsDroppedForQuote = facetsProposed - quotable.length;

    // Belt and braces on the no-overlap rule, but only just.
    //
    // The first version merged anything sharing 60% of its words, which on a
    // content governance posting collapsed five real parts of the job into one:
    // every phrase in that field contains "governance", "policy" or
    // "ecosystem". The page then said "answering 1 of the 1" and every
    // vaguely data-shaped course claimed the single surviving facet.
    //
    // So a merge now needs near identity, and the list can never fall below
    // three, because a job made of one thing is almost never true and is always
    // worse than a job made of five with some overlap.
    const NOISE = new Set([
      "with", "your", "them", "this", "that", "into", "from", "over", "using",
      "across", "through", "their", "team", "teams", "work", "working",
    ]);
    const words = (t: string) =>
      new Set(t.toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !NOISE.has(w)) ?? []);

    const distinct: typeof facets = [];
    for (const f of quotable) {
      const fw = words(f.name);
      const clash = distinct.some((d) => {
        const dw = words(d.name);
        const shared = [...fw].filter((w) => dw.has(w)).length;
        // Near identical: almost every meaningful word in the smaller phrase
        // appears in the larger one, and there are at least two of them.
        return shared >= 2 && shared >= Math.min(fw.size, dw.size) * 0.9;
      });
      if (!clash) distinct.push(f);
    }
    // Never let the merge itself be the thing that flattens a job.
    const finalFacets = distinct.length >= 3 ? distinct : (quotable.length >= 3 ? quotable : facets);

    return NextResponse.json({
      ok: true,
      skills,
      facets: finalFacets,
      facetsProposed,
      facetsDroppedForQuote,
      evidence,
      roleSummary: String(content.roleSummary ?? "").trim(),
      /** Requirements the model asserted but could not quote. Dropped, and counted so it is visible. */
      droppedUnquoted: unquoted,
      costUsd,
    });
  } catch (e) {
    const err = e as HaikuError;
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status ?? 502 });
  }
}
