# BUILD SPEC — Degree Planner (working name: **Slack**, as in *slack in a schedule*)

> Read this whole file before writing code. The constraints in §3 and §5 are not
> negotiable — they are what makes this project credible rather than a demo of a
> language model guessing at course lists.

---

## 1. The thesis

A bachelor's degree contains roughly 30–45 credits of genuine freedom. Nobody
has ever helped a student spend them on purpose.

This app takes a job description, a student's completed coursework, and a
university's real catalog — and returns a *provably optimal* term-by-term plan
that satisfies every degree requirement, every prerequisite, and every credit
rule, while maximising coverage of the skills that job actually asks for.

**The AI never picks a course.** The AI reads unstructured text and turns it
into structured constraints. A constraint solver picks the courses. That
separation is the entire credibility of the product and must be visible in the
interface.

---

## 2. What it is being judged on

Five criteria, weighted equally. Every decision below traces to one of them.
When trading off, protect the criterion that is weakest, not the one that is
most fun to build.

| # | Criterion | How this build wins it |
|---|-----------|------------------------|
| 1 | Solves a real student problem | One persona, one scenario, end to end. See §12. |
| 2 | Originality | Constraint propagation you can *see*. K-best alternatives. Counterfactuals. |
| 3 | Scale potential | Two universities behind a switcher. Adapter architecture. §4. |
| 4 | Design & experience | §9 and §10. This is where a solo builder can outright win. |
| 5 | How well it's built | Fewer features, zero broken states. §13 cut list. |

---

## 3. Architecture

### 3.1 The split (do this on day 1, not day 12)

CP-SAT is Python. There is no adequate equivalent in JavaScript. Therefore:

```
┌─────────────────────────────┐        ┌──────────────────────────┐
│  Next.js 15 (App Router)    │  HTTP  │  FastAPI + OR-Tools      │
│  Vercel                     │ ─────► │  Railway / Render / Fly  │
│  UI, AI calls, state        │ ◄───── │  POST /solve             │
└─────────────────────────────┘        └──────────────────────────┘
             │
             ▼
    ┌────────────────────┐
    │ Postgres (Supabase)│  pre-scraped catalog, seeded before demo
    └────────────────────┘
```

**Deploy an empty `/solve` endpoint that returns a hardcoded plan on day 1.**
Confirm the frontend can reach it in production. Deployment surprises kill
this project; find them immediately.

Do **not** attempt to run Python inside Next API routes on Vercel. Do not
attempt to reimplement CP-SAT in JS.

### 3.2 Repo layout

```
/apps/web          Next.js 15, TypeScript, Tailwind, shadcn/ui
/services/solver   FastAPI, ortools, pydantic
/packages/schema   Shared JSON schema (zod ↔ pydantic), single source of truth
/ingest            One-off scrapers + LLM parsers. Never runs at request time.
/data              Committed JSON snapshots. The demo runs off these.
```

### 3.3 Non-negotiable rule

**Nothing scrapes at request time. Nothing calls an LLM to make a scheduling
decision.** The catalog is pre-parsed, human-reviewed, and committed. If the
network dies mid-demo, the solver still works.

---

## 4. Data model

The canonical model is university-agnostic. Per-university code exists **only**
in the adapter layer. This is what makes the scale claim honest.

