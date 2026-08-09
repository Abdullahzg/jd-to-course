import { NextResponse } from "next/server";
import { getActiveKey } from "@/lib/ai/keystore";
import { HaikuError, haiku } from "@/lib/ai/haiku";
import { getSchool } from "@/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

// ─────────────────────────────────────────────────────────────────────────────
// Reading a course against the actual posting, with no keyword layer between.
//
// The old path went: posting -> list of skill strings -> does this course teach
// skill X. That funnel is where the quality went. A backend posting became the
// word "Python", "Python" matched twenty of a hundred and fifty one Columbia
// courses, and the planner could then claim a plan answered the job because
// somewhere in it a course mentioned Python. Meanwhile everything the posting
// actually said, that this is e-commerce traffic at scale, that reliability and
// throughput are the work, never reached the course at all.
//
// There are 151 courses. That is small enough to stop distilling and simply
// show the model the whole posting and the whole course description, and ask
// the question we actually care about: would taking this course make this
// person better at this job, and what in the two texts proves it. A hundred and
// fifty one judgements at six courses a call is roughly twenty five calls.
//
// The model still cannot pick courses. It rates one course at a time against
// one posting, it never sees the degree rules, the student, the timetable or
// the other candidates, and it has to quote both sides. The solver does the
// choosing, exactly as before.
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM = `You judge whether a university course would help someone do a specific job.

You are given one JOB POSTING in full, and several COURSES with their full
catalog descriptions. For each course, decide whether taking it would make a
person materially better at THAT job.

For each course return:

- "helps": true or false.
- "strength": how much it matters for this job.
    "central"     doing this job well depends on knowing this. Someone without
                  it would struggle in the role from day one.
    "useful"      a hiring manager would nod at it on a transcript for this
                  specific job. Not "a computer science course is good for a
                  computer science job": something in this course maps onto
                  something in this posting.
    "tangential"  a real but small connection. Prefer helps:false over this
                  unless you can say something specific.

  Calibrate: out of a whole university catalog, expect fewer than one course in
  five to help with any given job. If you find yourself saying yes to most of a
  batch, your bar is too low and you are describing the field rather than the
  job.
- "aspects": EVERY part of the job this course speaks to, copied EXACTLY from the
  numbered PARTS OF THE JOB list. Copy the names letter for letter. Do not
  invent wording and do not combine two of them.
  A course can serve more than one part and you must list all of them. This
  matters: one interface design course was the only course in a hundred and
  thirty nine that mentioned accessibility, it was allowed to name a single
  part, and the student was told no course covered the other one while sitting
  in that very class.
  If a course helps with the job but with no part on the list, that is
  helps:false, because the list is what this student is being planned against.
- "why": one sentence, at most 30 words, in plain language, saying what this
  course would let the person do on this job. Write it for the student.
- "courseQuote": a sentence copied EXACTLY from that course's description that
  shows it covers this. Character for character.
- "jobQuote": a sentence or clause copied EXACTLY from the posting that shows
  the job needs it. Character for character.

The rules that matter:

- BOTH quotes must be real. If you cannot find a sentence on both sides, the
  answer is helps:false. This is not negotiable: every claim this system makes
  is shown to a student next to the text it came from.
- USING a tool is not the point. Almost every computer science course involves
  programming. "Assignments are in Python" is not a reason to take a course for
  a backend job. Ask what the course would let them DO, not what language it
  happens to use.
- Being in the same field is not helping. For a backend engineering job, a
  course on training neural networks is not "performance optimisation" because
  both involve making something faster. Different work, different machines.
- A TECHNIQUE APPLIED TO ANOTHER FIELD IS NOT THAT TECHNIQUE. This one keeps
  slipping through. "Deep Learning for Biomedical Signal Processing" is a
  biomedical course: its worked examples are ECG traces and MRI volumes, its
  assumptions are about physiology, and someone who takes it learns to analyse
  clinical signals. It does not prepare anyone for machine learning at a
  software company, and neither does "Machine Learning for Biomolecular
  Applications", "Applied Machine Learning in Civil Engineering", "Computational
  Solid Mechanics with AI", or "Machine learning for environmental engineering".
  Read what the course is ABOUT, not which methods it borrows. If the domain in
  the title is not the domain in the posting, the answer is helps:false unless
  the description itself says the material is general.
- BUILDING a technology is not the same as USING it. This one catches people out
  constantly. A part of the job reading "apply AI-assisted development practices
  to improve coding efficiency, documentation and debugging" is about a person
  using AI tools to write software faster. A course on machine learning,
  statistical learning theory or neural networks teaches you to BUILD such
  systems, which is a different profession, and it will not make anyone faster
  at their day job with an assistant. Answer helps:false unless the description
  actually describes using the technology as a tool in the way the posting
  means. The same trap: a course on compiler construction does not teach you to
  use a compiler, and a database internals course does not teach you to use a
  database.
- Read what the job is actually for. A posting about content moderation systems
  and a posting about payments both mention scale, and they need different
  things. The aspect you write must be recognisably about THIS posting.
- THE SAME WORD IN TWO TRADES IS TWO WORDS. Before you match on a term, say to
  yourself what it refers to in the posting and what it refers to in the course
  description, and check they are the same thing. "Environment" is a room full
  of people in a customer posting and a simulator in reinforcement learning.
  "Agent" is a support rep and a policy learner. "Vision" is a product direction
  and a camera pipeline. "Network" is a room of contacts and a stack of
  protocols. "Pipeline" is a list of deals and a sequence of data jobs. "Scale"
  is more customers and more machines. "Memory" is what a person forgets and
  what a process allocates. "Model" is a spreadsheet of the business and a set
  of learned weights. Same spelling, different trade, helps:false.
- WOULD A PRACTITIONER CALL THIS TRAINING. Picture someone who already does this
  job well, reading this course description. Do they say "yes, that is where you
  learn that part of my job", or do they say "that is a different profession"?
  A content policy manager does not learn their job from convolutional neural
  networks, however much both deal with images. This test catches what the word
  test misses, so apply both.
- helps:false is the common answer. Most of a university catalog has nothing to
  do with any given job, and saying so is the useful part. A planner that finds
  every course relevant has told the student nothing.
- Never mention a course that is not in front of you. Never invent a quote.

WORKED EXAMPLES. Study these before answering; they are the judgement calls this
task actually turns on.

EXAMPLE 1, a word that means two different things.
  PART OF THE JOB: "Handling difficult customer environments"
  COURSE: Reinforcement Learning. "Agents interacting with environments,
  Markov decision processes, Q-learning, policy gradient methods."
  ANSWER: helps false.
  WHY: "environment" in the posting is a workplace full of people. "Environment"
  in the course is a simulator an agent acts on. Same word, unrelated work. This
  is the single most common way this task is failed.

EXAMPLE 2, a genuine match that looks unglamorous.
  PART OF THE JOB: "Building dashboards and running SQL queries"
  COURSE: Introduction to Databases. "relational data definition and
  manipulation languages, SQL, XML, query processing, physical database tuning"
  ANSWER: helps true, strength central, aspect "Building dashboards and running
  SQL queries".
  WHY: the course sentence names the exact thing the job sentence asks for.

EXAMPLE 3, the field is right and the work is not.
  PART OF THE JOB: "Keeping services up under load"
  COURSE: Deep Learning Systems. "GPU acceleration, training large models,
  distributed data and model parallelism, model serving in production."
  ANSWER: helps false.
  WHY: both are about performance at scale, but one is a service taking traffic
  and the other is a training run. Different machines, different failure modes.

EXAMPLE 4, another domain borrowing the method.
  PART OF THE JOB: "Training recommendation models"
  COURSE: Deep Learning for Biomedical Signal Processing. "methods in deep
  learning, focus on applications to biomedical signals and sequences."
  ANSWER: helps false.
  WHY: the course is about ECG traces and physiology. It borrows deep learning;
  it is not about the work in this posting.

EXAMPLE 5, using a tool is not the subject.
  PART OF THE JOB: "Applying AI-assisted development practices"
  COURSE: Machine Learning. "supervised learning, linear and logistic
  regression, support vector machines, kernel methods."
  ANSWER: helps false.
  WHY: the posting means a person using AI tools to write software faster. The
  course teaches you to build such systems, which is a different profession.

EXAMPLE 6, one course serving two parts.
  PART OF THE JOB: "Designing accessible components" and "Working with designers"
  COURSE: User Interface Design. "design methods, prototyping, evaluation and
  user studies, accessibility, and implementation of interactive systems."
  ANSWER: helps true, aspects BOTH parts.
  WHY: the sentence names accessibility and names design methods with user
  studies. List every part a course genuinely serves, not just the first.

EXAMPLE 7, the posting is not a technical posting at all.
  PART OF THE JOB: "Testing and optimizing content governance approaches"
  COURSE: Computer Vision I. "image formation, feature detection, and object
  recognition with convolutional neural networks."
  ANSWER: helps false.
  WHY: this job is written for someone who drafts policy and reads data about
  how it behaves once live, not someone who builds detectors. "Content" and
  "detection" exist in both worlds and mean different work in each. A content
  policy manager would not call this description training for their job. A
  posting being non technical does not mean any technical course will do, it
  means most of this catalog is the wrong answer and saying so is the useful
  part.

EXAMPLE 8, the domain in the title decides what the course is about.
  PART OF THE JOB: "Training and evaluating machine learning models"
  COURSE: Machine Learning for Biomolecular Applications. "machine learning
  methods applied to protein structure, sequence alignment, and molecular
  property prediction."
  ANSWER: helps false.
  WHY: the posting is a software company, not a lab. Someone finishing this
  course can predict molecular properties, and the worked examples, the data and
  the assumptions are all biology. A domain word in the title, biomedical,
  biomolecular, clinical, genomic, civil, environmental, is enough on its own
  unless the description says the material is general.

EXAMPLE 9, the same part of the job, answered properly.
  PART OF THE JOB: "Training and evaluating machine learning models"
  COURSE: Machine Learning. "supervised and unsupervised learning, model
  selection, generalisation and evaluation of learned models."
  ANSWER: helps true, strength central.
  WHY: no domain in the title and the description is the general method, which
  is what this part of the job asks for. This is the course the posting means,
  and it is exactly why the biomedical one beside it is not. Note the contrast
  with EXAMPLE 5: the same course is false for "applying AI-assisted development
  practices", because that part is about USING a tool and this one is about
  building the models.`;

