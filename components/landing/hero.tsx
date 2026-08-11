"use client";

import Link from "next/link";
import { TrackerDemo } from "./tracker-demo";

/**
 * Statement left, product right, and nothing decorating either.
 *
 * Two designs died here. The three js gallery glitched on real machines. The
 * gradient-and-glow pass after it read as machine-made, because it was: the
 * glowing dot, the rainbow headline and the drifting orbs are what every
 * generated page looks like. What survives is the layout and the one asset
 * that argues for the product, the tracker doing its job on loop. Flat dark
 * ground, plain type, numbers stated in a sentence.
 */
export function LandingHero() {
  return (
    <section className="relative min-h-[92svh] w-full overflow-hidden bg-[#0b0c10]">
      <div className="relative z-10 flex min-h-[92svh] flex-col">
        <header className="border-b border-white/10">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="font-display text-base font-bold tracking-tight">Carpa</span>
              <span className="hidden text-[10px] uppercase tracking-widest text-white/35 sm:inline">plan it, track it, prove it</span>
            </Link>
            <nav className="flex items-center gap-4">
              <Link href="/home" data-track="nav_signin"
                    className="text-xs text-white/70 transition-colors hover:text-white">
                Sign in
              </Link>
              <Link href="/start" data-track="nav_start"
                    className="rounded-md bg-white px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-white/90">
                Start
              </Link>
            </nav>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-12 px-5 py-12 lg:flex-row lg:gap-16">
          <div className="max-w-xl text-center lg:text-left">
            <p className="text-[11px] uppercase tracking-[0.25em] text-white/40">
              for students done doing this by hand
            </p>
            <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.03] tracking-tight sm:text-7xl">
              Pick the job.
              <span className="block text-white/45">We&rsquo;ll plan the degree.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-lg text-sm leading-relaxed text-white/60 sm:text-base lg:mx-0">
              Paste a posting and get the exact courses that answer it, inside your degree&rsquo;s real
              rules, every pick backed by a quoted line from the catalog. Then connect your inbox once,
              and every application you send tracks itself: confirmations, assessments, interviews,
              offers, each with the sentence that proved it.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
              <Link href="/start" data-track="cta_start_hero"
                    className="rounded-md bg-white px-7 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90">
                Plan my degree
              </Link>
              <a href="#proof"
                 className="text-sm text-white/70 underline underline-offset-4 transition-colors hover:text-white">
                See the numbers
              </a>
            </div>
            <p className="mt-8 border-t border-white/10 pt-4 text-xs leading-relaxed text-white/40">
              32 of 32 planner checks green. Every quoted line machine checked against its source.
              About four cents of model time for a full plan.
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