```ts
type Course = {
  id: string;                 // "COLUMBIA:COMS4995"
  code: string;               // "COMS 4995"
  title: string;
  credits: number;
  description: string;
  prereq: PrereqNode | null;  // parsed boolean tree, see §6
  coreq: string[];
  termsOffered: Term[];       // ["FA","SP"] — from historical schedule data
  level: "UG" | "GR";
  restrictions: string[];     // free text, surfaced as warnings, never enforced silently
  verified: boolean;          // false = human hasn't reviewed the parse
  sourceUrl: string;          // every fact is clickable back to the catalog
};

type PrereqNode =
  | { op: "AND" | "OR"; children: PrereqNode[] }
  | { op: "COURSE"; courseId: string }
  | { op: "UNVERIFIABLE"; text: string };   // "instructor permission" etc.

type Source = {
  url: string;                // the exact page, not the catalog homepage
  quote: string;              // verbatim sentence stating this rule
  retrievedAt: string;        // ISO date — catalogs change
  snapshotPath: string;       // committed raw HTML/PDF in /data/snapshots
};

type RequirementBucket = {
  id: string;                 // "COLUMBIA:CS_BS:TECH_ELECTIVE"
  label: string;              // "Technical elective"
  needCredits?: number;
  needCourses?: number;
  eligible: string[];         // course ids, or a predicate
  allowDoubleCount: string[]; // bucket ids this may also satisfy
  source: Source;             // REQUIRED — hand-encoded, so must be cited
};

type Program = {
  id: string;
  name: string;
  level: "UG" | "GR";
  totalCredits: number;
  maxCreditsPerTerm: number;
  minCreditsPerTerm: number;
  buckets: RequirementBucket[];
  sources: Source[];          // bulletin page, credit-limit policy page, etc.
};

type StudentState = {
  completed: string[];        // course ids
  program: string;
  startTerm: Term;
  horizonTerms: number;       // default 4
  locked: { courseId: string; term: number }[];
  excluded: string[];
};
```

### 4.1 The `UNVERIFIABLE` node is a feature, not a gap

Real prerequisites include "or equivalent", "instructor permission", "open to
majors only", placement tests, and class-standing rules. A parser that renders
these as a confident green check is lying.

Render them as a distinct third state — **amber, "check with your advisor"** —
never as satisfied and never as blocked. A registrar watching your video will
notice this and it will be the single strongest signal that you understand
their world.

---

## 5. Where AI is allowed to run

This boundary is the product. Enforce it in code, and state it on screen.

### Allowed — offline, in `/ingest`, reviewed by a human

1. **Prerequisite parsing.** Catalog prose → `PrereqNode` tree. One call per
   course. Output committed to `/data`. Spot-check 50 by hand, fix errors
   manually, mark `verified: true`.
2. **Skill extraction from course descriptions.** Produce `{skill, evidence}`
   where `evidence` is the *verbatim sentence* from the description. If there
   is no sentence, there is no skill. No inference.

### Allowed — live, at request time

3. **Job description → skill list.** Unstructured input, so it has to be live.
   Output is a flat list of skill strings. Nothing else.
4. **Chat → constraint translation.** "I don't want 8am classes" becomes
   `{exclude: [...]}`. The model emits a constraint patch as JSON; the solver
   re-runs; the UI renders the solver's answer. The model never states a result.
5. **Explanation rendering.** Given the solver's own trace, write it as English.
   Input is solver output only. If a fact isn't in the trace, it can't be said.

### Forbidden — hard rule

- Choosing which courses go in the plan.
- Deciding whether a prerequisite is met.
- Deciding whether a requirement is satisfied.
- Inventing a course, a code, a skill, or a number.

Implement #5 with a system prompt that receives the solver JSON and is
instructed to refuse anything not present in it. Implement #4 as **structured
output only** — the model returns a constraint patch, never prose that the UI
trusts.

**Put this on screen.** A small permanent label in the header:

> `Courses chosen by constraint solver · AI reads text, never decides`

That line is worth more to your originality score than any feature.

---

## 6. Ingestion pipeline (`/ingest`)

Run once. Commit the output. Never runs in production.

1. **Scrape** course catalog + historical schedule of classes (5 years) for term
   availability. Store raw HTML alongside parsed output.
2. **Parse prereqs** with the prompt in §6.1.
3. **Extract skills** with evidence sentences.
4. **Encode requirement buckets by hand.** Do not LLM this. Degree requirements
   are few, high-stakes, and structured; a human encodes them correctly in an
   afternoon. This is the most-likely-to-be-wrong thing in the system and it
   deserves manual care.
5. **Review pass.** Flip `verified` to true only on human check.

### 6.0 Provenance rule — nothing enters the model without a citation

Every rule the solver enforces must carry a `Source` with a URL, a verbatim
quote, a retrieval date, and a committed local snapshot of the page. Snapshots
matter because catalogs get edited — if a page changes between build and
judging, your citation still resolves.