const SCHEMA = {
  name: "course_fit",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      fits: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            course: { type: "string" },
            helps: { type: "boolean" },
            strength: { type: "string", enum: ["central", "useful", "tangential"] },
            aspects: { type: "array", items: { type: "string" } },
            why: { type: "string" },
            courseQuote: { type: "string" },
            jobQuote: { type: "string" },
          },
          required: ["course", "helps", "strength", "aspects", "why", "courseQuote", "jobQuote"],
        },
      },
    },
    required: ["fits"],
  },
} as const;

/**
 * Courses per call, and how many calls run at once.
 *
 * The first version put the entire posting in front of six courses at a time
 * and ran six calls concurrently: twenty six sequential waves, and a hundred
 * and sixty seconds of a student watching a spinner. Two things fix that
 * without touching quality.
 *
 * The batch is wider, because what dilutes a judgement is the number of
 * QUESTIONS in a call, and here there is one question per course rather than
 * one per (course, keyword) pair. Eight courses is eight questions.
 *
 * And far more of them run at once. These calls are independent, small, and
 * spend nearly all their time waiting on the network, so the wall clock is
 * decided by how many are in flight rather than by how much work there is.
 */
// Twelve full course descriptions plus the brief is a large request, and a
// large request is a slow one that times out under load: a run left thirty of a
// hundred and thirty nine courses unread, which the page then reports as "no
// course in this catalog does this". Eight is small enough to come back.
const PER_CALL = 8;
/**
 * Twenty at once was refused outright: every call came back "Error while
 * requesting resource", all three retries burned, and the endpoint reported
 * zero helpful courses having spent nothing. Eight is what the provider
 * actually accepts, and since the wall clock here is round trips rather than
 * work, that is the number that matters.
 */
