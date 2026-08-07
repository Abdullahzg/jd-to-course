# CRITERIA

What has to be true before a new university, or a new degree at a school that is
already here, can be added to this planner.

This is not a general purpose ingestion guide. It describes what `lib/types.ts`
demands, what `ingest/validate.ts` will refuse to build, and what
`lib/verify.ts` re-checks against every finished plan. If a value cannot be
collected as described here, the honest move is to leave the course or the rule
out rather than to approximate it, because everything in this system is shown to
a student next to a link back to the page it came from.

A new school is one file in `/data` plus a set of committed HTML snapshots. It
is registered in `data/index.ts` by adding it to `SCHOOLS`. No other file in the
repo should need to change. Adding BMCC touched zero lines of Columbia specific
code, and that is the test of whether an adapter has been written correctly.

The order below is the order the work actually happens in.

---

## 1. What to collect

### 1.1 Course

One record per course the catalog publishes. `data/columbia.ts` and
`data/bmcc.ts` both build these through a small local helper called `C`, which
is worth copying, because it keeps the id derivation in one place.

**`id`** (`string`, required). `SCHOOL:CODEWITHNOSPACES`, for example
`COLUMBIA:COMSW4995` or `BMCC:CSC331`. The id is the only thing that joins a
prerequisite tree, a bucket's `eligible` list, a student's completed list, and
the catalog itself. Derive it with one function and never type one by hand.

There is a real bug in this repo's history that explains why. Columbia's
bulletin separates `COMS` from `W1004` with a non breaking space. Ids built from
course pages therefore differed, invisibly, from ids built from the degree
requirements page, and not one prerequisite ever resolved. `ingest/parse-courses.py`
now strips `U+00A0`, `U+2009` and `U+202F` before anything else happens. Any new
site should be assumed to do something equally silly until proven otherwise.

**`code`** (`string`, required). The code exactly as a student would read it and
type it into the registrar's system: `COMS W4995`, `CSC 331`. One internal space
between department and number. This is what appears on the board, so it is a
serial number, not prose.

**`credits`** (`number`, required, must be greater than zero). The validator
fails a course with zero or negative credits, because the solver's credit cap
and full time floor are arithmetic over this field. Where a catalog prints a
range ("3 to 4 points"), pick the number the registrar actually awards for the
standard section and record the range wording in `restrictions`.

**`title`** (`string`, required). As printed. Where a catalog prints titles in
all capitals, title case it (`build-catalog.py` does this) rather than shouting
at the student.

**`description`** (`string`, required, and see 1.2). The catalog's own prose
paragraph about what the course covers. Not the department blurb, not a
paraphrase, not a summary written by a model.

**`prereq`** (`PrereqNode | null`, required field, `null` is a legitimate
value). See section 3. `null` means the catalog states no prerequisite. It does
not mean "we did not look".

**`coreq`** (`string[]`, required field, empty array is normal). Course ids that
must be taken in the same term. Be aware that nothing in the solver enforces
this today: both shipped adapters leave it empty. Record corequisites here if
the catalog states them, but do not smuggle a corequisite into `prereq` to make
it bite, because that produces a plan that puts the course a term too late and
tells the student the wrong thing.

**`termsOffered`** (`Term[]`, required, must not be empty). Which of `FA`, `SP`,
`SU` the course actually runs in. The validator fails an empty list outright,
with the reason that a course offered in no term can never be placed and
therefore only pollutes the search.

Take this from the registrar's real section listings, not from a sentence like
"offered every year". Columbia's bulletin prints lines of the form
`Fall 2026: COMS W4118`, and `parse-courses.py` reads exactly those. When a page
lists no sections at all the parser falls back to `["FA", "SP"]`, which is a
guess, and a guess that makes a plan look more flexible than it is. If you adopt
that fallback for a new school, say so in the school's `structureNote` and
prefer to hand check the courses the degree requirements actually name.

**`level`** (`"UG" | "GR"`, required). Undergraduate or graduate. Columbia's
generated catalog infers `GR` from a course number of 4000 or above. Nothing in
the solver filters on this today, so treat it as description rather than as a
control, and do not rely on it to keep a graduate course out of an undergraduate
plan. If a school needs that rule enforced, it belongs in the bucket's
`eligible` list, where it is visible.

