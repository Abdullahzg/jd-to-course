"use client";

import { useMemo, useState } from "react";
import { ArrowDown, Search } from "lucide-react";
import type { Course, Plan, RequirementBucket } from "@/lib/types";
import { WhatIsIt } from "./what-is-it";

/**
 * What this panel has to know to answer "can I take this one".
 *
 * The course list alone is not enough: whether a course can fill a requirement
 * is a property of the degree, not of the course, and whether the student has
 * already passed it decides whether asking for it means anything at all. The
 * solver drops completed courses from every pool, so a request for one comes
 * back as "no plan fits", which is a confusing answer to a reasonable question.
 */
export type FinderCatalog = {
  /** every course this school publishes, which is what the box searches */
  courses: Course[];
  /** the degree's requirements, with the eligible lists that decide what counts */
  buckets: RequirementBucket[];
  /** ids the student has already passed */
  completed: string[];
};

/** Enough to scroll, few enough that the browser is not laying out the bulletin. */
const MAX_ROWS = 40;

function seasonWords(c: Course): string {
  const words = c.termsOffered.map((t) => (t === "FA" ? "Fall" : t === "SP" ? "Spring" : "Summer"));
  return words.length ? words.join(" and ") : "no semester the bulletin names";
}

/** Punctuation and spacing differ between what people type and what the bulletin prints. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Does this course answer what was typed.
 *
 * Every word has to appear, in the title or the code, so "advanced software"
 * narrows rather than widens. The code is also tested with the punctuation
 * stripped out, because people type "w4156" and the bulletin prints
 * "COMS W4156". Exported so it can be tested against the real catalog.
 */
export function matchesQuery(course: Course, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = `${course.title} ${course.code}`.toLowerCase();
  const squashed = squash(`${course.code} ${course.title}`);
  return tokens.every((t) => hay.includes(t) || squashed.includes(squash(t)));
}

type Row = {
  course: Course;
  /** requirement labels this course could fill. Empty means free elective credit only. */
  counts: string[];
  /** semester index the plan already puts it in, or null */
  term: number | null;
  passed: boolean;
};

/**
 * Search the whole bulletin and put a named course into the plan.
 *
 * The board only ever offered courses the solver had already reached for: it
 * emits one representative per symmetry class and then stops at six, so
 * Advanced Software Engineering, which is eligible for two of this degree's
 * requirements, could be absent from every menu on the page. There was no way to
 * ask for it. This is that way.
 *
 * Asking adds, it does not replace. Adding is the only mechanism that works
 * here: the swap path rules the incumbent out and re-solves, and that returns no
 * plan whenever the requested course is offered in a season the vacated slot is
 * not, which was measured on COMS W4113.
 */