const CONCURRENCY = 8;

// ─────────────────────────────────────────────────────────────────────────────
// Two passes, because one was too slow to sit through.
//
// Reading all 151 descriptions in full, with quotes from both sides, took over
// two minutes. Most of that work is wasted: for any given job, four courses in
// five have nothing to do with it, and proving that carefully costs exactly as
// much as proving the ones that do.
//
// So there is a cheap pass first. It still shows the model every course, but
// asks only "could this plausibly help", answered with a code and nothing else,
// twenty five courses at a time. It is told to err towards yes, because the
// only thing that matters here is not losing a good course. Then the careful
// pass, with the full descriptions and the quotes, runs on the survivors.
//
// This is not a keyword filter. Both passes are the model reading the course
// against this job. The first one just does not have to write its reasoning
// down, and that is where the two minutes went.
// ─────────────────────────────────────────────────────────────────────────────

const TRIAGE_SYSTEM = `You are doing a first pass over a university catalog for one specific job.

For each course you are shown, decide whether it could plausibly help someone do
that job. You are not writing reasons and you are not being asked to be sure.

Say yes when there is a real chance this course is relevant to the work
described. Say no when it clearly is not: a course on a different subject
entirely, on an unrelated profession, or with no connection to anything the job
involves.

Err towards yes when you hesitate, but hesitating is not the same as being
generous. Being in the same broad field is not a reason to keep a course. For a
backend engineering job, keep the systems, networks, databases and software
engineering courses, and drop the ones about a different specialism even though
they are also computer science.

Out of any twenty five courses, expect to keep around five. If you are keeping
more than half, you are describing the department rather than the job.

A careful second pass reads everything you keep, in full, and throws out what
does not hold up. It cannot rescue what you drop, so drop only what you would
be comfortable never mentioning to this student.

Return only the codes of the courses you are keeping.`;

