# Slack — a degree planner

> Your degree has 40 credits of freedom in it. A constraint solver spends them on
> the job you actually want — and shows you exactly what coursework can't give you.

A job description, a transcript and a real university catalog go in. A provably
optimal term-by-term plan comes out, satisfying every degree requirement, every
prerequisite and every credit rule, while covering as much of that job as
coursework can.

**The AI never picks a course.** It reads unstructured text and turns it into
structured input. A constraint solver picks the courses. That separation is the
entire credibility of the product, it is enforced in code, and it is stated on
screen.

---

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

Hit **Run the example** — a Columbia junior, 62 credits done, targeting ML
engineering. Zero typing to a solved board.

An OpenRouter key is optional. The solver runs entirely without one; only the
three text-reading steps need it. Add one in the bar at the top of any page, or
set `OPENROUTER_API_KEY` (see `.env.example`).

```bash
npm run verify         # provenance validator + 63 solver assertions
npm run build          # runs verify first, then next build
```

## Deploy

A single Next.js app. Push to Vercel; no second service, no Python runtime, no
cold start. Set `OPENROUTER_API_KEY` in project settings if you want a default
key — users can paste their own at runtime regardless.

---

## The money bar

Pinned to the top of every page: what the active key has spent, what it has
left, and what this app itself has cost this session, priced from OpenRouter's
own per-call `cost` rather than a token estimate.

The key is **replaceable at runtime**. Paste a new one and it is validated
against OpenRouter before it is stored; usage and remaining limit are read from
whichever key is live, so the bar recomputes on the swap and the previous key's
tally is discarded with it. The key lives in an httpOnly cookie and is never
sent to the client — the bar shows money, never the secret.

Every model call in the product is **Haiku 4.5**, through one function, into one
ledger.

---

## Where AI is allowed to run

Three places, all live, all narrow:

| # | Use | Input | Output |
|---|---|---|---|
| 1 | Job description → skills | the posting only | a flat list of strings |
| 2 | Solver trace → English | the solver's own trace | 2–4 sentences |
| 3 | Chat → constraint patch | the solved plan | a typed patch you confirm |

Forbidden, and structurally prevented: choosing courses, deciding whether a
prerequisite is met, deciding whether a requirement is satisfied, inventing a
course or a number. The chat cannot state a plan because the schema it must
return has no field to put one in, and every course id it emits is checked
against the plan before it reaches the solver.

## Architecture

```
/app          Next.js 16 App Router — three screens, five routes
/lib/solver   the constraint solver. No model is imported into this directory.
/lib/ai       the only place a model is called. Haiku, one ledger.
/data         committed catalogs + snapshots. Nothing scrapes at request time.
/ingest       the provenance validator. Fails the build on an uncited rule.
/scripts      solver test harness.
```

### The solver

Branch-and-bound over the space of degree-satisfying course sets, with an
admissible upper bound on the objective (optimistic on skills, pessimistic on
cost) and exact symmetry reduction over interchangeable courses. It reports
`provedOptimal` only when it exhausted the search tree — the demo scenario
proves optimality in ~40 ms over 1,487 branches.

Constraints: one term per course, term credit cap, full-time floor, prerequisite
trees, term availability, bucket satisfaction, single-counting (with cited
double-count exceptions), locks, exclusions. Then K-best via no-good cuts,
counterfactuals by relaxing one constraint at a time, and — when nothing fits —
a diagnosis that names the requirement that broke it and why.

**Departure from BUILD_SPEC §3.1:** the spec called for CP-SAT behind a FastAPI
service. The deployment constraint was a single Vercel app, and the model here
is small and highly structured, so the solver is TypeScript instead. The claim
the spec protects — the AI never picks a course — is untouched.

### Provenance

Every rule the solver enforces carries a URL, a verbatim quote, a retrieval
date, and a committed snapshot of the page. `npm run verify` fails the build if
any of that is missing, if a quote does not appear in its snapshot, if a skill's
evidence is not a verbatim sentence from the course description, or if a
prerequisite points at a course outside the catalog. `data/SOURCES.md` is
generated from the same data the solver runs on, so it cannot drift.

Prerequisite parses that no human has reviewed are marked `verified: false`, and
the board renders anything depending on one as **check with your advisor** —
never as satisfied, never as blocked.

## Two schools

Columbia CS BA (deep) and BMCC CS AS (partial, deliberately). BMCC is the
opposite shape — a 60-credit associate degree where 30 credits are a rigid CUNY
Pathways core with almost no choice. Adding it touched zero lines of
Columbia-specific code, which is the point.

## Design

Built on the supplied v0 "Optimus" system — light editorial ground, 0.25rem
radius, mono eyebrows, hairline rules. Type is **Poppins** for display,
**Inter** for reading, **JetBrains Mono** for every course code and numeral,
because `COMS W4995` is a serial number, not a word.

Colour only ever encodes state: amber for locked and needs-checking, teal for a
skill the job asked for, clay for something that costs you credits. The reflow
animation when the solver re-runs is the one bold thing; it respects
`prefers-reduced-motion` by keeping the pulse and dropping the transit.
