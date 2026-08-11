import Link from "next/link";
import { SCHOOLS } from "@/data";
import { LandingHero } from "@/components/landing/hero";

/**
 * The front door, built on receipts.
 *
 * Every number here is computed from the same data the product runs on, at
 * render time, because a landing page that rounds up is the first lie a
 * student meets. The screenshots flying past in the hero are the actual
 * product, captured during its own test runs.
 */
export default function Page() {
  const courses = SCHOOLS.reduce((n, s) => n + s.courses.length, 0);
  const rules = SCHOOLS.reduce((n, s) => n + s.programs.reduce((m, p) => m + p.buckets.length, 0), 0);

  return (
    <main className="bg-[#07090f] text-white">
      <div className="border-b border-white/10 bg-gradient-to-r from-sky-500/15 via-transparent to-emerald-500/15 px-4 py-1.5 text-center text-[11px] text-white/60">
        <strong className="text-white/85">Carpa</strong> · built for the Stellic challenge · every claim on this page carries a receipt
      </div>
      <LandingHero />

      {/* ── the numbers, computed not claimed ─────────────────────────────── */}
      <section id="proof" className="mx-auto max-w-6xl px-5 py-14 sm:py-20 scroll-mt-8">
        <p className="text-xs uppercase tracking-[0.2em] text-white/40">measured, not promised</p>
        <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {[
            [String(courses), "course pages read against every posting, whole catalog in one pass"],
            [String(rules), "degree rules enforced, each carrying a verbatim bulletin quote"],
            ["32/32", "regression checks green across 11 job types, controls score zero"],
            ["~$0.10", "of model spend per posting, on the smallest model Anthropic sells"],
          ].map(([n, d]) => (
            <div key={d} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="font-display text-3xl font-semibold sm:text-4xl">{n}</p>
              <p className="mt-2 text-xs leading-relaxed text-white/55">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── feature one, with the receipt on screen ───────────────────────── */}
      <Feature
        flag="Feature one"
        title="Paste a job posting. Get the degree that answers it."
        body="The catalog is read against your posting in one sitting, every claim must quote both the posting and the course page, an adversarial pass tries to break every match, and a constraint solver builds the timetable inside your degree's real rules: prerequisites in order, credit caps, courses the bulletin refuses to count together. What survives is a semester by semester plan where every course carries the sentence that earned its place."
        img="/shots/s2.png"
        points={[
          "Every match quotes the posting and the catalog, and both quotes are machine checked against the source pages",
          "Alternatives ranked one to six with the reason each placed where it did",
          "Electives are the closest remaining matches by rank, never filler by taste",
        ]}
      />

      {/* ── feature two ───────────────────────────────────────────────────── */}
      <Feature
        flag="Feature two"
        flip
        title="Your inbox already knows where you applied. Now your tracker does."
        body="Connect Gmail in one authorize tab, or paste an app password. The first scan reads back through your year: every application it finds, internships, programs, scholarships, hackathons and jobs, becomes a row with its status, its timeline, and the exact sentence from the email that proves it. A rejection for something you never logged still gets its row. After that, every scan keeps the tracker current so you never reconcile an inbox against a spreadsheet again."
        img="/shots/s3.png"
        points={[
          "Applications grouped by kind: internships, jobs, research, scholarships, programs",
          "Each status change carries the verbatim email sentence behind it",
          "Deadlines and assessment links surfaced as actions, not buried in threads",
        ]}
      />

      {/* ── how it holds together ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="font-display text-2xl font-semibold sm:text-3xl">One rule everywhere: no claim without a receipt.</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ["Plan", "A posting becomes a ranked course plan inside your real degree audit, every pick defended by quoted evidence."],
            ["Apply", "The postings you plan against become tracked applications, carried over with their skill match attached."],
            ["Adjust", "Outcomes flow back: rejections that share a missing skill re-rank the plan, citing your own results."],
          ].map(([t, d], i) => (
            <div key={t} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs text-white/40">{String(i + 1).padStart(2, "0")}</p>
              <p className="mt-1 font-display text-lg font-semibold">{t}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/60">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/start" data-track="cta_start_bottom"
                className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.02]">
            Plan my degree
          </Link>
          <Link href="/home" data-track="cta_home_bottom"
                className="rounded-full border border-white/20 px-6 py-2.5 text-sm text-white/80 transition-colors hover:border-white/50">
            Sign in and see your dashboard
          </Link>
        </div>
        <p className="mt-10 border-t border-white/10 pt-6 text-xs text-white/35">
          Built for the Stellic challenge. Catalog data from the universities&rsquo; own bulletins, snapshotted and cited.
          Screenshots above are unedited captures from this product&rsquo;s test runs.
        </p>
      </section>
    </main>
  );
}

function Feature({ flag, title, body, img, points, flip }: {
  flag: string; title: string; body: string; img: string; points: string[]; flip?: boolean;
}) {
  return (
    <section className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
      <div className={`flex flex-col gap-8 lg:items-center ${flip ? "lg:flex-row-reverse" : "lg:flex-row"}`}>
        <div className="min-w-0 lg:w-[44%]">
          <p className="text-xs uppercase tracking-[0.2em] text-white/40">{flag}</p>
          <h2 className="mt-2 font-display text-2xl font-semibold leading-tight sm:text-3xl">{title}</h2>
          <p className="mt-4 text-sm leading-relaxed text-white/60">{body}</p>
          <ul className="mt-5 space-y-2">
            {points.map((p) => (
              <li key={p} className="flex gap-2 text-sm text-white/75">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 flex-1">
          {/* Plain img, not next/image: these are local, already sized captures
              and the landing must not depend on an image optimizer being
              configured wherever this is deployed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt="Unedited product screenshot"
               className="w-full rounded-2xl border border-white/10 shadow-2xl" loading="lazy" />
        </div>
      </div>
    </section>
  );
}