const TRIAGE_SCHEMA = {
  name: "triage",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { keep: { type: "array", items: { type: "string" } } },
    required: ["keep"],
  },
} as const;

/** Courses per triage call. Bigger, because the answer is one code each. */
const TRIAGE_PER_CALL = 20;
/**
 * Triage reads the whole description.
 *
 * It used to see the first 320 characters, which is less than half of what 42
 * of every 100 Columbia courses actually say: the median description is 296
 * characters and the longest is 1,149. The page then told students "no course
 * in this catalog names it in its description", which is a claim about 139 full
 * descriptions that the run had never established. It had read 22 of them.
 *
 * All 139 descriptions together are 46,000 characters, about 12,000 tokens,
 * spread over six calls. The truncation was never buying anything worth the
 * cost of not being able to make that sentence honestly.
 */
const TRIAGE_CHARS = 4000;

// ─────────────────────────────────────────────────────────────────────────────
// The refutation pass, restored.
//
// The old keyword endpoint had one and it threw out more than half of what the
// finder proposed. When direct matching replaced it, this went with it, and the
// only thing left checking a claim was whether its two quotes existed. Quotes
// existing is not the same as quotes supporting: Computer Vision I was matched
// to "Testing and optimizing governance approaches" on a real sentence about
// object recognition with convolutional neural networks, for a posting about
// content governance and data analysis.
//
// So finding and judging are separate again. The finder may be generous. This
// is shown one claim at a time, with both quotes, and asked to break it.
// ─────────────────────────────────────────────────────────────────────────────

const REFUTE_SYSTEM = `You are checking claims that a university course helps someone do a specific job, and your job is to knock down the ones that do not hold up.

Each claim gives you: the PART OF THE JOB, the sentence from the posting that
defines it, the COURSE, and the sentence from the course description offered as
proof.

Return keep: true or false for each. False is the default whenever you hesitate.

Return FALSE if any of these apply:
- The course sentence is about a different activity than the job sentence. A
  description of object recognition with convolutional neural networks does not
  support "testing and optimizing governance approaches". Both are real
  sentences; only one of them is about the work.
- The connection runs through a shared word rather than shared work. "Risk" in
  risk mitigation is not "risk" in a probability course. "Model" in data
  modelling is not "model" in machine learning models.
- The course teaches a technique the job's field happens to use, rather than the
  job's actual work. Ask what the person does all day and whether this course
  prepares them for THAT.
- The proof is a topic list fragment, or a hedged sentence like "topics may
  include", or evidence that the course USES something rather than teaches it.
- The course is about another domain borrowing the method: biomedical, civil,
  environmental or genomic versions of a technique are not that technique.

Return TRUE only when someone sceptical, looking for a reason to say no, could
not find one. Judge each claim on its own two sentences and nothing else.

TWO TESTS. Run both on every claim before you answer. A claim has to pass both,
because one alone lets through most of what gets through.

  1. THE SAME SENSE. Name, to yourself, what the shared term refers to in the
     job sentence and what it refers to in the course sentence. If those are two
     different things, keep is false however well the two sentences read side by
     side. This is not a rare trick. Twenty claims in a recent sweep of ten
     postings turned on one word carrying two meanings.
  2. WOULD A PRACTITIONER CALL THIS TRAINING. Picture someone who already does
     the job in the posting, and does it well, reading the course sentence. Do
     they say "yes, that is where you learn that part of my job", or do they say
     "that is a different profession"? A content policy manager does not learn
     their job from convolutional neural networks. A backend engineer does not
     learn theirs from protein structure prediction.

A claim can pass one and fail the other. The right sense in the wrong profession
is still false, and the right profession in the wrong sense is still false.

WORKED EXAMPLES, all taken from real failures of this system.

  PART: "Handling difficult customer environments"
  PROOF: "Agents interacting with environments, Markov decision processes"
  keep: false. The shared word is "environment" and it means a simulator in one
  and a room full of people in the other.

  PART: "Testing and optimizing governance approaches"
  PROOF: "object recognition with convolutional neural networks"
  keep: false. A real sentence about a real course, about entirely other work.

  PART: "Analyzing policy performance with data"
  PROOF: "the identification problem and the do-calculus, counterfactual analysis"
  keep: true. Causal inference is exactly how you tell whether a policy change
  caused the outcome. The sentence carries the claim.

  PART: "Building scalable backend services"
  PROOF: "virtualisation, containers and Kubernetes, microservices, serverless
  computing, infrastructure as code, and operating services at scale"
  keep: true. Named outright, not implied.

  PART: "Managing a kitchen team"
  PROOF: "process scheduling, thread management, and synchronisation"
  keep: false. Scheduling people is not scheduling processes.

  PART: "Working in fast paced customer environments"
  PROOF: "training agents in simulated environments with reward shaping"
  keep: false. Fails both tests at once. "Environment" is a simulator here and a
  workplace there, and nobody in customer success would call reward shaping
  training for their job.

  PART: "Reviewing flagged content against written policy"
  PROOF: "image classification, segmentation, and object detection"
  keep: false. The course builds the detector. The job reads the queue and
  writes the rule. This posting is not a technical posting, and a technical
  course that touches the same subject matter is not training for it.

  PART: "Training and evaluating machine learning models"
  PROOF: "machine learning methods applied to protein structure and molecular
  property prediction"
  keep: false. The method is shared, the domain is not, and the posting is a
  software company. A domain word in the proof, biomedical, biomolecular,
  clinical, genomic, civil or environmental, settles this on its own.

  PART: "Training and evaluating machine learning models"
  PROOF: "supervised and unsupervised learning, model selection, generalisation
  and evaluation of learned models"
  keep: true. Same work, no borrowed domain, and this is what the posting means
  by the words it used.

  PART: "Making the site faster under real traffic"
  PROOF: "performance measurement, caching, load balancing, and the design of
  high throughput web services"
  keep: true. "Traffic" means requests on both sides, and a backend engineer
  would call this training for that part of their job. Both tests pass, so the
  default to no does not apply.`;