**`restrictions`** (`string[]`, required field, empty array is normal). Free
text, in the catalog's own words: "Instructor permission may be required",
"Honors section", "Requires a faculty sponsor". The type comments say these are
surfaced as warnings and never enforced silently, and that is exactly what
happens: `lib/solver/index.ts` copies them into `Placement.unverifiableText`, so
the student reads them on the card. Never encode a restriction as something the
solver enforces, because the solver enforcing it invisibly is the same as
deleting the course.

**`verified`** (`boolean`, required). `true` means a human compared this
course's prerequisite tree against the catalog text and agreed with it. `false`
means it is a best effort parse. This is not paperwork. A `false` here sets
`needsAdvisorCheck` on every placement of that course and adds the sentence
"This prerequisite parse has not been reviewed by a human yet." to what the
student sees. The validator emits a non blocking warning per unverified course,
and `data/SOURCES.md` prints the reviewed count per school. Right now that is 25
of Columbia's 150 courses, and saying so is better than pretending.

**`sourceUrl`** (`string`, required, must start with `http`). The page this
course's facts came from, deep linked to the course where the site allows it.
Columbia's generated catalog uses
`https://bulletin.columbia.edu/search/?P=<CODE>`, which resolves to one course.
A link to the catalog home page is not a citation.

**`skills`** (`SkillEvidence[]`, required field, empty array is allowed). Each
entry is `{ skill, evidence }` where `evidence` is a **verbatim sentence from
this course's own `description`**. The validator does a literal substring test
and fails the build when it does not match. A skill with no evidence sentence is
an inference, and inference is not allowed anywhere near this data.

These hand written tags are a fallback used when no API key is present. With a
key, `/api/relevance` reads the description against the actual job posting and
produces better tags, and it discards any quote that is not a substring of the
description. Either path leads back to the same sentence in the same paragraph.

### 1.2 The description is mandatory, and it is the only thing job matching reads

`ingest/validate.ts` fails the build on `no description`. That is the hard rule.
The reason it is a hard rule and not a warning is worth stating plainly.

Job matching in this system reads course descriptions and nothing else. The
offline fallback (`ingest/emit-catalog.py`) searches the description's own
sentences for a vocabulary term and keeps the sentence it found as evidence. The
live path (`app/api/relevance/route.ts`) sends the model a course code, title and
full description, and requires it to return the exact sentence proving the
course teaches a given requirement. Any returned quote that is not a substring
of the description is dropped on the floor before it reaches the solver. Titles
are not evidence. Course numbers are not evidence. Department names are not
evidence.

So a course with no description is not neutral. It can still be scheduled: it
has credits, terms and prerequisites, so the solver can place it to fill a
requirement or reach the full time floor. But it can never appear in the
coverage report, never answer a line of the job description, and never carry a
quote the student can check. It is credit with nothing to say for itself.

Columbia is the honest example. `ingest/fetch-courses.mjs` committed 193
bulletin pages, one per course code. `ingest/parse-courses.py` got a structured
record out of 184 of them. `ingest/build-catalog.py` then **dropped 38 courses
for having no usable description**, leaving 146. All 38 were pages where the
bulletin prints the code, title and points but no prose paragraph: placeholder
codes like `COMS E0001` through `COMS E0006`, cross listings such as
`COMS E4111`, and a handful of real courses the bulletin simply does not
describe, including `STAT UN1201` and `MATH UN2020`.

That is the right outcome, and it is right for two reasons. First, the
alternative is to fabricate a paragraph, and then the evidence sentence a
student clicks through to check would not exist on the page. Second, the loss is
survivable precisely because it is visible: `STAT UN1201` and `MATH UN2020` are
named by the Columbia degree requirements, and they are in the catalog anyway
because a human encoded them by hand in `data/columbia.ts` with descriptions
taken from the bulletin. The pipeline drops what it cannot read, and the human
fills the gaps that matter. Both halves are necessary. A pipeline that quietly
kept the 38 with an empty string would have produced 38 courses that can be
scheduled and can never be justified.

Concretely, for a new school: dropping a course with no description is expected
and fine. Dropping a course that a requirement bucket names is not, because
`validate.ts` will fail the build on a bucket whose `eligible` list references a
missing course. Hand encode those.

### 1.3 Program

One record per degree. Columbia CS BA and BMCC CS AS are the two shipped
examples, and they were picked to be opposite shapes.

