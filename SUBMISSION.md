# Pathfinders submission package

Deadline: **August 21, 2026**. Registration is a separate step and comes first
(the form asks for a `.edu` address — use `azg2116@columbia.edu`, not the
`@imagine.art` one).

The five required pieces are below, ready to paste.

---

## 1. Title and category

**Title:** Carpa — pick the job, and the degree plans itself

**Category:** **College to Career**

*Why this category and not Degree Planning.* Stellic already sells audit-aware
degree planning, what-if scenarios and degree pathways. Entering Carpa against
the judges' own shipped product invites the comparison that kills the
originality score. In College to Career, both halves of Carpa point the same
way: a job posting decides the coursework, and the applications that follow
track themselves. That is a lane Stellic's platform does not occupy.

---

## 2. The 500-word write-up

> **The problem**
>
> Every student eventually asks the same question and gets no real answer:
> *which of my remaining electives actually get me the job I want?* Advisors
> know the degree rules. Job postings know the market. Nothing connects them,
> so students choose courses on rumour, then spend the following year keeping a
> job-application spreadsheet by hand that is out of date the moment a recruiter
> emails them.
>
> **What I built**
>
> Carpa does both halves, and refuses to say anything it cannot prove.
>
> Paste a job posting. Every course in the catalog — all 139 of Columbia's CS
> BA, not a keyword-matched subset — is read against the whole posting. A
> constraint solver then places the winners into semesters that satisfy every
> prerequisite, every credit cap, and every requirement the degree actually has.
> Each course on the board names the requirement it fills, and carries the
> verbatim catalog sentence that earned it. Courses the solver passed over are
> ranked, with the reason it passed over them.
>
> Then connect your inbox once. Carpa reads a year of email, finds the
> applications, and builds the tracker: applied, assessment, interview, offer,
> rejected — each status proven by a sentence copied verbatim out of the email
> that announced it, with the original message one click away. A rejection for
> something you never logged still gets its row.
>
> **The rule that makes it trustworthy**
>
> The AI never picks a course. The AI reads; a solver decides. The model turns
> unstructured text into structured, quoted claims; deterministic code chooses
> and schedules. Every quote is then checked by machine against the source it
> claims to come from, and a quote that is not found is dropped rather than
> shown. A ward-nurse posting returns zero courses from a computer science
> catalog — the system is built to say no.
>
> **Who it is for, and what happens if it scales**
>
> Any student choosing electives with a career in mind, and any advisor who has
> to defend that choice. A new university is data, not code: the solver, the
> matcher and the verifier never branch on which school they are holding, and
> the build refuses to ship a requirement that has no citation. One posting
> costs about ten cents of model time, on the smallest model Anthropic sells.
>
> **What it does not pretend**
>
> One catalog is modelled deeply rather than twenty shallowly. Where a
> prerequisite was parsed rather than human-reviewed, the plan says so and asks
> for an advisor instead of pretending certainty.

*(~440 words — room to add a line about your own experience choosing electives,
which would strengthen "real student problem".)*

---

## 3. The two-minute demo video

The planner genuinely takes 2–4 minutes, which does not fit in a 2-minute video.
**Record the plan run beforehand and cut to the finished board.** Never make a
judge watch a spinner.

| Time | Shot | Say |
|---|---|---|
| 0:00–0:12 | Landing page | "Students pick electives on rumour, then keep a job spreadsheet by hand. Carpa does both, and proves everything it says." |
| 0:12–0:35 | Paste a real posting, hit Build, **cut immediately** to the finished board | "Every course in the catalog is read against the whole posting." |
| 0:35–1:00 | Hover a course: requirement label, the quoted catalog line, prerequisite arrows | "Each pick names the requirement it fills and quotes the sentence that earned it. The AI reads. A solver decides." |
| 1:00–1:20 | Drop a course → red semester, live health panel, search showing "fills: Data structures" → click it → all clear | "Change your mind and the degree rules answer instantly, not eventually." |
| 1:20–1:45 | Tracker: 38 real rows, open a receipt, show the verbatim quote and the real email | "This came out of a real inbox. Every status carries the sentence that proved it." |
| 1:45–2:00 | Back to the board | "One catalog modelled deeply, about ten cents a posting, and a new school is data, not code." |

---

## 4. The working link a judge can open

**This is currently the blocking item.** `aicarpa.app` does not resolve and the
GitHub repo is private, so a judge has nothing to click.

In order of preference:

1. **Deploy it** (see `DEPLOY.md`). Railway or Render, because four routes need
   more than the 60 seconds Vercel's free tier allows.
2. **Make the repo public** as the fallback link — it is accepted ("live URL,
   Figma, or GitHub"), and the README is written for that reader. Check first
   that no secret is committed: `.env.local` is gitignored, and the judge inbox
   credentials live in the database, not the repo.

Do both. A live URL that dies during judging still leaves the repo standing.

---

## 5. Tools used

Claude Code (Claude Fable 5) as the build environment; Claude Haiku 4.5 via
OpenRouter for every in-app reading step (facets, shortlist, judging, refuting,
email triage and extraction); Next.js 16; React 19; TypeScript; Tailwind CSS v4;
Radix primitives; NextAuth v5 with Google; PostgreSQL on Supabase; ImapFlow and
mailparser for IMAP; the Gmail REST API; Playwright for end-to-end testing;
lucide-react; Poppins, Inter and JetBrains Mono; Vercel/Railway for hosting.

---

## Before you file

- [ ] Register first (separate from submitting), with the `.edu` address
- [ ] Deploy, or make the repo public, or both
- [ ] Record the video with the plan run pre-baked
- [ ] Read the official terms — they are only reachable after registering
- [ ] Check the finalist date: top three present at Stellic Summit, Sept 23,
      Philadelphia. Flag conflicts early.
