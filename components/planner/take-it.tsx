"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, Check, Copy, ListChecks, Mail, Printer, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { Course, Plan } from "@/lib/types";
import type { FilledTerm } from "@/lib/solver";

/**
 * The plan, taken off this page.
 *
 * None of the moments where a plan matters happen in a browser tab, and none of
 * them start with a file download either. The first version of this emailed a
 * blank "to" line as if the advisor's address were known, downloaded a .md file
 * nobody asked to manage, and produced an .ics whose contents could not be seen
 * or changed before they went into a calendar. Everything here now opens as a
 * popup you can read and edit, and leaves through the clipboard or a calendar
 * link, which are the two ways students actually move text.
 */
export function TakeIt({
  plan, courses, names, fill,
}: {
  plan: Plan;
  courses: Map<string, Course>;
  names: string[];
  fill: Map<number, FilledTerm>;
}) {
  const [open, setOpen] = useState<"advisor" | "checklist" | "calendar" | null>(null);
  const [perCredit, setPerCredit] = useState("");

  const byTerm = useMemo(() => (t: number) => {
    const major = plan.placements.filter((p) => p.term === t)
      .map((p) => courses.get(p.courseId)).filter((c): c is Course => Boolean(c));
    const extra = (fill.get(t)?.picks ?? [])
      .map((o) => courses.get(o.courseId)).filter((c): c is Course => Boolean(c));
    return [...major, ...extra];
  }, [plan, courses, fill]);

  const advisorItems = plan.placements.flatMap((p) => {
    const c = courses.get(p.courseId);
    return p.unverifiableText.map((t) => `${c?.code ?? p.courseId}: "${t}"`);
  });

  const advisorText = useMemo(() => [
    "Hello,",
    "",
    `I have planned my remaining ${plan.termCredits.length} semesters and would like to check a few conditions the catalog attaches to courses I picked:`,
    "",
    ...advisorItems.map((a) => `- ${a}`),
    "",
    "My planned courses, in order:",
    ...Array.from({ length: plan.termCredits.length }, (_, t) => {
      const cs = byTerm(t);
      return cs.length ? `${names[t] ?? `Semester ${t + 1}`}: ${cs.map((c) => c.code).join(", ")}` : "";
    }).filter(Boolean),
    "",
    "Could we go over these? Thank you.",
  ].join("\n"), [plan, names, byTerm, advisorItems]);

  const checklistText = useMemo(() => {
    const out: string[] = [];
    for (let t = 0; t < plan.termCredits.length; t++) {
      const cs = byTerm(t);
      if (!cs.length) continue;
      out.push(`${names[t] ?? `Semester ${t + 1}`}`);
      for (const c of cs) out.push(`  [ ] ${c.code}  ${c.title}  (${c.credits} cr)`);
      out.push("");
    }
    if (advisorItems.length) out.push("Ask an advisor:", ...advisorItems.map((a) => `  [ ] ${a}`));
    return out.join("\n");
  }, [plan, names, byTerm, advisorItems]);

  const price = Number(perCredit);
  const cost = price > 0 ? price * plan.totalCredits : null;

  const btn = "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-[var(--blue)] hover:text-foreground";

  return (
    <span className="no-print inline-flex flex-wrap items-center gap-1.5">
      <button className={btn} onClick={() => setOpen("advisor")}
              title="A note you can read, edit and copy into an email or a message to your advisor">
        <Mail className="h-3 w-3" aria-hidden /> Advisor note
      </button>
      <button className={btn} onClick={() => setOpen("checklist")}
              title="The plan as a checklist you can copy anywhere">
        <ListChecks className="h-3 w-3" aria-hidden /> Checklist
      </button>
      <button className={btn} onClick={() => setOpen("calendar")}
              title="One registration reminder per semester, editable, straight into your calendar">
        <CalendarPlus className="h-3 w-3" aria-hidden /> Reminders
      </button>
      <button className={btn} onClick={() => window.print()}
              title="Print it, or save it as a PDF from the print dialog">
        <Printer className="h-3 w-3" aria-hidden /> Print
      </button>
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        $
        <input
          value={perCredit}
          onChange={(e) => setPerCredit(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="per credit"
          className="w-14 rounded border border-border bg-white px-1 py-0.5 text-[11px] outline-none focus:border-[var(--blue)]"
          aria-label="Tuition per credit in dollars"
        />
        {cost !== null && <span className="tabular">≈ ${Math.round(cost).toLocaleString("en-US")} tuition</span>}
      </span>

      {open === "advisor" && (
        <TextModal
          title="A note for your advisor"
          note="Nobody knows your advisor's address but you, so nothing is sent from here. Edit it, copy it, paste it wherever you talk to them."
          initial={advisorText}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "checklist" && (
        <TextModal
          title="The plan as a checklist"
          note="Copy it into notes, a doc, or a message to yourself."
          initial={checklistText}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "calendar" && (
        <CalendarModal plan={plan} names={names} byTerm={byTerm} onClose={() => setOpen(null)} />
      )}
    </span>
  );
}

/** A popup with editable text and one Copy button. */
function TextModal({ title, note, initial, onClose }: {
  title: string; note: string; initial: string; onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-white p-4 shadow-xl"
           onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{title}</p>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mt-2 min-h-[16rem] flex-1 resize-y rounded-lg border border-border p-2 font-mono text-xs leading-relaxed outline-none focus:border-[var(--blue)]"
        />
        <button
          onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
          className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white"
          style={{ background: "var(--blue)" }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy it"}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One reminder per semester, every field editable, each row a real calendar
 * link. Google's event template is a plain URL, so "connect to a calendar"
 * needs no account, no API and no file: the event opens prefilled and the
 * student presses save. The .ics download stays as a footer link for Apple and
 * Outlook people.
 */
function CalendarModal({ plan, names, byTerm, onClose }: {
  plan: Plan; names: string[]; byTerm: (t: number) => Course[]; onClose: () => void;
}) {
  const firstDate = (label: string) => {
    const year = label.match(/(20\d\d)/)?.[1] ?? "2026";
    const month = /Fall/i.test(label) ? "09" : /Summer/i.test(label) ? "06" : "01";
    return `${year}-${month}-01`;
  };
  const [rows, setRows] = useState(() =>
    Array.from({ length: plan.termCredits.length }, (_, t) => {
      const cs = byTerm(t);
      const label = names[t] ?? `Semester ${t + 1}`;
      return {
        on: cs.length > 0,
        date: firstDate(label),
        title: `Register for ${label}`,
        details: cs.map((c) => `${c.code} ${c.title}`).join(", "),
      };
    }).filter((r) => r.on),
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const gcal = (r: { date: string; title: string; details: string }) => {
    const d = r.date.replace(/-/g, "");
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(r.title)}&dates=${d}/${d}&details=${encodeURIComponent(r.details)}`;
  };
  const ics = () => {
    const esc = (x: string) => x.replace(/([,;\\])/g, "\\$1");
    const ev = rows.map((r, i) => [
      "BEGIN:VEVENT", `UID:jd-to-course-${i}@local`,
      `DTSTART;VALUE=DATE:${r.date.replace(/-/g, "")}`,
      `SUMMARY:${esc(r.title)}`, `DESCRIPTION:${esc(r.details)}`, "END:VEVENT",
    ].join("\r\n")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//jd-to-course//EN\r\n${ev}\r\nEND:VCALENDAR`], { type: "text/calendar" }));
    const a = document.createElement("a"); a.href = url; a.download = "course-plan.ics"; a.click();
    URL.revokeObjectURL(url);
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-white p-4 shadow-xl"
           onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Registration reminders">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Registration reminders</p>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4 text-muted-foreground" /></button>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Dates default to the usual start of term, because the bulletin does not publish
          registration dates. Change anything, then add each one to your calendar.
        </p>
        <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i} className="rounded-lg border border-border p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <input type="date" value={r.date}
                       onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, date: e.target.value } : x))}
                       className="rounded border border-border px-1 py-0.5 text-[11px]" />
                <input value={r.title}
                       onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                       className="min-w-0 flex-1 rounded border border-border px-1.5 py-0.5 text-xs" />
                <a href={gcal(r)} target="_blank" rel="noreferrer"
                   className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white" style={{ background: "var(--blue)" }}>
                  Google Calendar
                </a>
              </div>
              <textarea value={r.details}
                        onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, details: e.target.value } : x))}
                        className="mt-1 w-full resize-y rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground" rows={2} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Apple or Outlook person?{" "}
          <button onClick={ics} className="underline">download these as an .ics file</button>{" "}
          and open it there.
        </p>
      </div>
    </div>,
    document.body,
  );
}