**`id`**, **`name`**, **`school`**, **`level`**. `COLUMBIA:CS_BA`, "Computer
Science, BA", `COLUMBIA`, `UG`. The name is what the student picks from a menu,
so use the catalog's own name for the degree.

**`totalCredits`** (`number`). Credits for the whole degree, including
everything outside the major. Columbia CS BA is 124. BMCC CS AS is 60. This is
not decoration: the solver computes `remainingDegreeCredits` as
`totalCredits - completedCredits` and spreads the difference across the horizon
as explicit open credit slots, so that a semester shows a student's real load
rather than only the major slice of it. It also drives `minTermsRequired`, which
is `ceil(remainingDegreeCredits / maxCreditsPerTerm)`, the number of terms the
student has to enrol for whatever else happens.

**`majorCredits`** (`number`). The credits governed by the buckets below.
Columbia is 47 of 124. BMCC is 60 of 60. The gap between these two numbers is
the honest statement of how much of the degree this planner actually models: at
Columbia, 77 credits of Core Curriculum and free electives are open slots that
the planner counts but does not choose.

**`maxCreditsPerTerm`** and **`minCreditsPerTerm`** (`number`). The registrar's
cap and the full time floor. Both must be cited (see section 2), and the
validator fails if the cap is not strictly above the floor. Both schools here
happen to be 18 and 12, from two different pages.

The cap is enforced as a hard constraint. The floor is reported rather than
enforced: the solver fills toward it with open credits and lists any term still
short in `belowFullTime`, and `verify.ts` check 10 reports it. A student who
needs to drop below full time for a real life reason should see a number, not a
refusal.

**`buckets`** (`RequirementBucket[]`). See 1.4.

**`sources`** (`Source[]`). Degree wide rules that are not a single bucket: the
credit cap, the floor, any stated permission such as a double count. The
validator specifically requires at least one source whose quote matches
`/credit|point/i`, on the grounds that the credit cap is enforced by the solver
and therefore has to be cited by somebody.

### 1.4 RequirementBucket

One record per rule of the form "take N of these".

**`id`**. `PROGRAM:BUCKET`, for example `COLUMBIA:CS_BA:AREA_FOUNDATION`. Stable,
because `allowDoubleCount` refers to it by name.

**`label`**. What the student reads on the requirement rail. Use the catalog's
own heading: "Area foundation", "Required Common Core: English Composition".

