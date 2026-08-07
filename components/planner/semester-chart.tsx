"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Course, Plan } from "@/lib/types";
import type { FilledTerm } from "@/lib/solver";
import { WhatIsIt } from "./what-is-it";

/**
 * The whole degree on one screen.
 *
 * Before this, seeing what a plan actually contained meant scrolling through
 * eight tall cards, and by the fourth semester you had lost the first. A plan
 * is a timetable, and a timetable wants to be read across, so this lays the
 * semesters out side by side with nothing in each column but course names.
 *
 * It is deliberately not interactive beyond picking a column. Everything you
 * can DO to a course lives further down the page, on the full card, with the
 * evidence attached. This is the map, not the controls.
 */
export function SemesterChart({
  names, plan, courses, fill, onJump,
}: {
  names: string[];
  plan: Plan;
  courses: Map<string, Course>;
  fill: Map<number, FilledTerm>;
  /** Jump to a semester, or to one specific course inside it. */
  onJump: (term: number, courseId?: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);

  // How many other courses the solver found for the same requirement. The chart
  // had no idea these existed, so a course with six alternatives looked exactly
  // like one with none, and the only way to discover the choice was to scroll
  // down and open every card in turn.
  const alternatives = new Map(
    plan.slotChoices.map((sc) => [sc.chosen, sc.alternatives.length]),
  );

  return (
    <section className="rounded-2xl border plan-edge bg-card glow overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b plan-edge plan-wash px-4 py-2">
        <p className="text-sm font-semibold">The whole degree</p>
        <p className="text-xs text-muted-foreground">
          Click any course to jump to it. A <span className="font-medium plan-accent">+n</span> means
          the solver found other courses that fit the same slot.
        </p>
        <p className="text-xs text-muted-foreground">
          {plan.totalCredits} major credits over {names.length} semesters. Glowing courses were picked for this job.
        </p>
      </div>

      <div className="scroll-x overflow-x-auto">
        <div className="flex min-w-max divide-x divide-[color:var(--border)]">
          {names.map((name, t) => {
            const major = plan.placements.filter((p) => p.term === t);
            const extra = fill.get(t)?.picks ?? [];
            const forJob = major.filter((p) => p.covers.length).length + extra.filter((e) => e.teaches.length).length;
            const credits = (plan.termCredits[t] ?? 0) + (plan.openCreditsNeeded[t] ?? 0);
            const on = open === t;
            return (
              <div
                key={name}
                className={`w-[168px] shrink-0 p-2.5 align-top transition-colors ${
                  on ? "plan-wash" : ""
                }`}
              >
                <button
                  onClick={() => { setOpen(on ? null : t); onJump(t); }}
                  className="flex w-full items-baseline justify-between gap-1 text-left"
                >
                  <span className="text-xs font-semibold">{name}</span>
                  <span className="tabular text-[10px] text-muted-foreground">{credits} cr</span>
                </button>
                {forJob > 0 && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ background: "color-mix(in oklab, var(--teal) 14%, transparent)", color: "var(--teal)" }}>
                    <Sparkles className="h-2.5 w-2.5" />{forJob} for this job
                  </span>
                )}

                <ul className="mt-1.5 space-y-1">
                  {major.map((p) => {
                    const c = courses.get(p.courseId);
                    if (!c) return null;
                    const hit = p.covers.length > 0;
                    return (
                      <li
                        key={p.courseId}
                        data-course={p.courseId}
                        className={`flex items-start gap-1 rounded pr-1.5 text-[11px] leading-snug transition-all hover:ring-2 hover:ring-[var(--accent,var(--blue))] focus-within:ring-2 focus-within:ring-[var(--accent,var(--blue))] ${
                          hit ? "match-1 bg-white" : "bg-foreground/[0.03]"
                        }`}
                      >
                        <button
                          onClick={() => onJump(t, p.courseId)}
                          aria-label={
                            (alternatives.get(p.courseId) ?? 0) > 0
                              ? `${c.title}. ${alternatives.get(p.courseId)} other course${alternatives.get(p.courseId) === 1 ? "" : "s"} fit this same requirement. Jump to it to see them.`
                              : `${c.title}. Jump to it.`
                          }
                          className={`min-w-0 flex-1 py-1 pl-1.5 text-left ${hit ? "font-medium" : ""}`}
                        >
                          {c.title}
                        </button>
                        <span className="flex shrink-0 items-center gap-1 self-center">
                          <WhatIsIt course={c} align="right" />
                          {(alternatives.get(p.courseId) ?? 0) > 0 && (
                            <span
                              className="tabular rounded px-1 text-[9px] font-semibold plan-accent"
                              style={{ background: "var(--blue-soft)" }}
                            >
                              +{alternatives.get(p.courseId)}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                  {extra.map((e) => (
                    <li
                      key={e.courseId}
                      data-course={e.courseId}
                      className={`flex items-start gap-1 rounded pr-1.5 text-[11px] leading-snug transition-all hover:ring-2 hover:ring-[var(--accent,var(--blue))] focus-within:ring-2 focus-within:ring-[var(--accent,var(--blue))] ${
                        e.teaches.length ? "match-1 bg-white font-medium" : "bg-foreground/[0.02] text-muted-foreground"
                      }`}
                    >
                      <button
                        onClick={() => onJump(t, e.courseId)}
                        aria-label={`${e.title}. Jump to it.`}
                        className="min-w-0 flex-1 py-1 pl-1.5 text-left"
                      >
                        {e.title}
                        {!e.teaches.length && (
                          <span className="ml-1 text-[9px] opacity-60">fills credits</span>
                        )}
                      </button>
                      <WhatIsIt course={courses.get(e.courseId)} align="right" />
                    </li>
                  ))}
                  {!major.length && !extra.length && (
                    <li className="px-1.5 py-1 text-[11px] text-muted-foreground">nothing scheduled</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