Build a validator that fails the ingest if any bucket, credit cap, or
prerequisite lacks a resolvable source. Run it in CI. A rule with no citation
is a bug, not a shortcut.

Maintain `/data/SOURCES.md` — a flat table of every page used, per school,
generated from the data rather than written by hand:

| School | Rule | Source | Retrieved |
|---|---|---|---|
| Columbia | CS BS technical electives (4 courses) | bulletin.columbia.edu/… | 2026-08-08 |
| Columbia | Max 21 credits per term | registrar page URL | 2026-08-08 |

This file is a submission asset, not just documentation. It is the cheapest
possible proof that you read real catalogs instead of asking a model what a CS
degree contains — and that distinction is the whole argument of the project.

### 6.1 Prereq parsing prompt

```
You convert university prerequisite text into a JSON tree. You do not
interpret, infer, or fill gaps.

Grammar:
  {"op":"AND","children":[...]}
  {"op":"OR","children":[...]}
  {"op":"COURSE","courseId":"<CODE>"}
  {"op":"UNVERIFIABLE","text":"<verbatim phrase>"}

Rules:
- Semicolons usually separate AND groups. "or" within a group is OR.
- Any condition that is not a specific course — instructor permission,
  class standing, "or equivalent", placement, major restriction — becomes
  UNVERIFIABLE with the original wording preserved exactly.
- Never invent a course code. If a code is ambiguous, use UNVERIFIABLE.
- Output JSON only.

Text: {{prereq_text}}
```

### 6.2 Scope

**One university, deep and correct. Then a partial second adapter.**

Pick a structurally *different* second school — a public with a rigid core
curriculum, or a community college. It does not need to be complete. It needs
to prove the adapter boundary is real, and it needs to appear in the UI as a
switcher. Half a second school beats a whole first one for criterion #3.

---

## 7. The solver (`/services/solver`)

### 7.1 Model

Binary variable `x[c][t]` — take course `c` in term `t`.

**Constraints**

```
1. Each course at most once:        Σ_t x[c][t] ≤ 1
2. Term credit cap:                 Σ_c credits[c]·x[c][t] ≤ maxCredits   ∀t
3. Term credit floor (if enrolled):  ≥ minCredits when term is active
4. Prereqs:  x[c][t] ⟹ prereq tree of c satisfied by Σ_{t'<t} x[·][t'] ∪ completed
             (AND → conjunction of indicators; OR → sum ≥ 1;
              UNVERIFIABLE → treated as satisfied, but the course is flagged)
5. Availability: x[c][t] = 0 where t ∉ termsOffered[c]
6. Bucket satisfaction: Σ_{c ∈ bucket.eligible} x[c][·] ≥ bucket.need
7. Single-count: a course contributes to exactly one bucket unless
   allowDoubleCount permits otherwise (model with an assignment variable
   y[c][b], Σ_b y[c][b] ≤ 1, y[c][b] ≤ Σ_t x[c][t])
8. Locks: x[c][t] = 1 for every locked (c,t)
9. Exclusions: x[c][t] = 0 ∀t for excluded c
```

**Objective**

```
maximize   W_skill · (distinct skills covered)
         − W_credit · (credits beyond degree minimum)
         − W_term   · (terms used)
```

Start with `W_skill = 100`, `W_credit = 3`, `W_term = 40`. Expose these as
tuning constants, not UI.

### 7.2 K-best

Solve. Add a no-good cut forbidding that exact solution set. Solve again.
Repeat 3–5 times. Return all of them.

This is the direct answer to "greedy loses options" — you are not showing one
answer, you are showing the shape of the option space. Surface them as
**Plan A / Plan B / Plan C** with a one-line diff between each.

### 7.3 Counterfactuals

Pre-compute a small fixed set by relaxing one constraint and re-solving:

- allow one summer term
- raise the credit cap by 3
- allow one term beyond the horizon

Return each as `{change, deltaSkills, deltaCredits, deltaTerms}`. Render as:

> *Allow one summer course → covers 3 more skills, same graduation date.*

