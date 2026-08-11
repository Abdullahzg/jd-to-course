"use client";

import { useEffect, useState } from "react";

/**
 * The tracker, demonstrating itself.
 *
 * Not a video and not a mock: the same visual language as the real /tracker
 * page, running a scripted loop of exactly what the product does, an email
 * arrives, a row updates, the quote that proves it appears. A visitor watches
 * the feature happen before they are asked to believe a word of copy.
 */

type Row = { company: string; role: string; status: string; tone: string };

const START: Row[] = [
  { company: "Stripe", role: "SWE Intern", status: "assessment", tone: "blue" },
  { company: "Figma", role: "Product Engineer", status: "applied", tone: "grey" },
  { company: "NSF REU", role: "ML Research", status: "applied", tone: "grey" },
  { company: "HackMIT", role: "", status: "applied", tone: "grey" },
];

const SCRIPT: { mail: string; from: string; apply: (rows: Row[]) => Row[]; quote: string }[] = [
  {
    from: "Stripe Recruiting",
    mail: "Interview scheduling: SWE Intern",
    quote: "Congratulations, you passed the online assessment.",
    apply: (r) => r.map((x) => (x.company === "Stripe" ? { ...x, status: "interview", tone: "blue" } : x)),
  },
  {
    from: "Greenhouse",
    mail: "Figma: online assessment",
    quote: "Please complete a take home exercise within 5 days.",
    apply: (r) => r.map((x) => (x.company === "Figma" ? { ...x, status: "assessment", tone: "blue" } : x)),
  },
  {
    from: "Databricks",
    mail: "Your Databricks application",
    quote: "We will not be proceeding to the next stage at this time.",
    // The row that did not exist until its rejection arrived: the mechanism
    // on display, not just described.
    apply: (r) => (r.some((x) => x.company === "Databricks")
      ? r
      : [...r, { company: "Databricks", role: "SWE Intern", status: "rejected", tone: "red" }]),
  },
  {
    from: "HackMIT Team",
    mail: "HackMIT decision inside",
    quote: "You have been accepted to HackMIT 2027!",
    apply: (r) => r.map((x) => (x.company === "HackMIT" ? { ...x, status: "accepted", tone: "green" } : x)),
  },
];

const PILL: Record<string, string> = {
  grey: "bg-white/10 text-white/60",
  blue: "bg-sky-400/20 text-sky-300",
  red: "bg-red-400/15 text-red-300",
  green: "bg-emerald-400/20 text-emerald-300",
};

export function TrackerDemo() {
  const [rows, setRows] = useState<Row[]>(START);
  const [step, setStep] = useState(-1);
  const [toast, setToast] = useState<typeof SCRIPT[number] | null>(null);

  useEffect(() => {
    let i = 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const s = SCRIPT[i % SCRIPT.length];
      if (i % SCRIPT.length === 0) setRows(START);
      setToast(s);
      setStep(i % SCRIPT.length);
      window.setTimeout(() => { if (alive) setRows((r) => s.apply(r)); }, 900);
      window.setTimeout(() => { if (alive) setToast(null); }, 2600);
      i++;
    };
    const t0 = window.setTimeout(tick, 1200);
    const iv = window.setInterval(tick, 3600);
    return () => { alive = false; window.clearTimeout(t0); window.clearInterval(iv); };
  }, []);

  return (
    <div className="relative w-full max-w-md">
      {/* the inbox event sliding in */}
      <div
        aria-hidden
        className={`absolute -top-4 right-0 z-10 w-72 rounded-xl border border-white/15 bg-[#12151d] p-3 shadow-2xl transition-all duration-500 ${
          toast ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0"
        }`}
      >
        <p className="text-[10px] uppercase tracking-widest text-white/35">new email</p>
        <p className="mt-0.5 truncate text-xs font-medium text-white/90">{toast?.mail ?? ""}</p>
        <p className="truncate text-[11px] text-white/45">{toast?.from ?? ""}</p>
      </div>

      <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-4 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-white/80">Applications</p>
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] text-emerald-300">
            updating itself
          </span>
        </div>
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.company}
                className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 transition-all duration-500">
              <span className="text-xs font-medium text-white/90">{r.company}</span>
              {r.role && <span className="truncate text-[10px] text-white/40">{r.role}</span>}
              <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors duration-500 ${PILL[r.tone]}`}>
                {r.status}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 min-h-[2rem] border-l-2 border-white/15 pl-2 text-[11px] italic leading-snug text-white/45">
          {step >= 0 ? `"${SCRIPT[step].quote}"` : "every status carries the sentence that proved it"}
        </p>
      </div>
    </div>
  );
}
