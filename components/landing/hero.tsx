"use client";

import Link from "next/link";
import { TrackerDemo } from "./tracker-demo";

/**
 * Statement left, product right, nothing in between to break.
 *
 * The three js gallery is gone: it glitched on real machines, and gradient
 * rectangles flying at a visitor argued for nothing. What replaced it is the
 * strongest asset this product has, the tracker visibly doing its job, an
 * email arrives, a row updates, the quote appears, on loop, in the hero. The
 * background is two slowly drifting CSS glows and a grid; transform-only
 * animation, so there is nothing to glitch.
 */
export function LandingHero() {
  return (
    <section className="relative min-h-[92svh] w-full overflow-hidden">
      {/* background: pure CSS, zero runtime */}
      <div aria-hidden className="absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(56,132,255,0.26),transparent_65%)] [animation:carpa-drift_16s_ease-in-out_infinite]" />
        <div className="absolute -bottom-52 -right-32 h-[38rem] w-[38rem] rounded-full bg-[radial-gradient(circle,rgba(16,185,163,0.2),transparent_65%)] [animation:carpa-drift-2_19s_ease-in-out_infinite]" />
        <div className="absolute left-1/2 top-1/3 h-[26rem] w-[26rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(125,211,252,0.08),transparent_60%)] [animation:carpa-drift_23s_ease-in-out_infinite_reverse]" />
        <div className="absolute inset-0 opacity-[0.35]"
             style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "72px 72px" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#07090f]" />
      </div>

      <div className="relative z-10 flex min-h-[92svh] flex-col">
        <header className="mx-auto mt-4 flex w-[calc(100%-2rem)] max-w-6xl items-center justify-between rounded-full border border-white/10 bg-white/[0.05] px-4 py-2.5 backdrop-blur-md sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-gradient-to-tr from-sky-400 to-emerald-300 shadow-[0_0_12px_rgba(56,189,248,0.8)]" />
            <span className="font-display text-base font-bold tracking-tight">Carpa</span>
            <span className="hidden text-[10px] uppercase tracking-widest text-white/35 sm:inline">plan it, track it, prove it</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/home" data-track="nav_signin"
                  className="rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/80 transition-colors hover:border-white/60">
              Sign in
            </Link>
            <Link href="/start" data-track="nav_start"
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition-transform hover:scale-[1.04]">
              Start
            </Link>
          </nav>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-12 px-5 py-10 lg:flex-row lg:gap-16">
          <div className="max-w-xl text-center lg:text-left">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-3.5 py-1.5 text-[11px] uppercase tracking-[0.2em] text-white/55">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              for students done doing this by hand
            </p>
            <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
              Pick the job.
              <span className="block bg-gradient-to-r from-sky-300 via-teal-200 to-emerald-300 bg-clip-text text-transparent">
                We&rsquo;ll plan the degree.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-lg text-sm leading-relaxed text-white/60 sm:text-base lg:mx-0">
              Paste a posting and get the exact courses that answer it, inside your degree&rsquo;s real
              rules, every pick backed by a quoted line from the catalog. Then connect your inbox once,
              and every application you send tracks itself: confirmations, assessments, interviews,
              offers, each with the sentence that proved it.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link href="/start" data-track="cta_start_hero"
                    className="rounded-full bg-white px-7 py-3 text-sm font-semibold text-black shadow-[0_0_44px_-8px_rgba(125,211,252,0.6)] transition-transform hover:scale-[1.04]">
                Plan my degree
              </Link>
              <a href="#proof"
                 className="rounded-full border border-white/20 px-7 py-3 text-sm text-white/80 transition-colors hover:border-white/60">
                See the numbers
              </a>
            </div>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              {[
                "32/32 planner checks green",
                "every quote machine verified",
                "about $0.04 per full plan",
              ].map((t) => (
                <span key={t} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/55">
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-6 text-[11px] text-white/35">
              No claim without a receipt: every course quote and every status quote is machine checked
              against its source.
            </p>
          </div>

          <div className="flex w-full flex-1 justify-center lg:justify-end">
            <TrackerDemo />
          </div>
        </div>
      </div>
    </section>
  );
}