Nothing else in this competition will do this. It is the single most
originality-dense feature in the build. Do not cut it.

### 7.4 Performance & infeasibility

Set a 10s solver timeout. At this scale (few hundred courses × 6 terms) expect
sub-second solves.

**Infeasibility must never render as a blank screen.** If the model is
infeasible, relax the *soft* bucket constraints one at a time and report which
one broke it:

> *No plan exists in 4 terms. The Statistics requirement can't be reached —
> its prerequisite is offered in spring only, and you'd need it twice.*

That message is more impressive than a successful solve. Build it properly.

---

## 8. Screens

Three, and only three.

### 8.1 Setup

Single column. Four inputs, no wizard.

1. School (switcher — this is your scale story, make it prominent)
2. Program + level (UG/GR)
3. Completed courses — searchable multi-select over the real catalog, with a
   "paste a transcript" textarea as the fast path
4. Job description — big textarea, plus 2–3 preloaded real postings so a judge
   can hit go in one click

**Preloaded examples are mandatory.** A judge will not paste a JD. Give them a
button that fills everything and solves.

### 8.2 The Board (the main screen — see §9)

Term columns, courses as cards, requirement rail on the left, coverage and
explanation on the right.

### 8.3 Coverage detail

Three honest buckets. **No percentage anywhere.**

```
COVERED BY YOUR PLAN          7 skills
  PyTorch      ← COMS 4995 · "…implemented in PyTorch…"   [source ↗]
  Distributed  ← CSEE 4119 · "…distributed systems…"      [source ↗]

AVAILABLE IF YOU SWAP         2 skills
  Kubernetes   ← COMS 4995 would need to replace your free elective
                 Cost: 0 extra credits                    [apply swap]

COURSEWORK CANNOT GIVE YOU    2 skills
  "3 years production experience"
  "Shipped ML systems at scale"
  → No course teaches this. It needs a project, research, or internship.
```

That third bucket is the credibility of the entire product. It is the thing
that stops an academic in the room from dismissing this as "reduce your degree
to a job req." **Never cut it. Lead the video with it.**

---

## 9. The Board — interaction design

