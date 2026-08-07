"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";
import type { Course } from "@/lib/types";

/**
 * What is this course, actually.
 *
 * Every row on the plan page was a title and a verdict. A student looking at
 * "Scientific Computation" or "System-on-Chip Platforms" had no way to find out
 * what either one is without leaving for the bulletin, which is a strange thing
 * to demand of a page whose whole argument rests on those descriptions.
 *
 * The card is rendered into the document body rather than beside the question
 * mark. Sitting in the normal flow it was laid out inside the semester chart,
 * whose section is `overflow-hidden` and whose track is a horizontal scroller,
 * and an absolutely positioned box is clipped by any ancestor that clips. No
 * z-index can lift a box out of an overflow clip, so the description was cut
 * off mid sentence by the edge of the panel. A portal is also the only way this
 * survives the `glow-hover` cards on the plan page: they apply a transform on
 * hover, and a transformed ancestor becomes the containing block even for
 * `position: fixed`, which would put the card in the wrong place entirely.
 */
const GAP = 8;
const WIDTH = 360;

type Spot = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

export function WhatIsIt({ course, align = "left" }: { course?: Course; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<Spot | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(WIDTH, vw - 16);
    // Keep it on screen horizontally whichever side it was asked to sit on.
    const raw = align === "right" ? r.right - width : r.left;
    const left = Math.max(8, Math.min(raw, vw - width - 8));

    const below = vh - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    // Flip up when there is more room up there. maxHeight is the measured room
    // and never more, because a card taller than its own side is the same
    // clipping bug one layer out.
    return below >= 200 || below >= above
      ? setSpot({ left, width, top: r.bottom + GAP, maxHeight: Math.max(below, 0) })
      : setSpot({ left, width, bottom: vh - r.top + GAP, maxHeight: Math.max(above, 0) });
  }, [align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // The chart scrolls sideways and the plan rail scrolls down, so the anchor
    // can move while the card is open. `true` catches those inner scrollers,
    // not just the window.
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  if (!course) return null;

  const terms = course.termsOffered
    .map((t) => (t === "FA" ? "Fall" : t === "SP" ? "Spring" : "Summer"))
    .join(" and ");

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`What is ${course.title}`}
        aria-expanded={open}
        className="shrink-0 text-muted-foreground transition-colors hover:text-[var(--blue)]"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>

      {open && spot && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="fade-up pointer-events-auto fixed overflow-y-auto rounded-xl border border-border bg-white p-3 text-left shadow-xl"
          style={{
            left: spot.left,
            width: spot.width,
            top: spot.top,
            bottom: spot.bottom,
            maxHeight: spot.maxHeight,
            // Under the money bar, which is z-50 and deliberately always visible,
            // and under the Ask drawer for the same reason.
            zIndex: 45,
          }}
        >
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-semibold">{course.title}</span>
            <span className="code text-[11px]">{course.code}</span>
            <span className="tabular text-[11px] text-muted-foreground">{course.credits} cr</span>
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {course.description || "The bulletin publishes no description for this course."}
          </p>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Taught in {terms}.{" "}
            <a
              href={course.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
              onClick={(e) => e.stopPropagation()}
            >
              Read {course.code} in the catalog
            </a>
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}
