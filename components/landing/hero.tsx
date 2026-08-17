"use client";

import Link from "next/link";
import { VideoEmbed } from "./video-embed";
import { CarpaMark } from "@/components/carpa-mark";

export function LandingHero() {
  return (
    <section className="relative w-full overflow-hidden bg-[#0b0c10]">
      <div className="relative z-10 flex flex-col">
        <header className="border-b border-white/10">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
            <Link href="/" className="flex items-center gap-2">
              <CarpaMark className="h-6 w-6 rounded-md ring-1 ring-white/20" />
              <span className="font-display text-base font-bold tracking-tight">Carpa</span>
              <span className="hidden text-[10px] uppercase tracking-widest text-white/35 sm:inline">plan it, track it, prove it · built for the Stellic challenge</span>
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

        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 pt-12 pb-8 sm:pt-16 sm:pb-12 lg:pt-20 lg:pb-16">
          <div className="text-center max-w-2xl">
            <p className="text-[11px] uppercase tracking-[0.25em] text-white/40">
              for students done doing this by hand
            </p>
            <h1 className="mt-5 font-display text-4xl font-semibold leading-[1.03] tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl">
              Pick the job.
              <span className="block text-white/45">We&rsquo;ll plan the degree.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
              Paste a posting and get the exact courses that answer it, inside your degree&rsquo;s real
              rules, every pick backed by a quoted line from the catalog. Then connect your inbox once
              and every application tracks itself.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
              <Link href="/start" data-track="cta_start_hero"
                    className="rounded-md bg-white px-7 py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90">
                Plan my degree
              </Link>
              <a href="#proof"
                 className="text-sm text-white/70 underline underline-offset-4 transition-colors hover:text-white">
                See the numbers
              </a>
            </div>
          </div>

          <div className="mt-10 w-full max-w-5xl mx-auto">
            <VideoEmbed />
          </div>

          <p className="mt-8 text-xs leading-relaxed text-white/40 text-center max-w-lg">
            A regression suite of eleven job types, controls scoring zero. Every quoted line machine
            checked against its source. About ten cents of model time for a full plan.
          </p>
        </div>
      </div>
    </section>
  );
}