"use client";

import type { Course, PrereqNode } from "@/lib/types";

/**
 * What this course needs first, and which of those the plan is actually using.
 *
 * The card used to say only "Its prerequisites were read off the bulletin by a
 * parser, and nobody has checked that reading", and then never showed the
 * reading. COMS W4152 needs three courses and the page named none of them, so
 * there was no way to tell whether the warning mattered or what to check.
 *
 * The other half is the choice. Where the bulletin says "one of these three",
 * the plan picked one, and the student could not tell which. Every course named
 * here is a button that jumps to it, and the one the plan is leaning on is
 * marked.
 */

export type PrereqState = "in plan" | "already done" | "missing";

function nodeCourses(n: PrereqNode | null, out: string[] = []): string[] {
  if (!n) return out;
  if (n.op === "COURSE") out.push(n.courseId);
  else if (n.op === "AND" || n.op === "OR") n.children.forEach((c) => nodeCourses(c, out));
  return out;
}

/** Is this branch met by what the student has or the plan holds. */
function met(n: PrereqNode | null, have: Set<string>): boolean {
  if (!n) return true;
  switch (n.op) {
    case "COURSE": return have.has(n.courseId);
    // The solver treats catalog wording as satisfied, and the interface has to
    // say so rather than quietly inherit it. A plan can rest entirely on the
    // words "or knowledge of Java" with no course behind it at all.
    case "UNVERIFIABLE": return true;
    case "AND": return n.children.every((c) => met(c, have));
    case "OR": return n.children.some((c) => met(c, have));
  }
}

/** One line per requirement, flattening the ANDs the way a student reads them. */
type Line = { need: string[]; using: string[]; wording: string[]; restingOnWords: boolean };

function lines(n: PrereqNode | null, have: Set<string>, out: Line[] = []): Line[] {
  if (!n) return out;
  if (n.op === "AND") { n.children.forEach((c) => lines(c, have, out)); return out; }
  if (n.op === "COURSE") {
    out.push({ need: [n.courseId], using: have.has(n.courseId) ? [n.courseId] : [], wording: [], restingOnWords: false });
    return out;
  }
  if (n.op === "UNVERIFIABLE") {
    out.push({ need: [], using: [], wording: [n.text], restingOnWords: true });
    return out;
  }
  // OR: everything it would accept, and whichever of them the plan really has.
  const need = [...new Set(nodeCourses(n))];
  const using = need.filter((id) => have.has(id));
  const wording = n.children.filter((c) => c.op === "UNVERIFIABLE").map((c) => (c as { text: string }).text);
  out.push({ need, using, wording, restingOnWords: using.length === 0 && met(n, have) });
  return out;
}

export function PrereqList({
  course, courses, planned, completed, onJump,
}: {
  course: Course;
  courses: Map<string, Course>;
  /** course ids the plan holds, at any term */
  planned: Set<string>;
  /** course ids the student has already passed */
  completed: Set<string>;
  onJump: (courseId: string) => void;
}) {
  if (!course.prereq) return null;
  const have = new Set([...planned, ...completed]);
  const rows = lines(course.prereq, have);
  // A tree made only of catalog wording names no course, so there is nothing to
  // list. Printing the heading anyway put "Before this one you need" with
  // nothing under it on 33 of the 98 courses that have a tree at all, which
  // reads as the page telling you there is no prerequisite. The wording is
  // already quoted in the advisor box directly below.
  const named = rows.filter((r) => r.need.length > 0);
  if (!named.length) return null;

  const tag = (id: string, using: boolean) => {
    const c = courses.get(id);
    const here = completed.has(id) || planned.has(id);
    return (
      <button
        key={id}
        onClick={() => here && onJump(id)}
        disabled={!here}
        title={
          completed.has(id)
            ? `${c?.title ?? id}. You have already passed this.`
            : planned.has(id)
              ? `${c?.title ?? id}. In your plan, click to jump to it.`
              : `${c?.title ?? id}. Not in your plan and not in your finished courses.`
        }
        className={`code rounded px-1.5 py-0.5 text-[10px] transition-colors ${
          using
            ? "bg-[color-mix(in_oklab,var(--green,#15803d)_14%,transparent)] font-semibold"
            : here
              ? "bg-foreground/5 hover:bg-[var(--blue-soft)]"
              : "cursor-default text-muted-foreground line-through"
        }`}
      >
        {c?.code ?? id}
      </button>
    );
  };

  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
      <span>Needs first:</span>
      {named.map((r, i) => (
        <span key={i} className="flex flex-wrap items-center gap-1">
          {i > 0 && <span className="text-muted-foreground">and</span>}
          {/* Only the branch the plan is standing on, with the rest counted.
              Listing all five options for a single requirement was most of the
              space this block used and none of the information. */}
          {r.using.length ? r.using.map((id) => tag(id, true)) : r.need.slice(0, 1).map((id) => tag(id, false))}
          {r.need.length > Math.max(1, r.using.length) && (
            <span
              className="text-[10px]"
              title={`Any one of: ${r.need.map((id) => courses.get(id)?.code ?? id).join(", ")}`}
            >
              or {r.need.length - Math.max(1, r.using.length)} other{r.need.length - Math.max(1, r.using.length) === 1 ? "" : "s"}
            </span>
          )}
          {r.restingOnWords && (
            <span style={{ color: "var(--amber)" }} title="The catalog allows a judgement here instead of a course, and your plan is relying on that">
              not covered by your plan
            </span>
          )}
        </span>
      ))}
    </p>
  );
}
