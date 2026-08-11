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
 * background is two CSS radial glows and a grid, which cannot glitch because
 * there is nothing to run.
 */
export function LandingHero() {
  return (
    <section className="relative min-h-[92svh] w-full overflow-hidden">
      {/* background: pure CSS, zero runtime */}
      <div aria-hidden className="absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(56,132,255,0.22),transparent_65%)]" />
        <div className="absolute -bottom-52 -right-32 h-[38rem] w-[38rem] rounded-full bg-[radial-gradient(circle,rgba(16,185,163,0.16),transparent_65%)]" />
        <div className="absolute inset-0 opacity-[0.35]"
             style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "72px 72px" }} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#07090f]" />
      </div>

      <div className="relative z-10 flex min-h-[92svh] flex-col">
        <header className="flex items-center justify-between px-5 py-4 sm:px-8">
          <p className="font-display text-sm font-semibold tracking-wide">Course Path</p>
          <nav className="flex items-center gap-2">
            <Link href="/home" data-track="nav_signin"
                  className="rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/80 transition-colors hover:border-white/60">
              Sign in
            </Link>
            <Link href="/start" data-track="nav_start"
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black">
              Start
            </Link>
          </nav>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-12 px-5 py-10 lg:flex-row lg:gap-16">
          <div className="max-w-xl text-center lg:text-left">
            <p className="text-xs uppercase tracking-[0.25em] text-white/40">
              for students done doing this by hand
            </p>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.04] sm:text-6xl">
              Pick the job.
              <span className="block italic text-white/75">We&rsquo;ll plan the degree.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-lg text-sm leading-relaxed text-white/60 sm:text-base lg:mx-0">
              Paste a posting and get the exact courses that answer it, inside your degree&rsquo;s real
              rules, every pick backed by a quoted line from the catalog. Then connect your inbox once,
              and every application you send tracks itself: confirmations, assessments, interviews,
              offers, each with the sentence that proved it.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <Link href="/start" data-track="cta_start_hero"
                    className="rounded-full bg-white px-7 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.03]">
                Plan my degree
              </Link>
              <a href="#proof"
                 className="rounded-full border border-white/20 px-7 py-3 text-sm text-white/80 transition-colors hover:border-white/60">
                See the numbers
              </a>
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