This screen is where criteria #2 and #4 are won or lost.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Slack        Columbia ▾   CS BS ▾        Solver chose · AI never decides │
├────────────┬────────────────────────────────────────────┬────────────────┤
│            │  FALL 26    SPRING 27   FALL 27   SPRING 28│                │
│ REQUIRE-   │  ┌───────┐  ┌───────┐   ┌───────┐  ┌──────┐│  COVERAGE      │
│ MENTS      │  │COMS   │  │CSEE   │   │COMS   │  │COMS  ││  ▓▓▓▓▓▓▓░░░    │
│            │  │3134 🔒│  │4119   │   │4995   │  │4771  ││  7 of 11       │
│ Core   4/6 │  │ 3 cr  │  │ 3 cr  │   │ 3 cr  │  │ 3 cr ││                │
│ ▓▓▓▓░░     │  └───────┘  └───────┘   └───────┘  └──────┘│  WHY THIS PLAN │
│            │  ┌───────┐  ┌───────┐   ┌───────┐  ┌──────┐│                │
│ Tech   2/4 │  │MATH   │  │STAT   │   │ ▾ pick│  │ELEC  ││  COMS 4995 is  │
│ ▓▓░░░░     │  │1201   │  │4001 ⚠ │   │ 1 of 4│  │      ││  in Fall 27    │
│            │  └───────┘  └───────┘   └───────┘  └──────┘│  because CSEE  │
│ Elect  1/3 │                                            │  4119 is its   │
│ ▓░░░░░     │  14 cr      15 cr       12 cr      15 cr   │  prereq and is │
│            │                                            │  spring-only.  │
│ ⚠ 1 needs  │  [Plan A]  Plan B   Plan C                 │                │
│   advisor  │                                            │  [Ask about    │
│   check    │  ─────────────────────────────────────────  │   this plan]   │
└────────────┴────────────────────────────────────────────┴────────────────┘
```

### 9.1 The signature moment — the reflow

When a course is locked, excluded, or a dropdown choice changes:

1. Affected cards **fade to 40% and lift 2px**
2. Solver runs
3. Cards **animate to new positions**, staggered by term (40ms apart,
   left to right), 260ms ease-out
4. Changed cards get a 600ms amber outline pulse
5. The requirement rail bars animate to new fill

This is the whole demo. It is constraint propagation made visible — the thing
that proves there is real machinery underneath rather than a language model
producing a list. **Build this before you build the chat.**

Respect `prefers-reduced-motion`: skip the transit, keep the outline pulse.

### 9.2 Lock

Click a card → padlock. Locked cards are pinned and visually heavier (amber
left border, 2px). Solver re-runs around them. This is the "I know something
the model doesn't" affordance and every advisor watching will immediately
understand it.

### 9.3 Slot dropdowns

Where a bucket has several equally-optimal fillers, render the card as a
**chooser**: `▾ pick 1 of 4`. Opening it shows the alternatives with their
skill deltas. Picking one locks it and triggers a reflow.

This is how you answer "the AI is guessing" in the interface itself — where
the system genuinely doesn't know, it *asks* instead of pretending.

### 9.4 Card states

| State | Treatment |
|---|---|
| Chosen | paper card, ink text |
| Locked | amber left border, padlock glyph |
| Needs advisor check (`UNVERIFIABLE`) | amber dotted underline on the code, ⚠ glyph, tooltip with verbatim catalog text |
| Skill-bearing | small teal dot per covered skill, hover → evidence sentence + source link |
| Costs extra credits | clay left border, "+3 cr" tag |
| Ghost (in an alternative plan, not this one) | 30% opacity outline |

### 9.4b Requirement rail — citations on the rules themselves

Every bucket in the left rail is clickable. Opening one shows the rule as the
university states it, not as you paraphrased it:

```
TECHNICAL ELECTIVE            2 of 4

  "Four technical electives, at least two at the
   4000 level or above."
   — Columbia CS Bulletin, retrieved 8 Aug 2026   [open source ↗]

  Eligible here: 34 courses
  Double-counts with: none
