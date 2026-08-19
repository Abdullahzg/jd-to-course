"use client";

import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { VideoEmbed } from "./video-embed";
import { CarpaMark } from "@/components/carpa-mark";

export function LandingHero() {
  return (
    <section className="relative w-full overflow-hidden bg-[#07090f]">
      {/* the atmosphere: three glows over a hairline grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(59,108,255,0.30),transparent)] blur-3xl" />
        <div className="absolute top-16 -left-32 h-96 w-96 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,0.22),transparent)] blur-3xl" />
        <div className="absolute top-32 -right-32 h-[420px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgba(20,184,166,0.14),transparent)] blur-3xl" />
        <div
          className="absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_65%_50%_at_50%_0%,black,transparent)]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col">
        <header className="border-b border-white/10 bg-white/[0.02] backdrop-blur">
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
                    className="rounded-full bg-gradient-to-r from-[#3b6cff] to-[#8b5cf6] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                Start
              </Link>
            </nav>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-5 pt-12 pb-8 sm:pt-16 sm:pb-12 lg:pt-20 lg:pb-16">
          <div className="text-center max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[11px] text-white/70">
              <Sparkles className="h-3 w-3 text-[#8ab4ff]" />
              Built for the Stellic Pathfinders Challenge
            </span>
            <h1 className="mt-6 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl">
              Pick the job.
              <span className="block bg-gradient-to-r from-[#8ab4ff] via-[#a78bfa] to-[#5eead4] bg-clip-text text-transparent">
                We&rsquo;ll plan the degree.
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
              Paste a posting and get the exact courses that answer it, inside your degree&rsquo;s real
              rules, every pick backed by a quoted line from the catalog. Then connect your inbox once
              and every application tracks itself.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link href="/start" data-track="cta_start_hero"
                    className="rounded-full bg-gradient-to-r from-[#3b6cff] to-[#8b5cf6] px-8 py-3 text-sm font-semibold text-white shadow-[0_10px_40px_-10px_rgba(99,102,241,0.8)] transition-transform hover:scale-[1.02]">
                Plan my degree
              </Link>
              <a href="#proof"
                 className="rounded-full border border-white/15 px-6 py-3 text-sm text-white/70 transition-colors hover:border-white/40 hover:text-white">
                See the numbers
              </a>
            </div>
          </div>

          <div className="relative mt-12 w-full max-w-5xl mx-auto">
            <div aria-hidden className="absolute -inset-6 rounded-[2rem] bg-[radial-gradient(closest-side,rgba(59,108,255,0.22),transparent)] blur-2xl" />
            <div className="relative rounded-2xl bg-gradient-to-b from-white/15 to-white/5 p-px shadow-[0_32px_120px_-32px_rgba(59,108,255,0.55)]">
              <VideoEmbed />
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-2">
            {[
              "32/32 regression checks green across 11 job types",
              "Every quoted line machine-checked against its source",
              "≈ $0.10 of model time for a full plan",
            ].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5 text-xs text-white/50">
                <Check className="h-3.5 w-3.5 text-emerald-400" /> {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