const REFUTE_SCHEMA = {
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
          properties: { n: { type: "integer" }, keep: { type: "boolean" } },
          required: ["n", "keep"],
        },
      },
    },
    required: ["verdicts"],
  },
} as const;

/** Claims per refutation call. The answer is one word each, so these can be wide. */
const REFUTE_PER_CALL = 12;

/** Exact match, then again ignoring the punctuation a pasted posting is full of. */
function quoted(haystack: string, needle: string): boolean {
  if (!needle || needle.length < 10) return false;
  if (haystack.includes(needle)) return true;
  const flat = (s: string) =>
    s.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"')
      .replace(/[ ​⁠]/g, " ").replace(/[‐-―]/g, "-")
      .replace(/\s+/g, "").toLowerCase();
  return flat(haystack).includes(flat(needle));
}

/**
 * Aspects are written freely by the model, so "keeping services up under load"
 * and "Keeping services up under load." are the same thing spelled differently.
 * Folded to a key so the solver can treat them as one.
 */
function aspectKey(a: string): string {
  return a.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export interface CourseFit {
  courseId: string;
  code: string;
  title: string;
  strength: "central" | "useful" | "tangential";
  /** Every part of the job this course speaks to. */
  aspects: string[];
  why: string;
  courseQuote: string;
  jobQuote: string;
}

export async function POST(req: Request) {
  let jd = "";
  let schoolId = "";
  let courseIds: string[] = [];
  let stream = false;
  let facets: { name: string; quote: string; weight: string }[] = [];
  let deepCap = 0;
  try {
    ({ jd, schoolId, courseIds, stream = false, facets = [], deepCap = 0 } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Send `jd`, `schoolId` and `courseIds`." }, { status: 400 });
  }

  const school = getSchool(schoolId);
  if (!school) return NextResponse.json({ ok: false, error: "Unknown school." }, { status: 400 });

  jd = (jd ?? "").trim().slice(0, 14000);
  if (jd.length < 60) {
    return NextResponse.json({ ok: false, error: "Paste the whole posting." }, { status: 400 });
  }

  const catalog = new Map(school.courses.map((c) => [c.id, c]));
  const targets = (courseIds ?? [])
    .map((id) => catalog.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c) && (c?.description.length ?? 0) > 60)
    .slice(0, 400);
  if (!targets.length) {
    return NextResponse.json({ ok: false, error: "No courses with descriptions to read." }, { status: 400 });
  }

  const { key: activeKey } = await getActiveKey();
  if (!activeKey) return NextResponse.json({ ok: false, error: "No API key connected." }, { status: 400 });
  // Captured so the narrowing survives into the async closures below.
  const key: string = activeKey;

  // The model echoes the course header back, and not always in the shape it was
  // given: "COMS W4111", "COMS W4111: Introduction to Databases", "COMSW4111".
  // Matching on the exact string threw away every judgement in a batch and the
  // endpoint reported zero helpful courses with no explanation, which took a
  // while to spot because "nothing matched" is a plausible answer.
  const codeKey = (s: string) => s.split(":")[0].replace(/\s+/g, "").toUpperCase().trim();
  // The parts of the job, worked out once from the posting. Courses choose from
  // this list rather than writing their own label, because free text produced
  // forty three variations of six ideas and nothing could be grouped.
  const facetBlock = facets
    .map((f, i) => `${i + 1}. ${f.name}\n   the posting: "${f.quote}"`)
    .join("\n");
  const facetByKey = new Map(facets.map((f) => [aspectKey(f.name), f.name]));

  // What every call carries.
  //
  // The posting was being resent in full nineteen times, and most of a posting
  // is company boilerplate, benefits and application instructions that say
  // nothing about the work. The parts of the job were already extracted from it
  // and each one carries the sentence it came from, so the brief is the posting
  // reduced to exactly the bits a course has to be judged against, with the
  // opening paragraphs kept for context. Fewer tokens per call, and less for
  // the model to wade through before it gets to the question.
  const brief = facetBlock
    ? `THE JOB\n${jd.slice(0, 1200)}\n\nPARTS OF THE JOB, each with the line of the posting it came from\n${facetBlock}`
    : `JOB POSTING\n${jd}`;

  const byCode = new Map<string, (typeof targets)[number]>();
  for (const c of targets) {
    byCode.set(codeKey(c.code), c);
    byCode.set(c.title.toLowerCase().trim(), c);
  }


  type Progress = { read: number; total: number; found: CourseFit[]; phase: "triage" | "reading" };

  async function run(onProgress?: (p: Progress) => void) {
    // ── pass one: which of these could plausibly matter ──────────────────
    const triageBatches: (typeof targets)[] = [];
    for (let i = 0; i < targets.length; i += TRIAGE_PER_CALL) {
      triageBatches.push(targets.slice(i, i + TRIAGE_PER_CALL));
    }
    let triaged = 0;
    /**
     * Held per batch and stitched together afterwards, rather than appended to
     * one array as the calls land.
     *
     * Appending from inside Promise.all put the shortlist in network completion
     * order, which is different every run. The same posting kept the same 22
     * courses twice and returned 5 helpful courses on one run and 8 on the
     * next, because those 22 were sliced into different groups of PER_CALL and
     * a course judged alongside different neighbours comes back differently.
     * Nothing above this line is random, so nothing below it should be either.
     *
     * The cost is summed the same way for the same reason: floating point
     * addition is not associative, so accumulating it in completion order made
     * the reported figure wobble in its last digits.
     */
    const triageOut: { kept: typeof targets; cost: number }[] =
      triageBatches.map(() => ({ kept: [], cost: 0 }));

    await Promise.all(triageBatches.map(async (batch, bi) => {
      const listing = batch
        .map((c) => `${c.code} | ${c.title} | ${c.description.slice(0, TRIAGE_CHARS)}`)
        .join("\n");
      try {
        const { content, costUsd } = await haiku<{ keep: string[] }>({
          key,
          purpose: `triage ${batch.length} courses`,
          system: TRIAGE_SYSTEM,
          user: `${brief}\n\nCOURSES\n${listing}`,
          schema: TRIAGE_SCHEMA as never,
          maxTokens: 600,
          // Stated here rather than left to the default in lib/ai/haiku.ts,
          // because this endpoint is expected to answer the same question the
          // same way twice and that should not depend on another file.
          temperature: 0,
        });
        const keep = new Set((content.keep ?? []).map((k) => codeKey(String(k))));
        triageOut[bi] = { kept: batch.filter((c) => keep.has(codeKey(c.code))), cost: costUsd };
      } catch {
        // A triage call that fails must not silently delete a quarter of the
        // catalog, so its whole batch goes through to the careful pass.
        triageOut[bi] = { kept: [...batch], cost: 0 };
      }
      triaged += batch.length;
      onProgress?.({ read: triaged, total: targets.length, found: [], phase: "triage" });
    }));

    // Catalog order, because triageBatches are consecutive slices of targets.
    const shortlist = triageOut.flatMap((t) => t.kept);
    const triageCost = triageOut.reduce((sum, t) => sum + t.cost, 0);

    // Nothing survived, which is a real answer for a job a CS catalog cannot
    // serve, but read everything rather than trust it if it looks like a fault.
    //
    // The cap is a backstop on wall clock, not on quality: if triage keeps most
    // of the catalog it has misunderstood the job, and reading a hundred
    // borderline courses in full would cost two minutes to arrive at the same
    // answer. It is reported, because a truncation nobody mentions is a lie.
    // Callers asking about a single subject can cap this far lower: the first
    // pass has already ruled out everything unrelated, and reading fourteen
    // descriptions in full answers "which courses teach cryptography" as well
    // as reading seventy does, in a fifth of the time.
    const DEEP_CAP = deepCap > 0 ? deepCap : 72;
    const survived = shortlist.length ? shortlist : targets;
    // Whatever falls off the cap is now the tail of the catalog rather than
    // whichever triage call happened to answer last, so two identical requests
    // read the same courses in full. It is still an arbitrary place to cut, and
    // notFullyRead below is what says so.
    const deep = survived.slice(0, DEEP_CAP);
    const notRead = survived.length - deep.length;

    const fits: CourseFit[] = [];
    let costUsd = 0;
    let unread = 0;
    let read = 0;
    let dropped = 0;
    const batches: (typeof targets)[] = [];
    for (let i = 0; i < deep.length; i += PER_CALL) batches.push(deep.slice(i, i + PER_CALL));
    const allMisses: { code: string; side: string; quote: string }[] = [];

    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const wave = batches.slice(i, i + CONCURRENCY);
      const results = await Promise.all(wave.map(async (batch) => {
        const courseText = batch
          .map((c) => `### ${c.code}: ${c.title} (${c.credits} credits)\n${c.description}`)
          .join("\n\n");

        // Four attempts, backing off further each time. A batch that never
        // lands is not a batch of courses that teach nothing, it is a hole in
        // the answer, and the page has no way to tell the difference.
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const { content, costUsd: cost } = await haiku<{
              fits: {
                course: string; helps: boolean; strength: string; aspects: string[];
                why: string; courseQuote: string; jobQuote: string;
              }[];
            }>({
              key,
              purpose: `fit: ${batch.length} courses`,
              system: SYSTEM,
              user: `${brief}\n\nCOURSES\n${courseText}`,
              schema: SCHEMA as never,
              maxTokens: 1800,
              temperature: 0,
            });

            const kept: CourseFit[] = [];
            const misses: { code: string; side: string; quote: string }[] = [];
            let bad = 0;
            for (const f of content.fits ?? []) {
              if (!f.helps) continue;
              const raw = String(f.course ?? "").trim();
              const c = byCode.get(codeKey(raw)) ?? byCode.get(raw.toLowerCase());
              if (!c) {
                bad++;
                misses.push({ code: raw.slice(0, 60), side: "unknown course", quote: "" });
                continue;
              }
              const cq = String(f.courseQuote ?? "").trim();
              const jq = String(f.jobQuote ?? "").trim();
              // Neither side gets to be asserted. Both have to be shown.
              const okCourse = quoted(c.description, cq);
              const okJob = quoted(jd, jq);
              if (!okCourse || !okJob) {
                bad++;
                misses.push({ code: c.code, side: !okCourse ? "course" : "job", quote: (!okCourse ? cq : jq).slice(0, 120) });
                continue;
              }
              const strength = (["central", "useful", "tangential"].includes(f.strength)
                ? f.strength : "useful") as CourseFit["strength"];
              // Snap each aspect back onto the canonical facet. Anything that is
              // not one of them answered a part of the job nobody asked about.
              const named = (Array.isArray(f.aspects) ? f.aspects : [f.aspects])
                .map((a) => String(a ?? "").trim())
                .map((a) => facetByKey.get(aspectKey(a)) ?? (facets.length ? "" : a.slice(0, 80)))
                .filter(Boolean);
              const aspects = [...new Set(named)];
              if (!aspects.length) { bad++; misses.push({ code: c.code, side: "no aspect matched the job's parts", quote: String(f.aspects).slice(0, 80) }); continue; }
              kept.push({
                courseId: c.id, code: c.code, title: c.title,
                strength, aspects,
                why: String(f.why ?? "").trim().slice(0, 220),
                courseQuote: cq, jobQuote: jq,
              });
            }
            // Reported here, as this batch lands. Reporting after the whole
            // wave meant a wide wave was one silent block: the counter sat at
            // zero for the entire read and then jumped to the end.
            read += batch.length;
            onProgress?.({ read, total: deep.length, found: kept, phase: "reading" });
            return { kept, cost, unread: 0, n: 0, bad, misses };
          } catch {
            if (attempt < 3) await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
          }
        }
        read += batch.length;
        onProgress?.({ read, total: deep.length, found: [], phase: "reading" });
        return { kept: [] as CourseFit[], cost: 0, unread: batch.length, n: 0, bad: 0, misses: [] as { code: string; side: string; quote: string }[] };
      }));

      for (const r of results) {
        costUsd += r.cost;
        unread += r.unread;
        dropped += r.bad;
        allMisses.push(...r.misses);
        fits.push(...r.kept);
      }
    }

    // ── second pass: try to break every claim the first pass made ────────
    const claims: { fitIdx: number; aspect: string; fit: CourseFit }[] = [];
    fits.forEach((f, i) => {
      for (const a of f.aspects) claims.push({ fitIdx: i, aspect: a, fit: f });
    });

    const rejected = new Set<string>();
    let refuteCalls = 0;
    for (let i = 0; i < claims.length; i += REFUTE_PER_CALL * CONCURRENCY) {
      const wave: (typeof claims)[] = [];
      for (let j = i; j < Math.min(claims.length, i + REFUTE_PER_CALL * CONCURRENCY); j += REFUTE_PER_CALL) {
        wave.push(claims.slice(j, j + REFUTE_PER_CALL));
      }
      const out = await Promise.all(wave.map(async (group) => {
        const listing = group.map((c, n) => {
          const facetQuote = facets.find((f) => aspectKey(f.name) === aspectKey(c.aspect))?.quote ?? "";
          return `${n + 1}. PART OF THE JOB: ${c.aspect}`
            + (facetQuote ? `\n   THE POSTING SAID: "${facetQuote}"` : "")
            + `\n   COURSE: ${c.fit.title}`
            + `\n   OFFERED AS PROOF: "${c.fit.courseQuote}"`;
        }).join("\n\n");
        try {
          const { content, costUsd: cost } = await haiku<{ verdicts: { n: number; keep: boolean }[] }>({
            key,
            purpose: `refute ${group.length} course claims`,
            system: REFUTE_SYSTEM,
            user: listing,
            schema: REFUTE_SCHEMA as never,
            maxTokens: 700,
            temperature: 0,
          });
          return { group, verdicts: content.verdicts ?? [], cost };
        } catch {
          // A verifier that fell over must not silently approve everything.
          return { group, verdicts: [], cost: 0 };
        }
      }));
      for (const r of out) {
        refuteCalls++;
        costUsd += r.cost;
        const said = new Map(r.verdicts.map((v) => [v.n, v.keep]));
        r.group.forEach((c, n) => {
          if (said.get(n + 1) === false) rejected.add(`${c.fitIdx}::${aspectKey(c.aspect)}`);
        });
      }
    }

    const claimsRefuted = rejected.size;
    const survivors: CourseFit[] = [];
    fits.forEach((f, i) => {
      const kept = f.aspects.filter((a) => !rejected.has(`${i}::${aspectKey(a)}`));
      if (kept.length) survivors.push({ ...f, aspects: kept });
    });
    fits.length = 0;
    fits.push(...survivors);

    // Fold the freely written aspects together so the solver can see which
    // courses are alternatives for the same part of the job.
    const aspects = new Map<string, { label: string; courses: string[] }>();
    for (const f of fits) {
      for (const a of f.aspects) {
        const k = aspectKey(a);
        if (!k) continue;
        const entry = aspects.get(k) ?? { label: a, courses: [] };
        entry.courses.push(f.courseId);
        aspects.set(k, entry);
      }
    }

    return {
      ok: true as const,
      fits,
      // Rarest part of the job first, then by name. The tiebreak is there so
      // this order does not depend on which course happened to mention a part
      // first, which is one more thing that could differ between two identical
      // requests.
      aspects: [...aspects.entries()].map(([k, v]) => ({
        key: k, label: v.label, courses: v.courses,
      // Compared with < rather than localeCompare, which sorts differently
      // depending on the machine's locale.
      })).sort((a, b) => a.courses.length - b.courses.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      coursesRead: targets.length - unread,
      /** How many survived the first pass and were read in full. */
      shortlisted: deep.length,
      /**
       * Ruled out on a first read of the full description, before the careful
       * pass with quotes. Every course was read; only the survivors were read
       * a second time and asked to prove themselves.
       */
      ruledOutEarly: targets.length - survived.length,
      /** Survived the first pass but fell outside the cap. */
      notFullyRead: notRead,
      coursesUnread: unread,
      /** Judgements thrown out because a quote could not be found on one side. */
      unquotable: dropped,
      /** A sample of what failed verification, so a zero result is never a mystery. */
      unquotableSample: allMisses.slice(0, 8),
      calls: batches.length,
      refuteCalls,
      claimsMade: claims.length,
      claimsRefuted,
      costUsd: costUsd + triageCost,
    };
  }

  if (!stream) {
    try {
      return NextResponse.json(await run());
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
        const result = await run((p) => send({ type: "progress", ...p }));
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