export function CourseFinder({
  catalog,
  plan,
  courses,
  onKeep,
  onJump,
}: {
  catalog: FinderCatalog;
  plan: Plan;
  /** every course by id, for naming the ones the plan and the solver refer to */
  courses: Map<string, Course>;
  /** put this course in the plan and work the rest out around it */
  onKeep: (courseId: string, label: string) => void;
  /** scroll to a course that is already on the board */
  onJump: (courseId: string) => void;
}) {
  const [q, setQ] = useState("");

  const rows = useMemo<Row[]>(() => {
    const termOf = new Map(plan.placements.map((p) => [p.courseId, p.term] as const));
    const passed = new Set(catalog.completed);

    const built = catalog.courses.map((course) => ({
      course,
      counts: catalog.buckets.filter((b) => b.eligible.includes(course.id)).map((b) => b.label),
      term: termOf.get(course.id) ?? null,
      passed: passed.has(course.id),
    }));

    // The ones you can actually act on first. A student scanning this list is
    // looking for something to add, and a course they have already passed or
    // that fills no requirement is not that.
    const rank = (r: Row) => (r.passed ? 3 : r.term !== null ? 2 : r.counts.length ? 0 : 1);
    return built.sort((a, b) => rank(a) - rank(b) || a.course.code.localeCompare(b.course.code));
  }, [catalog, plan]);

  const hits = rows.filter((r) => matchesQuery(r.course, q));

  /**
   * Courses the solver proved could take the place of one already chosen:
   * identical job skills, credits, semesters offered and prerequisites. On many
   * runs there are none, and the honest thing is to say so rather than to pad
   * the section with courses that differ on something.
   */
  const interchangeable = plan.slotChoices.flatMap((slot) =>
    slot.alternatives
      .filter((a) => a.sameClass)
      .map((a) => ({ id: a.courseId, insteadOf: slot.chosen })),
  );

  return (
    <section className="rounded-3xl border border-border bg-card p-5 glow">
      <h2 className="font-display text-lg font-semibold">Find a course</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every course in the bulletin, including the ones this plan did not pick. Adding one holds it
        in place and works the rest of the plan out around it, so something else may have to go. The
        change summary says what moved, and Undo puts it back.
      </p>

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 transition-colors focus-within:border-[var(--blue)]">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Software engineering, W4156, databases…"
          aria-label="Search every course in the bulletin"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {!!q && (
          <button
            onClick={() => setQ("")}
            className="shrink-0 text-xs text-muted-foreground underline underline-offset-2"
          >
            clear
          </button>
        )}
      </div>

      <p className="tabular mt-2 text-xs text-muted-foreground">
        {hits.length} of {rows.length} courses
        {hits.length > MAX_ROWS && `, showing the first ${MAX_ROWS}. Type more to narrow it.`}
      </p>

      {hits.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing in this catalog matches that. The search reads course titles and codes only.
        </p>
      ) : (
        <ul className="rail-scroll mt-2 max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
          {hits.slice(0, MAX_ROWS).map((r) => (
            <li key={r.course.id} className="rounded-xl border border-border p-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium">{r.course.title}</span>
                <WhatIsIt course={r.course} />
                <span className="code text-xs">{r.course.code}</span>
                <span className="tabular text-xs text-muted-foreground">{r.course.credits} cr</span>
                <span className="text-xs text-muted-foreground">{seasonWords(r.course)}</span>
              </div>

              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {r.passed ? (
                    "You have already passed this one."
                  ) : r.term !== null ? (
                    <>Already in your plan, semester {r.term + 1}.</>
                  ) : r.counts.length ? (
                    <>Would count toward {r.counts.join(" or ")}.</>
                  ) : (
                    // 47 of Columbia's 139 courses are on no requirement list for
                    // this degree. Taking one is allowed, it just does not tick
                    // anything off, so this says that rather than refusing.
                    "On no requirement list for this degree, so it would fill free elective credit rather than a requirement."
                  )}
                </p>

                {r.term !== null ? (
                  <button
                    onClick={() => onJump(r.course.id)}
                    className="shrink-0 rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-[var(--blue-soft)]"
                  >
                    Go to it
                  </button>
                ) : !r.passed && r.counts.length > 0 ? (
                  <button
                    onClick={() => onKeep(r.course.id, r.course.code)}
                    className="shrink-0 rounded-full px-3 py-1 text-xs text-white transition-opacity hover:opacity-90"
                    style={{ background: "var(--blue)" }}
                  >
                    Add to plan
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── courses the solver could not tell apart from ones already chosen ── */}
      <div className="mt-4 border-t border-border pt-3">
        <h3 className="text-sm font-semibold">Equal swaps</h3>
        {interchangeable.length === 0 ? (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The solver could not prove any course interchangeable with one already chosen. Where a
            slot has other courses that fit, each of them differs on something it measures, and they
            are listed under the course itself with what the difference is.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Same job skills, same credits, same semesters, same prerequisites as the course they
              would replace. Nothing the solver measures separates them, so this is a free choice.
            </p>
            <ul className="mt-2 space-y-1.5">
              {interchangeable.map((swap) => {
                const c = courses.get(swap.id);
                const out = courses.get(swap.insteadOf);
                if (!c) return null;
                return (
                  <li
                    key={`${swap.insteadOf}-${swap.id}`}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border border-border p-2.5"
                  >
                    <span className="text-sm font-medium">{c.title}</span>
                    <WhatIsIt course={c} />
                    <span className="code text-xs">{c.code}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowDown className="h-3 w-3" /> in place of {out?.title ?? swap.insteadOf}
                    </span>
                    <button
                      onClick={() => onKeep(c.id, c.code)}
                      className="ml-auto shrink-0 rounded-full border border-border px-3 py-1 text-xs transition-colors hover:bg-[var(--blue-soft)]"
                    >
                      Use this one
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
