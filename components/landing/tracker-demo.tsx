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
  { company: "Columbia University", role: "MS Computer Science", status: "applied", tone: "grey" },
  { company: "Johns Hopkins", role: "MSE Computer Science", status: "applied", tone: "grey" },
  { company: "Dartmouth", role: "MS Computer Science", status: "offer", tone: "green" },
  { company: "NYU Tandon", role: "MS Computer Science", status: "offer", tone: "green" },
  { company: "Mitacs Globalink", role: "Research Internship", status: "applied", tone: "grey" },
  { company: "Knight-Hennessy", role: "Scholars", status: "action needed", tone: "blue" },
  { company: "International House", role: "Gotz Mauser Fellowship", status: "accepted", tone: "green" },
  { company: "Stanford University", role: "MS Computer Science", status: "applied", tone: "grey" },
  { company: "Princeton University", role: "MSE Computer Science", status: "action needed", tone: "blue" },
];

// Every line below is a real row from the owner's tracker, built from their
// real inbox: the same acceptances, offers and rejections a judge sees after
// one click on "use the owner's inbox". The demo stopped inventing companies
// the day the real season became more convincing than fiction.
const SCRIPT: { mail: string; from: string; apply: (rows: Row[]) => Row[]; quote: string }[] = [
  {
    from: "Columbia Engineering",
    mail: "Welcome to the MS in Computer Science",
    quote: "We are delighted to welcome you to Columbia Engineering and the MS in Computer Science.",
    apply: (r) => r.map((x) => (x.company.startsWith("Columbia") ? { ...x, status: "accepted", tone: "green" } : x)),
  },
  {
    from: "JHU Graduate Admissions",
    mail: "Your application decision",
    quote: "Congratulations! It is my pleasure to inform you that you have been admitted.",
    apply: (r) => r.map((x) => (x.company.startsWith("Johns") ? { ...x, status: "offer", tone: "green" } : x)),
  },
  {
    from: "NUS Graduate Office",
    mail: "Application outcome",
    quote: "We regret to inform you that your application was unsuccessful.",
    // The row that did not exist until its rejection arrived: the mechanism
    // on display, not just described.
    apply: (r) => (r.some((x) => x.company.startsWith("NUS"))
      ? r
      : [...r, { company: "NUS", role: "MComp Artificial Intelligence", status: "rejected", tone: "red" }]),
  },
  {
    from: "Mitacs",
    mail: "Globalink Research Internship",
    quote: "Congratulations on receiving the MITACS GRI Award!",
    apply: (r) => r.map((x) => (x.company.startsWith("Mitacs") ? { ...x, status: "accepted", tone: "green" } : x)),
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
    <div className="relative w-full max-w-lg">
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

      <div className="rounded-2xl border border-white/12 bg-[#111318] p-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-white/80">Applications</p>
          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] text-emerald-300">
            updating itself
          </span>
        </div>
        <ul className="mt-3 space-y-1.5">
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
        <p className="mt-2 text-[10px] text-white/30">
          Real rows from the season of Abdullah Zubair Ghouri, who built Carpa. Judges load this
          exact tracker in one click.
        </p>
      </div>
    </div>
  );
}
