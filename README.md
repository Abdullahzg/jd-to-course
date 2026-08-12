# Carpa

**Pick the job. We'll plan the degree — and track every application you send.**

Submission to the [Stellic Pathfinders Challenge](https://www.stellic.com/pathfinders).
Category: **College to Career**.

Two things every student does by hand, in one place, with receipts:

1. **Paste a job posting → get the courses that answer it, inside your real degree.**
   Every course in the catalog is read against the whole posting. A constraint
   solver then places the winners into semesters that satisfy every prerequisite,
   credit cap and requirement your degree actually has. Each pick quotes the
   catalog line that earned it.
2. **Connect your inbox once → the application tracker maintains itself.**
   Confirmations, assessments, interviews, offers, rejections. Each status is
   proven by a verbatim sentence from the email that announced it, and clicking
   any row shows that email, rendered.

---

## The rule that makes it trustworthy

**The AI never picks a course. The AI reads; the solver decides.**

The model turns unstructured text (a job posting, an email) into structured,
*quoted* claims. A constraint solver — plain deterministic code — chooses and
schedules courses. Nothing reaches the screen without a quote that was checked,
by machine, against the source it claims to come from. A claim whose quote is
not found verbatim in the text is dropped, not shown.

That separation is enforced in code, and it is why a degree plan from this app
can be handed to an advisor.

---

## Run it

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL, AUTH_SECRET, Google keys
npm run dev                    # http://localhost:3000
```

Sign in with Google, then choose a path in the setup wizard:

- **Use the owner's inbox** — the builder's own Gmail, read once, read-only,
  through an app password he granted. Loads a real 38-application tracker in
  about four seconds. Nothing of yours is touched. This is the fastest way to
  see the tracker working on genuine mail.
- **Connect your own** — Google OAuth, or a 16-character Gmail app password.

An `OPENROUTER_API_KEY` powers the reading steps (Claude Haiku 4.5 only). The
solver runs without any key at all.

```bash
npm run verify    # citation validator: every enforced rule resolves to a source
npm run build     # runs verify first, then next build
```

---

## What is actually in here

| | |
|---|---|
| Catalog | Columbia CS BA: **139 courses**, each carrying its bulletin URL |
| Degree rules | **7 requirement buckets**, each with a verbatim quote from the bulletin |
| Model | Claude Haiku 4.5 only, via OpenRouter, provider-pinned to Anthropic |
| Cost | **about $0.10** of model time per posting, measured from a real spend ledger |
| Storage | Postgres (Supabase). Every table prefixed `carpa_` |

### The matching pipeline

`job posting → facets` → `shortlist (2 parallel full-catalog passes, unioned)` →
`judge (3 independent draws, per-claim majority vote)` → `quote verification against
the catalog text` → `repair pass` → `refuter` → `deterministic sort`.

A course only survives if the model can quote the catalog line that proves it,
and that quote is then found in the catalog by string match. Controls matter:
a ward-nurse posting scores zero courses against a CS catalog.

### The solver

`lib/solver/core.ts` — branch and bound over requirement buckets with symmetry
breaking (courses interchangeable for a requirement collapse into one class),
precedence-constrained bin packing for the term schedule, k-best enumeration for
genuinely different alternative plans, reachability pruning, and an escalation
ladder that sheds one over-constrained course rather than failing.

### The tracker pipeline

`headers (whole year) → deterministic bulk filter (free) → triage (model, headers only) →
bodies for survivors only → extract with verbatim quote → skeptic pass → reconcile`.

Reading a 38,000-message mailbox costs one envelope sweep plus bodies for the few
hundred that are actually about applications. Scans run as background jobs with
live progress; a status only lands if its quote is found in the email.

---

## Scaling to another university

A new school is **data, not code**. `data/columbia.ts` is one `School` object:
courses (code, title, credits, prerequisite tree, terms offered, bulletin URL) and
programs (requirement buckets with their source quotes). The solver, the matcher,
the UI and the verifier are school-agnostic: no code path branches on which
school it is holding (school names appear in `lib/solver/*` only inside comments
that explain where a rule came from).
`ingest/validate.ts` refuses to build if any enforced rule lacks a resolvable
citation, so a new catalog cannot ship uncited.

---

## Tools used

Claude Code (Claude Fable 5) for the build; Claude Haiku 4.5 via OpenRouter for
every in-app reading step; Next.js 16, React 19, TypeScript, Tailwind v4, Radix;
NextAuth v5 (Google); Postgres on Supabase; ImapFlow + mailparser and the Gmail
REST API; Playwright for end-to-end testing; lucide-react icons; Poppins, Inter
and JetBrains Mono.

---

## Honest limits

- One catalog is modelled deeply (Columbia CS BA). The architecture is
  school-agnostic; the *data* for a second school is a day of ingestion, not a
  rewrite.
- Prerequisite trees are parsed from bulletin text. Where a parse is not
  human-reviewed, the plan says so on the course and asks for an advisor check
  rather than pretending certainty.
- A full posting takes two to four minutes to plan, because every course in the
  catalog is genuinely read rather than keyword-matched.
