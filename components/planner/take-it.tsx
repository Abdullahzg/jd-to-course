"use client";

import { useState } from "react";
import { CalendarPlus, Download, Mail, Printer } from "lucide-react";
import type { Course, Plan } from "@/lib/types";
import type { FilledTerm } from "@/lib/solver";

/**
 * The plan, taken off this page.
 *
 * Everything above this line lives in a browser tab, and none of the moments
 * where the plan matters happen in one: registration day, the advising
 * appointment, the phone in the queue outside the registrar. Each button here
 * turns the plan into the thing that moment needs, and every one of them works
 * entirely in this file, with no key and no network.
 */
export function TakeIt({
  plan, courses, names, fill,
}: {
  plan: Plan;
  courses: Map<string, Course>;
  /** semester display names, "Fall 2026" */
  names: string[];
  fill: Map<number, FilledTerm>;
}) {
  const [perCredit, setPerCredit] = useState("");

  const byTerm = (t: number) => {
    const major = plan.placements.filter((p) => p.term === t)
      .map((p) => courses.get(p.courseId)).filter((c): c is Course => Boolean(c));
    const extra = (fill.get(t)?.picks ?? [])
      .map((o) => courses.get(o.courseId)).filter((c): c is Course => Boolean(c));
    return [...major, ...extra];
  };

  /** The questions an advisor can actually answer, gathered from the plan. */
  const advisorItems = plan.placements.flatMap((p) => {
    const c = courses.get(p.courseId);
    return p.unverifiableText.map((t) => `${c?.code ?? p.courseId}: "${t}"`);
  });

  const asMarkdown = () => {
    const out: string[] = [`# Course plan, ${plan.termCredits.length} semesters`, ""];
    for (let t = 0; t < plan.termCredits.length; t++) {
      const cs = byTerm(t);
      if (!cs.length) continue;
      out.push(`## ${names[t] ?? `Semester ${t + 1}`}`);
      for (const c of cs) out.push(`- [ ] ${c.code} ${c.title} (${c.credits} cr)`);
      out.push("");
    }
    if (advisorItems.length) {
      out.push("## Ask an advisor", ...advisorItems.map((a) => `- [ ] ${a}`), "");
    }
    return out.join("\n");
  };

  const save = (name: string, mime: string, body: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * One calendar event per semester, dated to the first of the month the term
   * usually starts. Approximate on purpose: the bulletin does not publish
   * registration dates, and a reminder a week early costs nothing while a
   * fabricated exact date would be a lie with a timestamp.
   */
  const asCalendar = () => {
    const esc = (x: string) => x.replace(/([,;\\])/g, "\\$1");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//jd-to-course//EN"];
    for (let t = 0; t < plan.termCredits.length; t++) {
      const label = names[t] ?? `Semester ${t + 1}`;
      const year = label.match(/(20\d\d)/)?.[1];
      if (!year) continue;
      const month = /Fall/i.test(label) ? "09" : /Summer/i.test(label) ? "06" : "01";
      const cs = byTerm(t);
      if (!cs.length) continue;
      lines.push(
        "BEGIN:VEVENT",
        `UID:jd-to-course-term-${t}@local`,
        `DTSTART;VALUE=DATE:${year}${month}01`,
        `SUMMARY:${esc(`Register for ${label}`)}`,
        `DESCRIPTION:${esc(cs.map((c) => `${c.code} ${c.title}`).join(", "))}`,
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  };

  const mailAdvisor = () => {
    const body = [
      "Hello,",
      "",
      `I have planned my remaining ${plan.termCredits.length} semesters and would like to check a few things the catalog attaches to courses I picked:`,
      "",
      ...advisorItems.slice(0, 12).map((a) => `- ${a}`),
      advisorItems.length > 12 ? `and ${advisorItems.length - 12} more.` : "",
      "",
      "My planned courses, in order:",
      ...Array.from({ length: plan.termCredits.length }, (_, t) => {
        const cs = byTerm(t);
        return cs.length ? `${names[t] ?? `Semester ${t + 1}`}: ${cs.map((c) => c.code).join(", ")}` : "";
      }).filter(Boolean),
      "",
      "Could we go over these? Thank you.",
    ].join("\n");
    // mailto URLs are dropped by mail clients past a couple of thousand
    // characters, silently. Better a truncated body than no draft at all.
    window.location.href = `mailto:?subject=${encodeURIComponent("My course plan, a few catalog conditions to check")}&body=${encodeURIComponent(body).slice(0, 1800)}`;
  };

  const price = Number(perCredit);
  const cost = price > 0 ? price * plan.totalCredits : null;

  const btn = "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-[var(--blue)] hover:text-foreground";

  return (
    <div className="no-print mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <button className={btn} onClick={mailAdvisor} title="Opens a draft in your mail app with the plan and the exact catalog conditions worth asking about">
        <Mail className="h-3 w-3" aria-hidden /> Email your advisor
      </button>
      <button className={btn} onClick={() => save("course-plan.md", "text/markdown", asMarkdown())}
              title="A semester by semester checklist you can tick off">
        <Download className="h-3 w-3" aria-hidden /> Checklist
      </button>
      <button className={btn} onClick={() => save("course-plan.ics", "text/calendar", asCalendar())}
              title="One reminder per semester, listing what to register for. Dates are the usual start of term, not official ones">
        <CalendarPlus className="h-3 w-3" aria-hidden /> Calendar reminders
      </button>
      <button className={btn} onClick={() => window.print()} title="Print it, or save it as a PDF from the print dialog">
        <Printer className="h-3 w-3" aria-hidden /> Print or PDF
      </button>
      <span className="ml-1 inline-flex items-center gap-1">
        at $
        <input
          value={perCredit}
          onChange={(e) => setPerCredit(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="per credit"
          className="w-16 rounded border border-border bg-white px-1 py-0.5 text-[11px] outline-none focus:border-[var(--blue)]"
          aria-label="Tuition per credit in dollars"
        />
        {cost !== null && (
          <span className="tabular">
            this plan is about ${Math.round(cost).toLocaleString("en-US")} of tuition
          </span>
        )}
      </span>
    </div>
  );
}
