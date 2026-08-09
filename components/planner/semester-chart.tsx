"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Sparkles, Waypoints } from "lucide-react";
import type { Course, Plan } from "@/lib/types";
import type { FilledTerm } from "@/lib/solver";
import { prereqSteps } from "@/lib/solver/core";
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
  names, plan, courses, fill, completed = [], onJump,
}: {
  names: string[];
  plan: Plan;
  courses: Map<string, Course>;
  fill: Map<number, FilledTerm>;
  /**
   * Courses the student has already passed, as `state.student.completed`.
   *
   * A prerequisite met by one of these has no cell on this board, so it is
   * counted beside the toggle rather than drawn: an arrow pointing off the edge
   * of the chart says nothing. Optional only so this file does not dictate when
   * the page wires it. Left unpassed, every course whose prerequisites the
   * student finished before the plan begins looks unmet, and its arrows and its
   * count both go missing.
   */
  completed?: string[];
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

  // ── prerequisite arrows ───────────────────────────────────────────────────
  // Off by default. The board is a timetable first, and the reason a course
  // sits where it sits is a second question, asked only when you want it.
  // On by default. Off, the feature answered a question nobody had asked yet;
  // on, pointing at any course shows its chain with no setup step, which is
  // what was asked for in the first place.
  const [arrowsOn, setArrowsOn] = useState(true);
  /**
   * Which course the arrows are about.
   *
   * Drawing every edge at once put eighteen curves across eight columns and
   * they crossed each other, so the board was harder to read with them on than
   * off. A student asking about prerequisites is asking about ONE course, so
   * pointing at a course draws only its own chain and dims the rest. Nothing
   * overlaps because nothing else is drawn.
   */
  const [focus, setFocus] = useState<string | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  // useId's value contains colons, which are not legal inside url(#...).
  const markerId = `prereq-arrow-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // Every course with a cell on this board and the column it sits in. The page
  // rebuilds `fill` on every one of its own renders, so a memo keyed on those
  // objects would be no memo at all, and re-measuring the whole overlay every
  // time an unrelated bit of the page changed is visible as a flicker. Keyed on
  // what the board actually is instead, which is why the work below reads its
  // cells back out of the signature rather than closing over the map.
  const board = new Map<string, number>();
  for (const p of plan.placements) board.set(p.courseId, p.term);
  for (const f of fill.values()) for (const pick of f.picks) board.set(pick.courseId, f.term);
  const boardKey = [...board].map(([id, t]) => `${id}@${t}`).join(",");
  const completedKey = completed.join(",");

  const wiring = useMemo(() => {
    const cells = new Map<string, number>();
    for (const entry of boardKey ? boardKey.split(",") : []) {
      const at = entry.lastIndexOf("@");
      cells.set(entry.slice(0, at), Number(entry.slice(at + 1)));
    }
    const done = new Set(completedKey ? completedKey.split(",") : []);

    const links: { from: string; to: string }[] = [];
    /** Prerequisites met by coursework already finished, so nothing to draw. */
    let alreadyDone = 0;
    /** Courses whose rule is catalog wording that names no course at all. */
    let onWording = 0;

    for (const [courseId, term] of cells) {
      const prereq = courses.get(courseId)?.prereq;
      if (!prereq) continue;
      // Only what the student can have passed by the time this course starts.
      // Judging against the whole board would let a course in the same column
      // satisfy one beside it and draw an arrow backwards through the term.
      const have = new Set(done);
      for (const [other, otherTerm] of cells) if (otherTerm < term) have.add(other);

      // prereqSatisfied would only say yes. This says which branch said yes,
      // which is the entire question the arrows are answering.
      const steps = prereqSteps(prereq, have);
      if (!steps) continue;

      let carried = false;
      for (const s of steps) {
        for (const v of s.via) {
          carried = true;
          if (cells.has(v)) links.push({ from: v, to: courseId });
          else alreadyDone++;
        }
      }
      // The tree passed on wording alone: "or the instructor's permission" and
      // nothing else. The solver treats that as satisfied, so without this the
      // student would never learn a course rests on a conversation they have
      // not had.
      if (!carried && steps.some((s) => s.assumed.length)) onWording++;
    }
    return { links, alreadyDone, onWording };
  }, [boardKey, completedKey, courses]);

  const [arrows, setArrows] = useState<{ key: string; d: string; from: string; to: string }[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });

  /**
   * The edges actually drawn: the ones touching whatever is being pointed at.
   *
   * With all of them on screen the board carried eighteen crossing curves and
   * was harder to read than with the feature off. One course's chain is what a
   * student is asking about, and one chain does not overlap itself.
   */
  /** Course ids on the focused chain, used to fade everything else. */
  const lit = useMemo(() => {
    if (!focus) return null;
    const set = new Set<string>([focus]);
    for (const a of arrows) {
      if (a.from === focus) set.add(a.to);
      if (a.to === focus) set.add(a.from);
    }
    // Nothing to point at, so nothing to point away from. Fading the whole
    // board around a course with no prerequisites on it made the interface look
    // broken: everything went grey and no arrow ever appeared.
    return set.size > 1 ? set : null;
  }, [arrows, focus]);

  const shown = useMemo(
    () => (focus ? arrows.filter((a) => a.from === focus || a.to === focus) : []),
    [arrows, focus],
  );

  useEffect(() => {
    if (!arrowsOn) { setArrows([]); return; }
    const track = trackRef.current;
    if (!track) return;

    const r = (n: number) => Math.round(n * 10) / 10;

    const measure = () => {
      const base = track.getBoundingClientRect();
      const next: { key: string; d: string; from: string; to: string }[] = [];
      for (const { from, to } of wiring.links) {
        const a = track.querySelector(`[data-course="${from}"]`);
        const b = track.querySelector(`[data-course="${to}"]`);
        if (!a || !b) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        // Measured against the track, not the viewport, so the paths stay put
        // while the columns scroll underneath the section.
        const x1 = ra.right - base.left;
        const y1 = ra.top + ra.height / 2 - base.top;
        const x2 = rb.left - base.left - 4; // short of the cell, so the head shows
        const y2 = rb.top + rb.height / 2 - base.top;
        const bend = Math.max(20, (x2 - x1) * 0.45);
        next.push({
          key: `${from}->${to}`,
          d: `M ${r(x1)} ${r(y1)} C ${r(x1 + bend)} ${r(y1)}, ${r(x2 - bend)} ${r(y2)}, ${r(x2)} ${r(y2)}`,
          from,
          to,
        });
      }
      setArrows(next);
      setBox({ w: base.width, h: base.height });
    };

    measure();
    // Columns are sized by their content, so a webfont arriving late moves
    // every row under it and each row is one end of an arrow. Watching the
    // track catches that, along with any later reflow.
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    let live = true;
    void document.fonts?.ready.then(() => { if (live) measure(); });
    return () => { live = false; ro.disconnect(); };
  }, [arrowsOn, wiring]);

  const showArrowRow = wiring.links.length > 0 || wiring.alreadyDone > 0 || wiring.onWording > 0;

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

        {showArrowRow && (
          <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
            {wiring.links.length > 0 && (
              <button
                type="button"
                onClick={() => setArrowsOn((v) => !v)}
                aria-pressed={arrowsOn}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  arrowsOn
                    ? "plan-edge plan-accent font-medium"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
                style={arrowsOn ? { background: "var(--wash, transparent)" } : undefined}
              >
                <Waypoints className="h-3 w-3" aria-hidden />
                {arrowsOn ? "Hide" : "Show"} prerequisites
                <span className="tabular">({wiring.links.length})</span>
              </button>
            )}
            {arrowsOn && (
              <span className="text-[11px] text-muted-foreground">
                Point at a course to see what it needs first.
              </span>
            )}
            {wiring.alreadyDone > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {wiring.alreadyDone} more {wiring.alreadyDone === 1 ? "prerequisite is a course" : "prerequisites are courses"}{" "}
                you have already taken, so there is no cell here to point at.
              </span>
            )}
            {wiring.onWording > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {wiring.onWording} {wiring.onWording === 1 ? "course rests" : "courses rest"} on catalog
                wording rather than a named course, so an advisor has to confirm{" "}
                {wiring.onWording === 1 ? "it" : "them"}.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="scroll-x overflow-x-auto">
        {/* The overlay lives inside the track, so it scrolls with the columns
            instead of hanging over a fixed viewport while they move. */}
        <div ref={trackRef} className="relative flex min-w-max divide-x divide-[color:var(--border)]">
          {names.map((name, t) => {
            const major = plan.placements.filter((p) => p.term === t);
            const extra = fill.get(t)?.picks ?? [];
            const forJob = major.filter((p) => p.covers.length).length + extra.filter((e) => e.teaches.length).length;
            const credits = (plan.termCredits[t] ?? 0) + (plan.openCreditsNeeded[t] ?? 0);
            // Three or more 4000 level courses in one term is a semester
            // advisors warn people about, and nothing on the board said so. A
            // count, not a judgement: the student decides if they are that
            // student, the board just refuses to hide it.
            const heavy = [...major.map((p) => p.courseId), ...extra.map((e) => e.courseId)]
              .map((id) => parseInt(courses.get(id)?.code.replace(/[^0-9]/g, "") ?? "0", 10))
              .filter((n) => n >= 4000).length;
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
                {heavy >= 3 && (
                  <span className="mt-1 block text-[10px]" style={{ color: "var(--amber)" }}
                        title="Advanced courses carry heavier reading and project loads. Spreading them out is usually kinder">
                    {heavy} courses at the 4000 level
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
                        onMouseEnter={() => arrowsOn && setFocus(p.courseId)}
                        onMouseLeave={() => arrowsOn && setFocus(null)}
                        onFocusCapture={() => arrowsOn && setFocus(p.courseId)}
                        className={`flex items-start gap-1 rounded pr-1.5 text-[11px] leading-snug transition-all hover:ring-2 hover:ring-[var(--accent,var(--blue))] focus-within:ring-2 focus-within:ring-[var(--accent,var(--blue))] ${
                          hit ? "match-1 bg-white" : "bg-foreground/[0.03]"
                        } ${lit && !lit.has(p.courseId) ? "opacity-25" : ""}`}
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
                          <WhatIsIt course={c} align="right" reason={p.covers.map((x) => x.skill)} />
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
                      onMouseEnter={() => arrowsOn && setFocus(e.courseId)}
                      onMouseLeave={() => arrowsOn && setFocus(null)}
                      onFocusCapture={() => arrowsOn && setFocus(e.courseId)}
                      className={`flex items-start gap-1 rounded pr-1.5 text-[11px] leading-snug transition-all hover:ring-2 hover:ring-[var(--accent,var(--blue))] focus-within:ring-2 focus-within:ring-[var(--accent,var(--blue))] ${
                        e.teaches.length ? "match-1 bg-white font-medium" : "bg-foreground/[0.02] text-muted-foreground"
                      } ${lit && !lit.has(e.courseId) ? "opacity-25" : ""}`}
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
                      <WhatIsIt course={courses.get(e.courseId)} align="right" reason={e.teaches} />
                    </li>
                  ))}
                  {!major.length && !extra.length && (
                    <li className="px-1.5 py-1 text-[11px] text-muted-foreground">nothing scheduled</li>
                  )}
                </ul>
              </div>
            );
          })}

          {arrowsOn && shown.length > 0 && (
            <svg
              className="pointer-events-none absolute left-0 top-0"
              width={box.w}
              height={box.h}
              aria-hidden
            >
              <defs>
                <marker
                  id={markerId}
                  viewBox="0 0 8 8"
                  refX="6.5"
                  refY="4"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--accent, var(--blue))" opacity={0.85} />
                </marker>
              </defs>
              {shown.map((a) => (
                <path
                  key={a.key}
                  d={a.d}
                  fill="none"
                  stroke="var(--accent, var(--blue))"
                  strokeOpacity={0.75}
                  strokeWidth={1.75}
                  markerEnd={`url(#${markerId})`}
                />
              ))}
            </svg>
          )}
        </div>
      </div>
    </section>
  );
}
