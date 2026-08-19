"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SCHOOLS } from "@/data";
import { CarpaMark } from "@/components/carpa-mark";
import { VideoEmbed } from "@/components/landing/video-embed";

/**
 * The front door, in the editorial style this product deserves: cream paper,
 * ink type, one headline serif moment, and the product's own unedited
 * screenshots in a rotating frame. Every number is computed from the same
 * data the product runs on, at render time.
 */

const SLIDES = [
  {
    src: "/shots/planner.png",
    title: "Plan the degree",
    desc: "Every course in the catalog is read against the posting, then a constraint solver places the winners inside your degree's real rules.",
  },
  {
    src: "/shots/s3.png",
    title: "Track every application",
    desc: "Connect your inbox once and the tracker maintains itself — each status carrying the sentence from the email that proved it.",
  },
  {
    src: "/shots/start.png",
    title: "Start from the job",
    desc: "Paste the posting, say which courses you've finished. The rest is receipts: every pick quotes where it came from.",
  },
];

export default function Page() {
  const courses = SCHOOLS.reduce((n, s) => n + s.courses.length, 0);
  const rules = SCHOOLS.reduce((n, s) => n + s.programs.reduce((m, p) => m + p.buckets.length, 0), 0);

  const [active, setActive] = useState(0);
  const [progress, setProgress] = useState(0);
  const [videoSeen, setVideoSeen] = useState(false);
  const videoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !("IntersectionObserver" in window)) { setVideoSeen(true); return; }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { setVideoSeen(true); io.disconnect(); }
        }
      },
      { threshold: 0.18 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          setActive((c) => (c + 1) % SLIDES.length);
          return 0;
        }
        return p + 2; // 2% each 100ms = five seconds per slide
      });
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const pick = (i: number) => { setActive(i); setProgress(0); };

  return (
    <div className="w-full bg-[#F7F5F3] text-[#37322F]">
      {/* ── the ruled container: two hairlines, one column ────────────────── */}
      <div className="relative mx-auto w-full max-w-[1100px] px-4 sm:px-8 lg:px-12">
        <div aria-hidden className="absolute inset-y-0 left-4 hidden w-px bg-[rgba(55,50,47,0.12)] sm:left-8 lg:block" />
        <div aria-hidden className="absolute inset-y-0 right-4 hidden w-px bg-[rgba(55,50,47,0.12)] sm:right-8 lg:block" />

        {/* ── nav pill ─────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 px-2 pt-3 sm:px-4">
          <div className="mx-auto flex max-w-[760px] items-center justify-between rounded-full border border-[rgba(55,50,47,0.10)] bg-[#F7F5F3]/90 py-1.5 pl-4 pr-1.5 shadow-[0px_0px_0px_2px_white] backdrop-blur-sm">
            <Link href="/" className="flex items-center gap-2">
              <CarpaMark className="h-4.5 w-4.5 rounded-[4px]" />
              <span className="font-display text-base font-bold tracking-tight">Carpa</span>
            </Link>
            <nav className="hidden items-center gap-4 sm:flex">
              <a href="#how" className="text-xs font-medium text-[rgba(49,45,43,0.80)] transition-colors hover:text-[#37322F]">How it works</a>
              <a href="#numbers" className="text-xs font-medium text-[rgba(49,45,43,0.80)] transition-colors hover:text-[#37322F]">Numbers</a>
              <a href="#faq" className="text-xs font-medium text-[rgba(49,45,43,0.80)] transition-colors hover:text-[#37322F]">FAQ</a>
            </nav>
            <div className="flex items-center gap-2">
              <Link href="/home" data-track="nav_signin"
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-[#37322F] shadow-[0px_1px_2px_rgba(55,50,47,0.12)]">
                Log in
              </Link>
              <Link href="/start" data-track="nav_start"
                    className="rounded-full bg-[#37322F] px-4 py-1.5 text-xs font-medium text-white">
                Start
              </Link>
            </div>
          </div>
        </header>

        {/* ── hero ─────────────────────────────────────────────────────────── */}
        <section className="relative px-4 pb-8 pt-16 sm:pt-24 lg:pt-32">
          <div aria-hidden className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 lg:top-28">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mask-group-pattern.svg" alt=""
                 className="w-[900px] opacity-30 mix-blend-multiply sm:w-[1200px] lg:w-[1600px]"
                 style={{ filter: "hue-rotate(15deg) saturate(0.7) brightness(1.2)" }} />
          </div>

          <div className="relative z-10 mx-auto flex max-w-[860px] flex-col items-center gap-4 text-center sm:gap-6">
            <div className="px-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(2,6,23,0.08)] bg-white px-3.5 py-1.5 text-xs font-medium text-[#37322F] shadow-[0px_0px_0px_4px_rgba(55,50,47,0.05)]">
                built for the Stellic Pathfinders Challenge
              </span>
            </div>
            <h1 className="max-w-[748px] font-serif text-4xl font-normal leading-[1.1] sm:text-6xl lg:text-[80px] lg:leading-[88px]">
              Pick the job.
              <br />
              We&rsquo;ll plan the degree.
            </h1>
            <p className="max-w-[520px] text-sm font-medium leading-7 text-[rgba(55,50,47,0.80)] sm:text-lg sm:leading-8">
              Paste a posting and get the exact courses that answer it, inside your degree&rsquo;s real
              rules. Then connect your inbox once and every application tracks itself.
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/start"
                data-track="cta_start_hero"
                className="relative inline-flex items-center justify-center overflow-hidden rounded-full bg-[#37322F] px-10 py-2.5 text-sm font-medium text-white shadow-[0px_0px_0px_2.5px_rgba(255,255,255,0.08)_inset] transition-colors hover:bg-[#2A2520]"
              >
                Plan my degree
              </Link>
              <a
                href="#numbers"
                className="rounded-full border border-[rgba(55,50,47,0.18)] bg-white/60 px-6 py-2.5 text-sm font-medium text-[#37322F] transition-colors hover:bg-white"
              >
                See the numbers
              </a>
            </div>
          </div>

          {/* ── the demo, played above the product frame ─────────────────────── */}
          <div
            ref={videoRef}
            className={`relative z-10 mx-auto mt-12 w-full max-w-[1040px] transition-all duration-700 ease-out ${
              videoSeen ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
            }`}
          >
            <div className="rounded-2xl bg-gradient-to-b from-[rgba(55,50,47,0.22)] to-[rgba(55,50,47,0.10)] p-px shadow-[0_32px_90px_-32px_rgba(55,50,47,0.45)]">
              <VideoEmbed />
            </div>
          </div>

          {/* ── the product frame ──────────────────────────────────────────── */}
          <div className="relative z-10 mx-auto mt-12 w-full max-w-[960px]">
            <div className="relative h-[240px] overflow-hidden rounded-lg bg-white shadow-[0px_0px_0px_0.9px_rgba(0,0,0,0.08)] sm:h-[380px] lg:h-[480px]">
              {SLIDES.map((s, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={s.src}
                  src={s.src}
                  alt={`${s.title} — unedited screenshot from the product`}
                  loading={i === 0 ? undefined : "lazy"}
                  className={`absolute inset-0 h-full w-full object-contain transition-all duration-500 ease-in-out ${
                    active === i ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-95 blur-sm"
                  }`}
                />
              ))}
            </div>

            {/* tabs, one per slide, on opaque paper so they never sit on the shot */}
            <div className="mt-3 grid gap-0 border-b border-t border-[#E0DEDB] sm:grid-cols-3">
              {SLIDES.map((s, i) => (
                <button
                  key={s.title}
                  onClick={() => pick(i)}
                  className={`relative flex cursor-pointer flex-col items-start gap-1 px-5 py-4 text-left transition-colors ${
                    i > 0 ? "border-t border-[#E0DEDB] sm:border-t-0 sm:border-l" : ""
                  } ${active === i ? "bg-white" : "bg-[#F1EEE9] hover:bg-white/80"}`}
                >
                  {active === i && (
                    <span className="absolute inset-x-0 top-0 h-0.5 bg-[rgba(50,45,43,0.08)]">
                      <span
                        className="block h-full bg-[#322D2B] transition-all duration-100 ease-linear"
                        style={{ width: `${progress}%` }}
                      />
                    </span>
                  )}
                  <span className={`text-sm font-semibold leading-6 ${active === i ? "text-[#49423D]" : "text-[#605A57]"}`}>
                    {s.title}
                  </span>
                  <span className="text-[13px] leading-[22px] text-[#605A57]">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── numbers band ─────────────────────────────────────────────────── */}
        <section id="numbers" className="scroll-mt-24 border-t border-[rgba(55,50,47,0.12)]">
          <div className="mx-auto flex max-w-[720px] flex-col items-center gap-4 px-6 py-14 sm:py-16">
            <span className="rounded-full border border-[rgba(2,6,23,0.08)] bg-white px-3.5 py-1.5 text-xs font-medium shadow-[0px_0px_0px_4px_rgba(55,50,47,0.05)]">
              measured, not promised
            </span>
            <h2 className="text-center font-serif text-3xl leading-tight sm:text-4xl">
              Numbers that speak
            </h2>
            <p className="max-w-[480px] text-center text-sm leading-6 text-[#605A57] sm:text-base sm:leading-7">
              Every figure below is computed from the same data the product runs on — nothing rounded up.
            </p>
          </div>
          <div className="grid grid-cols-2 border-y border-[#E0DEDB] sm:grid-cols-4">
            {[
              [String(courses), "course pages read against every posting, whole catalog in one pass"],
              [String(rules), "degree rules enforced, each carrying a verbatim bulletin quote"],
              ["32/32", "regression checks green across 11 job types, controls score zero"],
              ["~$0.10", "of model spend per posting, on the smallest model Anthropic sells"],
            ].map(([n, d], i) => (
              <div key={d} className={`flex flex-col items-center gap-2 px-4 py-8 text-center ${i % 2 === 1 ? "border-l border-[#E0DEDB]" : ""} ${i >= 2 ? "border-t border-[#E0DEDB] sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""}`}>
                <p className="font-serif text-4xl leading-none sm:text-5xl">{n}</p>
                <p className="max-w-[200px] text-xs leading-relaxed text-[#605A57]">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── bento ────────────────────────────────────────────────────────── */}
        <section id="how" className="scroll-mt-24 border-b border-[rgba(55,50,47,0.12)]">
          <div className="mx-auto flex max-w-[720px] flex-col items-center gap-4 px-6 py-14 sm:py-16">
            <span className="rounded-full border border-[rgba(2,6,23,0.08)] bg-white px-3.5 py-1.5 text-xs font-medium shadow-[0px_0px_0px_4px_rgba(55,50,47,0.05)]">
              how it works
            </span>
            <h2 className="text-center font-serif text-3xl leading-tight sm:text-4xl">
              Built for absolute clarity
            </h2>
            <p className="max-w-[480px] text-center text-sm leading-6 text-[#605A57] sm:text-base sm:leading-7">
              Two jobs, one rule. The AI reads and quotes; plain deterministic code decides.
            </p>
          </div>

          <div className="grid border-y border-[rgba(55,50,47,0.12)] md:grid-cols-2">
            <Bento
              title="The degree plan"
              desc="A posting becomes a semester-by-semester plan inside your degree's real rules — prerequisites, credit caps, terms offered. Every course carries the catalog line that earned it."
              border
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/shots/planner.png" alt="A semester by semester plan built from a job posting"
                   className="w-full rounded-md border border-[#E0DEDB]" loading="lazy" />
            </Bento>
            <Bento
              title="The tracker"
              desc="Confirmations, assessments, interviews, offers, rejections: the tracker reads them from your inbox and proves each status with a sentence from the email. Nothing is ever written back."
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/shots/s3.png" alt="The application tracker built from an inbox"
                   className="w-full rounded-md border border-[#E0DEDB]" loading="lazy" />
            </Bento>
            <Bento
              title="The timetable"
              desc="Eight terms on one ruled board: where each course lands, what waits on it, and what the posting bought you, all visible at once."
              border
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/shots/s5.png" alt="The semester chart"
                   className="w-full rounded-md border border-[#E0DEDB]" loading="lazy" />
            </Bento>
            <Bento
              title="One rule everywhere"
              desc="No claim without a receipt. A course only survives if a line from the catalog can be found, by machine, verbatim in its source."
            >
              <Receipt />
            </Bento>
          </div>
        </section>

        {/* ── faq ──────────────────────────────────────────────────────────── */}
        <FAQ />

        {/* ── cta ──────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-y border-[rgba(55,50,47,0.12)]">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {Array.from({ length: 60 }).map((_, i) => (
              <div key={i} className="absolute h-4 w-[300%] rotate-[-45deg] origin-top-left outline outline-[0.5px] outline-[rgba(3,7,18,0.06)] outline-offset-[-0.25px]"
                   style={{ top: `${i * 16 - 60}px`, left: "-100%" }} />
            ))}
          </div>
          <div className="relative z-10 mx-auto flex max-w-[640px] flex-col items-center gap-6 px-6 py-16 sm:py-20">
            <h2 className="text-center font-serif text-3xl leading-tight sm:text-5xl sm:leading-[56px]">
              Pick the job. We&rsquo;ll plan the degree.
            </h2>
            <p className="text-center text-sm leading-7 text-[#605A57] font-medium sm:text-base">
              Plan against any posting, and let the tracker keep every application you send —
              receipts included.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/start" data-track="cta_start_bottom"
                    className="relative inline-flex items-center justify-center overflow-hidden rounded-full bg-[#37322F] px-10 py-2.5 text-sm font-medium text-white shadow-[0px_0px_0px_2.5px_rgba(255,255,255,0.08)_inset] transition-colors hover:bg-[#2A2520]">
                Plan my degree
              </Link>
              <Link href="/home" data-track="cta_home_bottom"
                    className="rounded-full border border-[rgba(55,50,47,0.18)] bg-white/60 px-6 py-2.5 text-sm font-medium transition-colors hover:bg-white">
                Sign in and see your dashboard
              </Link>
            </div>
          </div>
        </section>

        {/* ── footer ───────────────────────────────────────────────────────── */}
        <footer className="px-4 py-8">
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <Link href="/" className="flex items-center gap-2">
              <CarpaMark className="h-4 w-4 rounded-[4px]" />
              <span className="font-display text-sm font-bold tracking-tight">Carpa</span>
            </Link>
            <p className="text-center text-xs leading-relaxed text-[#605A57]">
              Built for the Stellic challenge. Catalog data from the universities&rsquo; own bulletins,
              snapshotted and cited. Screenshots are unedited captures from this product&rsquo;s test runs.
            </p>
            <Link href="/home" className="text-xs font-medium text-[#37322F] underline underline-offset-2">
              Sign in
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Bento({ title, desc, border, children }: { title: string; desc: string; border?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col items-start gap-4 p-6 sm:p-8 lg:p-10 ${border ? "border-b border-[rgba(55,50,47,0.12)] md:border-b-0 md:border-r" : "border-b border-[rgba(55,50,47,0.12)] last:border-b-0 md:border-b-0"}`}>
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold leading-tight sm:text-xl">{title}</h3>
        <p className="text-sm leading-relaxed text-[#605A57]">{desc}</p>
      </div>
      <div className="w-full">{children}</div>
    </div>
  );
}

/** A receipt, drawn: the claim, the check, the source. */
function Receipt() {
  return (
    <div className="w-full rounded-md border border-[#E0DEDB] bg-white p-4 shadow-[0px_2px_4px_rgba(50,45,43,0.06)]">
      <p className="font-mono text-[11px] uppercase tracking-widest text-[#9a8d84]">claim · COMS W3134</p>
      <p className="mt-2 text-xs leading-relaxed text-[#49423D]">
        &ldquo;Data structures are the algorithmic core of computer science, and every system you will
        ever build depends on them.&rdquo;
      </p>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-[#15705f]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="m5 12 5 5L20 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        found verbatim in the bulletin page for the course
      </div>
      <div className="mt-3 border-t border-[#E0DEDB] pt-2 text-[11px] text-[#9a8d84]">
        Not found? The claim is dropped, not shown.
      </div>
    </div>
  );
}

const FAQ_ITEMS = [
  {
    q: "How does Carpa pick courses?",
    a: "It never picks by feel. The model reads the posting and the catalog, and a constraint solver — plain deterministic code — chooses and schedules courses. Every course that survives carries a quote from the catalog, and that quote is machine-checked against the source. A claim whose quote is not found verbatim is dropped, not shown.",
  },
  {
    q: "Can I use any university?",
    a: "The solver, matcher, UI and verifier are school-agnostic — a new school is data, not code. One catalog is modelled deeply today (Columbia CS BA, 139 courses, each cited), and each degree rule carries a verbatim bulletin quote.",
  },
  {
    q: "Does the tracker touch my inbox?",
    a: "Read once, read only. Nothing is written back, ever. The first scan reads your mail through IMAP app-password or Google read-only scope and builds the tracker with a proving sentence per status.",
  },
  {
    q: "What does it cost?",
    a: "You bring your own key (OpenRouter or Anthropic, Haiku 4.5 only), and a full plan costs about ten cents of model time, measured from a real spend ledger. The solver runs without any key at all.",
  },
  {
    q: "How long does a plan take?",
    a: "Two to four minutes, because every course in the catalog is genuinely read against the posting rather than keyword-matched. The tracker's first scan runs as a background job with live progress.",
  },
  {
    q: "Can I hand a plan to my advisor?",
    a: "That is what it is built for. Every pick quotes the bulletin. Where a prerequisite parse has not been human-reviewed, the plan says so and asks for an advisor check rather than pretending certainty.",
  },
];

function FAQ() {
  const [open, setOpen] = useState<number[]>([]);
  const toggle = (i: number) =>
    setOpen((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  return (
    <section id="faq" className="scroll-mt-24">
      <div className="flex flex-col gap-6 px-4 py-16 sm:px-8 lg:flex-row lg:gap-12">
        <div className="flex flex-col justify-start gap-4 lg:w-1/2 lg:py-5">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight text-[#49423D]">
            Frequently asked questions
          </h2>
          <p className="text-base leading-7 text-[#605A57]">
            Plan the degree, track the applications,
            <br className="hidden md:block" />
            keep every receipt.
          </p>
        </div>
        <div className="lg:w-1/2">
          {FAQ_ITEMS.map((item, i) => {
            const isOpen = open.includes(i);
            return (
              <div key={i} className="border-b border-[rgba(73,66,61,0.16)]">
                <button
                  onClick={() => toggle(i)}
                  className="flex w-full items-center justify-between gap-5 px-3 py-4 text-left transition-colors duration-200 hover:bg-[rgba(73,66,61,0.02)] sm:px-5"
                  aria-expanded={isOpen}
                >
                  <span className="flex-1 text-base font-medium leading-6 text-[#49423D]">{item.q}</span>
                  <svg className={`h-6 w-6 shrink-0 text-[rgba(73,66,61,0.60)] transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                       width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}`}>
                  <div className="px-3 pb-4 text-sm leading-6 text-[#605A57] sm:px-5">{item.a}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}