```

Do the same for the credit cap and any degree-wide rule. When a judge wonders
whether you invented the requirements, this answers it in one click without
you having to say anything.

Add a **Sources** link in the footer listing every catalog page behind the
current school. Cheap to build, and it is the difference between "a student
made a nice UI" and "a student did the work."

### 9.5 Why panel

Always populated. Click any card and the right panel explains that card:

> **COMS 4995 · Fall 27**
> Placed here because CSEE 4119 is a prerequisite and is offered in spring only.
> Fills: Technical elective (1 of 4).
> Covers: PyTorch, model serving.
> Moving it earlier is infeasible.

Generated from the solver trace by the LLM (§5, allowed use #5). Never from
the model's own knowledge.

### 9.6 Chat

Bottom-right, collapsed by default. Constrained hard:

- It can answer questions about the current plan from the solver JSON
- It can propose a **constraint change**, which renders as a confirm chip:
  `Exclude all 8am sections? [Apply]` → applying re-runs the solver
- It cannot state a plan, a course choice, or a requirement status of its own

Every chat answer that references a course renders the course chip, so the
answer is anchored to real data.

**Build this last.** If you run out of time, ship without it. The board is the
product; the chat is a garnish.

---

## 10. Visual direction

The subject's own world is **academic scheduling artifacts** — the timetable,
the transcript, the audit sheet, the departure board. Design from that
vernacular, not from generic SaaS.

Deliberately avoid: cream backgrounds with a serif display and a terracotta
accent; near-black with one acid-green accent; hairline-ruled broadsheet
layouts. Those read as machine-generated in 2026.

### Tokens

```css
--ink:     #101A24;   /* board ground — deep cool slate, not black */
--paper:   #EDF0F3;   /* card surface — cool paper, never cream */
--slate:   #63707E;   /* secondary text, rules */
--amber:   #E0A340;   /* locked, needs-check, the reflow pulse */
--teal:    #23A088;   /* skill covered */
--clay:    #B0483C;   /* costs you extra credits/terms */
```

Dark board, paper cards. The plan reads as a departure board — which is
literally what it is.

### Type

- **Display / term headers** — `Archivo`, 700, tight tracking, uppercase.
  Signage, not editorial.
- **Body / UI** — `Inter`, 400/500.
- **Course codes, credits, all numerals** — `IBM Plex Mono`, 500.

Course codes are already monospace-native (`COMS 4995` is a serial number, not
a word). Setting them in mono is a decision derived from the subject rather
than a stylistic default. Let that carry the personality — everything else
stays quiet.

### Scale

`12 / 14 / 16 / 20 / 28 / 44`. Term headers at 20 uppercase with `0.08em`
tracking. Course codes at 16 mono. Descriptions at 14.

### Restraint

The reflow animation is the one bold thing. Everything else — spacing, rules,
card treatment — stays disciplined and quiet. No gradients, no glassmorphism,
no decorative icons. If a visual element doesn't encode information, delete it.

---

## 11. Copy

Write from the student's side of the screen. Name things by what the person
controls, never by how the system works.

- "Lock this course" — not "pin constraint"
- "No plan fits in 4 terms" — not "infeasible"
- "Check with your advisor" — not "unverifiable prerequisite node"
- "Covers 7 of 11 skills" — not "73% match"

Empty states are invitations: *"Paste a job posting to see which of your
remaining courses actually get you there."*

Errors say what happened and what to do. They never apologise and they are
never vague.

---

## 12. The demo scenario

Pick **one persona** and build the whole demo around them. Recommended:

> A junior CS major at Columbia with 62 credits done, targeting ML engineering
> roles, who has 5 terms of slack left and has been choosing electives at random.

Grad is supported by the model and should be reachable via the level switcher,
but the *narrative* is one student. A demo that tries to serve first-years,
juniors, and PhD students at once serves nobody in 120 seconds.

Preload this student. One click to a solved board.

---

## 13. Build order and cut list

Build strictly in this order. Everything below the line is expendable.

```
DAY 1     Empty /solve deployed to prod. Frontend reaches it. Prove the split.
DAY 2-4   Scrape school 1. Prereq parse. Human review. Encode buckets by hand.
DAY 5-6   Solver: constraints 1-9, single objective. Correct before pretty.
DAY 7-8   The Board. Cards, rail, reflow animation. This is the product.
DAY 9     K-best + counterfactuals.
DAY 10    Coverage screen with three buckets + evidence links.
DAY 11    Why panel. Infeasibility explanations.
DAY 12    Second school adapter (partial is fine). Switcher in header.
─────────────────────────────────────────────────────────────────────────
DAY 13    Chat.                                    ← cut first
DAY 14    Preferences / likes-dislikes.            ← cut second
DAY 15    Video, 500 words, buffer.                ← never cut
```

**Cut in this order if you slip: chat, then preferences, then K-best.** Never
cut: the reflow, the third coverage bucket, the advisor-check state, the second
school.

---

## 14. Quality floor

Non-negotiable, because criterion #5 is scored by a judge opening the link.

- Works on mobile — the board scrolls horizontally by term, rail collapses
- Visible keyboard focus on every interactive element
- `prefers-reduced-motion` respected
- No dead ends: every empty state has an action
- Every course fact **and every requirement rule** links to its catalog source
- `/data/SOURCES.md` is complete and the ingest validator passes
- Solver failure renders an explanation, never a spinner or a blank
- Preloaded example works with zero typing

---

## 15. Two things to do outside the code

1. **Talk to 10 students this week.** One sentence in the 500 words — *"I
   talked to N students; every one of them picked electives by asking a friend"*
   — is validation almost no other entrant will have.
2. **Say who you are.** You have shipped production computer vision to a
   national broadcaster. You are not a student with an idea; you are a founder
   who ships, starting at Columbia. That reframes the reader from "clever
   student" to "person who could build this for us."

---

## 16. The one-line pitch

> Your degree has 40 credits of freedom in it. A constraint solver spends them
> on the job you actually want — and shows you exactly what coursework can't
> give you.
