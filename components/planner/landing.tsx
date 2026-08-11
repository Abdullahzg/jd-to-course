"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The start page. It has to answer three questions before anyone will spend a
 * minute on the survey: what is this, what does it give me, and why should I
 * believe it. The panel on the right answers the second one by showing the
 * actual output rather than describing it.
 */
export function Landing({
  schools, courseCount, ruleCount,
}: {
  schools: { shortName: string; totalCredits: number }[];
  courseCount: number;
  ruleCount: number;
}) {
  const [filled, setFilled] = useState(0);

  // The sample schedule fills in a course at a time, which is what the solver
  // does. Runs once, then rests.
  useEffect(() => {
    const t = window.setInterval(() => setFilled((n) => (n >= SAMPLE.length ? n : n + 1)), 320);
    return () => window.clearInterval(t);
  }, []);

  return (
    <main className="survey-ground timetable-grid h-full overflow-hidden">
      <div className="mx-auto flex h-full max-w-[1400px] flex-col px-6 lg:px-12">
        {/* wordmark */}
        <header className="flex shrink-0 items-center justify-between py-6">
          <span className="flex items-baseline gap-3">
            <span className="font-display text-xl font-semibold tracking-tight">Course Path</span>
            <span className="hidden text-sm text-white/50 sm:inline">Columbia and CUNY catalogs</span>
          </span>
          <Link href="/sources" className="text-sm text-white/60 underline-offset-4 hover:text-white hover:underline">
            Where the rules come from
          </Link>
        </header>

        <div className="grid min-h-0 flex-1 items-center gap-10 overflow-hidden pb-6 lg:grid-cols-[1.05fr_0.95fr]">
          {/* ── the pitch ─────────────────────────────────────────────────── */}
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 px-4 py-1.5 text-sm text-white/80">
              For students choosing next semester
            </span>

            <h1 className="mt-5 font-display text-[clamp(2.2rem,5vw,4.2rem)] font-semibold leading-[1.0] tracking-[-0.02em]">
              The job you want,
              <br />
              turned into the
              <br />
              <span className="relative inline-block">
                courses to take.
                <span className="absolute -bottom-1 left-0 h-[6px] w-full rounded-full bg-[var(--blue-light)]" />
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/75 lg:text-lg">
              Paste a job posting and tick off the classes you have passed. You get the exact
              courses to take and the semester to take them in, obeying every rule of your degree.
              And a straight answer about what classes will never teach you.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-5">
              <Link
                href="/start"
                className="group flex items-center gap-3 rounded-full bg-white px-9 py-5 text-lg font-semibold text-[var(--blue-deep)] shadow-[0_18px_44px_-18px_rgba(0,0,0,0.55)] transition-[box-shadow,background-color] hover:bg-[var(--blue-soft)] hover:shadow-[0_26px_66px_-18px_rgba(0,0,0,0.7)]"
              >
                Start
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <span className="text-white/60">Takes about a minute. Nothing to sign up for.</span>
            </div>

            {/* the credibility line */}
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4 border-t border-white/15 pt-5">
              <Stat n={String(courseCount)} l="courses, every one with the university's own description behind it" />
              <Stat n={String(ruleCount)} l="graduation rules, each quoted from the bulletin it came from" />
              <Stat n={String(schools.length)} l="real universities, nothing invented anywhere" />
            </dl>
          </div>

          {/* ── what you get ──────────────────────────────────────────────── */}
          <div className="hidden min-h-0 lg:block">
            <div className="rounded-[28px] border border-white/15 bg-black/20 p-3 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.8)]">
              <div className="rounded-[20px] bg-white p-6 text-[var(--ink)]">
                <div className="flex items-baseline justify-between border-b border-border pb-3">
                  <span className="font-display text-lg font-semibold">Fall 2026</span>
                  <span className="rounded-full bg-[var(--blue-soft)] px-3 py-1 text-sm" style={{ color: "var(--blue-deep)" }}>
                    16 credits
                  </span>
                </div>

                <ul className="mt-4 space-y-2.5">
                  {SAMPLE.map((c, i) => (
                    <li
                      key={c.code}
                      className={`rounded-2xl border border-border p-3.5 ${i < filled ? "slot-in" : "opacity-0"}`}
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="code text-[15px]">{c.code}</span>
                        <span className="text-[15px]">{c.title}</span>
                        <span className="ml-auto text-sm text-muted-foreground">{c.cr} cr</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.teaches.map((t) => (
                          <span
                            key={t}
                            className="rounded-full px-2.5 py-0.5 text-xs"
                            style={{ background: "color-mix(in oklab, var(--teal) 12%, transparent)", color: "var(--teal)" }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>

                <div
                  className="mt-4 rounded-2xl border-2 p-3.5"
                  style={{ borderColor: "var(--clay)" }}
                >
                  <p className="text-sm font-semibold" style={{ color: "var(--clay)" }}>
                    No class can teach you this
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    3 years shipping production systems. That needs a project, an internship, or
                    time on the job.
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-4 text-center text-sm text-white/50">
              A real plan from the Columbia bulletin, not a mock-up.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <dt className="tabular font-display text-2xl font-semibold">{n}</dt>
      <dd className="mt-0.5 max-w-[12rem] text-xs leading-snug text-white/55">{l}</dd>
    </div>
  );
}

const SAMPLE = [
  { code: "COMS W3157", title: "Advanced Programming", cr: 4, teaches: ["C", "Linux", "Git"] },
  { code: "COMS W4771", title: "Machine Learning", cr: 3, teaches: ["PyTorch", "Deep learning"] },
  { code: "MATH UN2015", title: "Linear Algebra and Probability", cr: 3, teaches: ["Linear algebra"] },
];
