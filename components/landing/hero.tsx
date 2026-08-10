"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

// The three.js gallery is the heaviest thing on the whole site, so it loads
// after the text is already readable, and never on the server.
const InfiniteGallery = dynamic(() => import("./infinite-gallery"), { ssr: false });

/**
 * The hero from the design template, repurposed with receipts.
 *
 * The template flew art photography past the camera; this flies the product's
 * own unedited test screenshots. Same motion, but the gallery is proof, not
 * decoration. On phones and for anyone who prefers reduced motion, a static
 * screenshot stands in: WebGL on a cold mobile GPU is how a landing page
 * earns a spinner, and nobody scrolls a spinner.
 */
export function LandingHero({ shots }: { shots: { src: string; alt: string }[] }) {
  const [show3d, setShow3d] = useState(false);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)").matches;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setShow3d(wide && !calm);
  }, []);

  return (
    <section className="relative h-[92svh] min-h-[540px] w-full overflow-hidden">
      {show3d ? (
        <InfiniteGallery
          images={shots}
          speed={0.9}
          zSpacing={3}
          visibleCount={10}
          falloff={{ near: 0.8, far: 14 }}
          className="absolute inset-0 h-full w-full opacity-60"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shots[1]?.src ?? "/shots/s1.png"} alt=""
             className="absolute inset-0 h-full w-full object-cover opacity-25" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#07090f]/60 via-transparent to-[#07090f]" />

      <div className="relative z-10 flex h-full flex-col">
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

        <div className="flex flex-1 flex-col items-center justify-center px-5 text-center">
          <h1 className="max-w-3xl font-display text-4xl font-semibold leading-[1.05] sm:text-6xl">
            The job you want,
            <span className="block italic text-white/80">planned backwards.</span>
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
            Paste a job posting and get the course plan that answers it, built inside your degree&rsquo;s
            real rules, every choice backed by a quoted line from the catalog. Then connect your inbox
            and watch every application you ever sent become a tracker that keeps itself.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/start" data-track="cta_start_hero"
                  className="rounded-full bg-white px-7 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.03]">
              Plan my degree
            </Link>
            <a href="#proof" className="rounded-full border border-white/20 px-7 py-3 text-sm text-white/80 transition-colors hover:border-white/60">
              See the proof
            </a>
          </div>
        </div>

        <p className="pb-6 text-center font-mono text-[10px] uppercase tracking-widest text-white/35">
          the images flying past are unedited screenshots of this product
        </p>
      </div>
      <span id="proof" />
    </section>
  );
}