**`needCredits`** or **`needCourses`** (exactly one, and it must be greater than
zero). Use `needCourses` when the catalog counts courses ("select three of the
following"), `needCredits` when it counts credits ("6 credits from"). Columbia's
area foundation is `needCourses: 3` even though the bulletin heading says "9 to
12 points", because the rule is genuinely three courses and their credits vary.
The validator fails a bucket that requires nothing.

**`eligible`** (`string[]`, must not be empty, every id must exist in this
school's catalog). The courses that can fill this bucket. Two failures the
validator catches: an eligible list naming a course the catalog does not hold,
and a bucket needing more courses than are eligible, which can never be
satisfied.

Where the catalog states a predicate rather than a list, evaluate the predicate
over the committed catalog at build time and keep the sentence as the quote.
Columbia's elective rule is "Any three COMS courses ... at least 3 points and
are at the 3000 level or above", encoded in `data/columbia.ts` as a filter over
the catalog which currently yields 34 courses. This is better than a hand typed
list because it stays true when the catalog grows, and it is auditable because
the predicate is five lines of code next to the quote it came from.

**`allowDoubleCount`** (`string[]`, empty is normal). See section 4.

**`source`** (`Source`, required, no exceptions). See section 2.

### 1.5 School

**`id`**, **`name`**, **`shortName`**, **`catalogUrl`**, **`programs`**,
**`courses`**.

**`structureNote`** is the one field with no obvious counterpart on a university
website, and it is required for a reason. It states in a sentence or two what
makes this school structurally different from the others already in the repo,
and it is printed at the top of that school's section in `data/SOURCES.md`.
Columbia's says the major is a small core plus wide latitude. BMCC's says 30 of
60 credits are a fixed Pathways core with almost no choice. If you cannot write
this sentence for a new school, you have probably not read its requirements
closely enough to encode them.

---

## 2. Provenance

Every requirement rule needs four things, and the type says so:

```ts
type Source = {
  url: string;          // the exact page, not the catalog homepage
  quote: string;        // verbatim sentence stating this rule
  retrievedAt: string;  // ISO date, YYYY-MM-DD
  snapshotPath: string; // committed raw capture under /data/snapshots
};
```

`ingest/validate.ts` fails the build if a bucket has no source at all, if the
url does not start with `http`, if the quote is empty, if `retrievedAt` is not
an ISO date, if `snapshotPath` is missing, if the snapshot file is not committed,
or if the quote does not appear in the snapshot. Not warnings. Exit code 1.

Save the snapshot as the raw bytes the server returned. `fetch-courses.mjs`
writes `await r.text()` straight to disk with no cleanup, which is what makes
the later quote check meaningful. Put it under `data/snapshots/` and reference it
with a leading slash, as `/data/snapshots/columbia-cs-bulletin.html`.

The quote check is deliberately forgiving about presentation and unforgiving
about content. `checkSnapshot` strips scripts, styles and tags, unescapes the
common entities, folds curly quotes to straight ones, collapses whitespace and
lowercases both sides before testing. So markup and typography do not matter. It
also splits the quote on semicolons and requires **every** part to be present,
which is how a rule spread across the rows of a requirements table can still be
quoted honestly. BMCC's curriculum bucket does exactly this: five course rows
joined with semicolons into one quote, each of which is checked separately.

Why this exists rather than just a URL:

Catalogs are edited. They are edited between the day you build this and the day
somebody opens it, and university sites rewrite their course listings without
redirects or notice. A bare URL is a promise that decays. When the page changes,
a link either 404s or, much worse, resolves to a page that now says something
different from what the solver is enforcing, and the citation looks fine while
being wrong.

The snapshot converts "the catalog said this" from a claim into an artifact. The
quote check then converts the snapshot from a file nobody reads into a test:
the build only passes if the sentence the solver acts on was genuinely on the
page that was saved, on the date recorded. That is the difference between citing
a source and having read it.

The same data generates `data/SOURCES.md`, which is why that file carries a
header telling you not to edit it by hand. Run `npx tsx ingest/validate.ts` to
regenerate it and `npx tsx ingest/validate.ts --check` to fail when it is stale.
A hand maintained sources file drifts from the rules actually enforced within a
week, and then it is worse than nothing, because it is a document that looks
like evidence.

One thing the validator cannot check, so it is your job: course `description`
text is not verified against a snapshot. It is only checked for being non empty
and for containing every skill evidence sentence. When you hand encode a course
in an adapter file, the description must still be the catalog's own words from
the page in `sourceUrl`. Nothing will stop you if it is not, and that is the
single easiest way to put a lie into this system.

---

## 3. The prerequisite contract

### 3.1 The tree

`PrereqNode` has exactly four shapes:

```ts
{ op: "AND", children: [...] }
{ op: "OR",  children: [...] }
{ op: "COURSE", courseId: "COLUMBIA:COMSW3134" }
{ op: "UNVERIFIABLE", text: "or instructor permission" }
```

Prerequisite prose is a regular grammar hiding in a sentence: course codes, the
words "and" and "or", parentheses, then whatever free text the department felt
like adding. `ingest/build-catalog.py` treats it as such. It tokenizes course
codes, `and`, `or` and parentheses, and parses
`expr := term ('or' term)* ; term := factor ('and' factor)*`. Everything after
the last course code is prose, and any capitalised sentence sitting between
codes is prose too.

This is a parser's job and not a model's. The comment at the top of that file
says why in one line: a model asked to do this will occasionally invent a course
code, and a course code that does not exist is a prerequisite the solver can
never satisfy, which turns into an infeasible plan with no explanation. Note the
asymmetry in cost. A model that invents prose costs you a confusing sentence. A
model that invents a course id costs you a silently missing course.

For a school whose prerequisite text does not fit this grammar, either write a
parser for that grammar or hand encode the prerequisites. Both adapters here
build trees with tiny local helpers, `COURSE`, `AND`, `OR` and `UNVER`, and hand
encoding a hundred courses is an afternoon.

### 3.2 What must become UNVERIFIABLE

Anything that is not a specific course in this catalog. Not "anything hard".
Real examples from the two adapters:

- "or knowledge of Java"
- "Honors version; instructor permission may be required"
- "MATH UN1102 or the equivalent"
- "Knowledge of calculus"
- "Departmental placement or MAT 56"
- "Faculty sponsor and departmental approval required"
- "or departmental approval"

Placement tests, class standing, major restrictions, "or equivalent", instructor
permission, and any course code you cannot resolve to an id. Keep the original
wording. The validator fails an `UNVERIFIABLE` node with empty text, because the
student would then see an empty warning, which is worse than no warning.

The semantics are the point. In `prereqSatisfied`, an `UNVERIFIABLE` node
returns `true`. It does not block the course. Instead `collectUnverifiable`
gathers its text onto the placement, sets `needsAdvisorCheck`, and the board
renders the course amber with "check with your advisor", never as satisfied and
never as blocked. A parser that rendered "or instructor permission" as a
confident green check would be lying; one that rendered it as a hard block would
be hiding a course the student can very likely take.

So the error direction is chosen on purpose: an unverifiable condition shows the
course with a visible caveat and lets a human resolve it. Guessing does not get
that option. Not knowing is a legitimate answer here.

### 3.3 A prerequisite naming a course the catalog does not hold

This is the rule that matters most, and it is the one with the sharpest failure
mode.

A `COURSE` node is satisfied only when its id is in the set of courses already
completed or already planned. If that id is not in the catalog at all, no plan
can ever contain it, so the node is permanently false. An `AND` above it is
permanently false. The course sitting on top is unschedulable in every plan,
forever. It does not error. It does not warn. It just is never chosen, and the
student is never told that a course they might have wanted was removed from
consideration by a data problem. A plan that is quietly missing a course looks
exactly like a plan that correctly did not want it.

There are two defences, and a new school needs both.

**At build time, demote.** `build-catalog.py` walks every tree after the catalog
is assembled and rewrites any `COURSE` node whose id is not present into
`{ op: "UNVERIFIABLE", text: "<CODE>, which is not in this catalog" }`. For
Columbia this fired on 21 courses and 36 nodes. The effect is to convert a
silent permanent block into a visible "ask your advisor", which is what the
situation actually is: the requirement is real, this catalog just cannot check
it.

**At validate time, fail.** `validate.ts` walks the trees again and fails the
build on any surviving `COURSE` node pointing outside the catalog.
`scripts/solver-test.ts` repeats the same walk for every school. So the demotion
step is a correctness fix, not a way to launder a bad parse: if it misses one,
the build stops.

The practical consequence when you add a school: fetch the whole department, not
just the courses the degree names. Columbia's 193 pages exist so that a
prerequisite chain three courses deep still resolves. When you deliberately ship
a partial catalog, as BMCC does, expect prerequisites pointing outside it, and
expect them as amber advisor checks rather than as absences. BMCC's
`MAT 206` carries `UNVER("Departmental placement or MAT 56")` for exactly this
reason: `MAT 56` is not in the adapter, so it is named in words instead of being
a dead reference.

### 3.4 The verified flag

Set `verified: true` only after a human has read the catalog sentence and the
tree side by side. The generated Columbia courses ship `verified: false` on all
of them, which is why the validator prints 130 warnings and why `SOURCES.md`
lists the unreviewed courses by code. Warnings do not block the build. Lying
about them would.

---

## 4. What makes a degree hard to model

The two schools in this repo were chosen to be opposite shapes, so between them
they cover most of what goes wrong. Columbia is private and flexible: a small
core, then three area foundation courses chosen from 21 and three open CS
electives. BMCC is public and rigid: 60 credits of which 30 are a fixed CUNY
Pathways core, with only 6 credits of program electives genuinely free.

### 4.1 Double counting

Sometimes a catalog explicitly permits one course to satisfy two requirements.
Columbia's bulletin says:

> "NOTE: Math 2015 Linear Algebra and Probability may simultaneously satisfy
> both linear algebra and probability requirements without the need to take
> additional classes thus reducing the total number of points required."

That sentence is committed as a `Source` on the program, and the permission is
encoded by putting each bucket id in the other's `allowDoubleCount`. The rule to
follow: `allowDoubleCount` is only ever a transcription of a stated permission.
It is never your inference that two requirements look similar enough.

Two things the tooling does here. The validator fails if `allowDoubleCount`
names a bucket that does not exist in the program, on the stated grounds that a
permission which silently does nothing is the worst kind of wrong because it
looks fine. And the solver only honours **mutual** pairs: `mutualDouble(a, b)`
requires each to list the other. A one way declaration gets a warning and is
ignored, so write both sides.

BMCC has no double counting at all. Its `allowDoubleCount` arrays are all empty,
which is the normal case.

### 4.2 One course satisfying two requirements when nobody said it could

This is the opposite problem and it is much more common. It is not a permission,
it is an overlap in the eligible lists, and it inflates a student's progress.

Columbia's elective rule reads "any three COMS courses ... at the 3000 level or
above". Evaluated over the catalog it produces 34 courses, and that set
textually contains the very core courses the student already spent on the core
requirement. Crediting one completed course to every bucket that lists it would
satisfy the elective requirement with courses that cannot be reused, and would
tell a student they are closer to graduating than they are. `lib/solver/core.ts`
calls that the worst error this program can make, and it is right.

The fix is a matching, not a loop. `assignCompleted` runs Kuhn's augmenting path
algorithm over expanded requirement slots, so each completed course fills at
most one slot, choosing the assignment that fills the most slots. Mutual
`allowDoubleCount` pairs then get one extra credit for the same course, which is
exactly and only what that permission means. Planned courses go through the same
discipline: each placement carries one `bucketId`, and `verify.ts` check 8 re
derives the whole thing from the finished plan and fails if any course is
counted twice.

What you have to do when adding a school: write eligible lists that overlap
honestly, and do not try to prevent overlap by trimming the lists. The catalog's
rule is the catalog's rule. The single count guarantee is the solver's job and
it already works.

### 4.3 Capped electives

BMCC's Pathways page says:

> "No more than two courses in any discipline or interdisciplinary field can be
> used to satisfy Flexible Core requirements."

`RequirementBucket` has no field for that. There is no `maxPerDiscipline`, and
there is no cross bucket constraint of any kind. The rule is committed as a
`Source` on the program, so it is visible on the sources page, and it is honoured
by construction: each Flexible Core bucket has a narrow, hand written `eligible`
list that cannot violate the cap. Scientific World is exactly `CSC 101` and
`CSC 111`; Individual and Society is `SOC 100` or `ANT 100`.

That is a legitimate technique and you should know its limit. It works when the
cap cannot bind because the choices are already few. It does not work for a
school with a genuinely wide Flexible Core, where the student picks three
courses from ninety and the discipline cap is the only thing stopping all three
from being psychology. For that school, you extend the model and the solver.
Encoding the cap by narrowing eligible lists in that case is not a
simplification, it is a wrong answer that no check will catch, because every
check in this repo takes the eligible list as truth.

The related and easier case is a bucket whose credits are capped by wording like
Columbia's "Area Foundation Courses (9 to 12 points): Select three from the
following list". Use `needCourses: 3` and let the credits fall where they fall.

BMCC also shows the partial adapter case: the catalog names 13 program elective
options and the adapter holds 5. The quote records all 13, which is honest, and
the eligible list holds what the adapter actually has. A student choosing among
5 is not misled, because the quote is right there next to it.

### 4.4 Residency and full time rules

Two numbers per program, both cited, both from pages that are usually not the
degree page.

Columbia's come from the registration page: "Students are allowed to register
for a maximum of 18 points of credit in any Fall or Spring term" and "All
Columbia College students must be registered for a minimum of 12 points of
credit in any given semester". BMCC's cap comes from the registrar FAQ:
"Fall/Spring 18* credits/hours".

The cap is a hard constraint. Every plan is checked against it twice, once by
the solver and once by `verify.ts` check 4.

The floor is reported, not enforced. This is a deliberate design decision worth
preserving. The solver spreads `remainingDegreeCredits` across the horizon as
open credit slots so each term reaches the floor, records any term that still
falls short in `belowFullTime`, and `verify.ts` check 10 states it as a fact
with the offending terms named. Enforcing it would mean refusing to produce a
plan for a student who has a reason to take a light term, and refusing is not an
explanation.

Residency in the sense of "you must complete N credits here" is not modelled.
What exists is `minTermsRequired`, computed as
`ceil(remainingDegreeCredits / maxCreditsPerTerm)`, the number of terms the
student must enrol for whatever the major requires. If a school has a real
residency rule, cite it in `program.sources` so it is at least visible, and be
aware the solver will not enforce it.

BMCC's second registrar quote is a good example of the same honesty:
"*Students on academic notice are limited to 14 credits/hours for the
Spring/Fall." That is captured as a source and enforced nowhere, because the
system does not know whether a student is on academic notice and must not guess.

### 4.5 Single term courses

`termsOffered` is where most of a plan's real difficulty lives, and it is the
field people copy carelessly.

Columbia's `COMS W4119 Computer Networks` is Spring only. `COMS W4113
Distributed Systems` is Fall only, and it needs `COMS W3157` and `CSEE W3827`
first. BMCC's `CSC 350 Software Development` is Spring only and needs `CSC 211`,
while `CIS 345 Web Programming` is Fall only. A prerequisite chain of Fall only
courses costs a full year per link, and the effect compounds: the solver's
`earliestTerm` and `earliestReason` on each placement exist to explain to the
student why a course could not be moved forward.

Get this from real section listings across several years, not from a claim on
the department page. `verify.ts` check 5 fails any plan that places a course in
a term it is not offered, so a wrong `termsOffered` does not produce a wrong
looking plan, it produces a confidently wrong plan.

Two failure modes to watch. Defaulting to `["FA", "SP"]` when the page is silent
makes the degree look easier than it is. An empty array fails the build, which is
correct, because a course offered in no term can never be placed and its
presence in an eligible list only makes a bucket look more satisfiable than it
is.

---

## 5. Acceptance checklist

Run these from the repository root, in order. Each one proves something
specific.

1. **`node ingest/fetch-courses.mjs`**
   Reads course codes from `/tmp/codes.txt`, one per line, and writes one raw
   HTML file per code into `data/snapshots/courses/`. It skips files that already
   exist, retries three times, and prints how many failed.
   *Proves:* every course fact you are about to encode has a committed page
   behind it, and re running the ingest does not re fetch the world.

2. **`python3 ingest/parse-courses.py`**
   Turns the committed pages into `ingest/columbia-parsed.json` and prints
   `parsed`, `with a description`, `with prerequisites`, `title-case titles`.
   *Proves:* the parser actually understood the page. Columbia's numbers are 184
   parsed from 193 pages. If `with a description` is far below `parsed`, your
   description heuristic is wrong for this site and everything downstream will be
   uncheckable.

3. **`python3 ingest/build-catalog.py`**
   Builds `ingest/columbia-expanded.json`. Prints how many courses were skipped
   for having no description, how many prerequisite trees were built, how many
   carry advisor notes, how many prerequisite ids were referenced and how many of
   those are outside the catalog.
   *Proves:* the description rule was applied (Columbia: 38 skipped, 146 built),
   and that every dangling prerequisite was demoted to `UNVERIFIABLE` rather than
   left as a permanent silent block (Columbia: 21 courses affected).

4. **`python3 ingest/emit-catalog.py`**
   Writes the generated `Course[]` module, for Columbia `data/columbia-extra.ts`,
   attaching fallback skill tags whose evidence is a sentence taken from the
   course's own description.
   *Proves:* the catalog compiles as typed data and every skill claim already
   quotes the catalog, before any model is involved.

5. **Write the adapter by hand.** `data/<school>.ts`: the `School`, its
   `Program`s, and every `RequirementBucket` with its `Source`. Register it in
   `SCHOOLS` in `data/index.ts`.
   *Proves nothing by itself, and that is the point:* requirement rules are few,
   high stakes and structured, so a person encodes them and the next two steps
   check the person.

6. **`npx tsx ingest/validate.ts`**
   The provenance validator, and it regenerates `data/SOURCES.md`. It fails on a
   missing description, non positive credits, empty `termsOffered`, a missing or
   non http `sourceUrl`, a skill whose evidence is not a verbatim substring of
   the description, a prerequisite pointing outside the catalog, an empty
   `UNVERIFIABLE`, a bucket with no source or no quote or a non ISO date or no
   snapshot, a quote that does not appear in its snapshot, a bucket that needs
   nothing or has no eligible courses or names missing ones or needs more
   courses than exist, an `allowDoubleCount` naming a bucket that does not exist,
   a program with no sources, an uncited credit cap, and a cap that is not above
   the floor.
   *Proves:* every rule the solver enforces carries a resolvable, dated,
   snapshotted citation. Expect warnings for unreviewed prerequisite parses.
   Those are surfaced in the UI, not blocking.

7. **`npx tsx ingest/validate.ts --check`**
   Same checks, but fails instead of rewriting `data/SOURCES.md`.
   *Proves:* the sources file committed to the repo matches the data the solver
   runs on. This is what stops the published evidence from drifting away from the
   enforced rules.

8. **`npm run solver:test`**
   The solver harness. For each scenario it re derives every constraint from the
   catalog rather than trusting the solver's bookkeeping: no duplicate course, no
   re taking a completed course, the credit cap, term availability, prerequisites
   satisfied strictly earlier, every bucket satisfied, nothing past the horizon,
   every bucket cited, completed courses counted once each, one bucket per
   placement. It also runs the infeasible case (one term for a whole major, which
   must produce an explanation and must never use the word "infeasible"), locks,
   exclusions, an empty job description, and a monotonicity check that a longer
   horizon never covers fewer skills.
   *Proves:* the plans this school produces obey its own rules, and that a new
   adapter did not break an existing school.

9. **`npm run verify`**
   Steps 7 and 8 together. This is the gate.

10. **`npm run build`**
    Runs `verify` first, then `next build`. A failed citation fails the deploy.
    *Proves:* nothing uncited can ship.

11. **`npm run dev`, then read the screen.**
    Open the school in the planner. Check that the requirement rail shows your
    buckets with their quotes, that courses with `verified: false` or an
    `UNVERIFIABLE` prerequisite render as an amber "Ask your advisor about this
    one" rather than as satisfied or blocked, and that `/sources` lists your
    pages with their retrieval dates.
    *Proves:* the honesty is visible to the student, not just to the test suite.

A school is done when steps 6 through 10 pass and step 11 shows nothing you
would be embarrassed to have a registrar click on.

---

## 6. What this system will not do

The model reads text and never chooses courses. `lib/solver` imports no model.
Three narrow live uses exist: job description to a flat list of skill strings;
course description to which of those the course teaches, with the proving
sentence quoted and discarded if it is not a substring; and the solver's own
trace to English. Chat returns a typed constraint patch, never a plan, because
the schema it must return has no field to put one in. A model is never asked
whether a prerequisite is met, whether a requirement is satisfied, or which
course belongs in a term.

Anything requiring judgement about a student's life is out of scope. Concretely,
this system will not:

- Decide whether you meet a prerequisite that the catalog states in words.
  "Instructor permission", "or equivalent", "departmental placement" and
  "sufficient mathematical maturity" stay amber forever. It will show you the
  sentence and expect you to ask a human.
- Apply transfer credit, AP scores, waivers, substitutions or petitions. If your
  advisor approved a substitution, this system does not know and cannot know.
  Mark the course completed if you want the plan to reflect it.
- Know whether a course has seats, when registration opens, whether you got in,
  or whether the section conflicts with another at 9am on Tuesday. It has no
  meeting times.
- Know your instructors, your grades, your GPA, or any minimum grade a major
  requires. Nothing here reads a transcript beyond a list of course ids and a
  credit total.
- Model cost, tuition, financial aid, or the credit floor a scholarship needs.
- Model residency requirements, graduation application deadlines, probation
  rules, or the reduced credit limits that apply to a student on academic
  notice. BMCC's 14 credit limit for such students is recorded as a source and
  enforced nowhere, because the system does not know your standing and must not
  guess.
- Choose the requirements outside the major. At Columbia that is 77 of 124
  credits: the Core Curriculum and free electives appear as open credit slots so
  your term looks like a real term, but the planner does not pick them.
- Enforce the full time floor. It reports terms that fall below it and leaves
  the decision to you.
- Tell you a course is a good fit for a job on any basis other than a sentence
  in its own description. No topic similarity, no department adjacency, no
  score. If the description does not say it, the course does not answer it.
- Produce a percentage match. There is no number to summarise how well a plan
  fits a job, and the test suite asserts that no percent sign appears anywhere
  in the coverage report. Requirements are listed as covered, available if you
  swap, or things coursework cannot give you.
- Claim coursework can supply experience. "3 years of production experience" and
  "shipped ML systems at scale" land in `courseworkCannotGive` on purpose, and
  the relevance prompt is explicitly instructed never to match an ask about
  experience rather than knowledge.
- Fetch anything at request time. Catalogs are committed and dated. When a
  university edits a page, this data is stale until somebody re runs the ingest,
  and `retrievedAt` on screen is what tells the student how stale.
- Tell you whether to take a lighter term, drop out, switch majors, or take the
  job. It allocates the slack in a schedule against a stated target. Everything
  else is yours.
