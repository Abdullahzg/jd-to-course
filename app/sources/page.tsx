import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { AppHeader } from "@/components/planner/app-header";
import { SCHOOLS } from "@/data";

export const metadata = { title: "Sources" };

/**
 * BUILD_SPEC §6.0 / §9.4b. Generated from the data, not written by hand, so it
 * cannot drift from what the solver actually enforces. This is the cheapest
 * possible proof that the requirements came from real catalogs rather than from
 * asking a model what a CS degree contains — and that distinction is the whole
 * argument of the project.
 */
export default function Page() {
  const rows = SCHOOLS.flatMap((school) =>
    school.programs.flatMap((program) => [
      ...program.buckets.map((b) => ({
        school: school.shortName,
        rule: b.label,
        quote: b.source.quote,
        url: b.source.url,
        retrieved: b.source.retrievedAt,
      })),
      ...program.sources.map((s) => ({
        school: school.shortName,
        rule: "Degree-wide policy",
        quote: s.quote,
        url: s.url,
        retrieved: s.retrievedAt,
      })),
    ]),
  );

  const unverified = SCHOOLS.flatMap((s) =>
    s.courses.filter((c) => !c.verified).map((c) => ({ school: s.shortName, code: c.code, title: c.title })),
  );

  return (
    <main className="min-h-screen">
      <AppHeader />
      <div className="mx-auto max-w-[1100px] px-4 py-10 lg:px-8">
        <span className="inline-flex items-center gap-3  text-xs text-muted-foreground">
          <span className="h-px w-8 bg-foreground/30" />
          every rule the solver enforces, and the page it came from
        </span>

        <h1 className="mt-5 font-display text-[clamp(1.8rem,4vw,2.6rem)] font-semibold leading-tight tracking-tight">
          Sources
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Requirement rules were encoded by hand from these pages, not extracted by a model.
          Each row carries the verbatim sentence the rule came from. This table is generated
          from the same data the solver runs on, so it cannot fall out of step with it.
        </p>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-foreground/20">
                <Th>School</Th>
                <Th>Rule</Th>
                <Th>As the catalog states it</Th>
                <Th>Retrieved</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border align-top">
                  <td className="py-3 pr-4  text-xs">{r.school}</td>
                  <td className="py-3 pr-4 text-xs">{r.rule}</td>
                  <td className="py-3 pr-4 text-[11px] italic leading-relaxed text-muted-foreground">
                    “{r.quote}”
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1.5 inline-flex items-center gap-1  not-italic underline"
                    >
                      source <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </td>
                  <td className="py-3  text-[11px] text-muted-foreground">{r.retrieved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* §4.1 — say plainly what has not been reviewed. */}
        <section className="mt-12 border-t border-border pt-6">
          <h2 className="font-display text-lg font-semibold tracking-tight">
            What a human has not reviewed
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Degree requirements above were hand-encoded and checked. The prerequisite parses
            below have not been through that pass, so the board marks any course that depends
            on one as needing a word with your advisor. Listing them is cheaper than pretending
            they are settled.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {unverified.map((c) => (
              <li
                key={`${c.school}-${c.code}`}
                className="rounded-full border px-3 py-1  text-[11px]"
                style={{ borderColor: "color-mix(in oklab, var(--amber) 45%, transparent)", color: "var(--amber)" }}
              >
                {c.school} {c.code}
              </li>
            ))}
            {!unverified.length && (
              <li className="text-sm text-muted-foreground">Every prerequisite parse has been reviewed.</li>
            )}
          </ul>
        </section>

        <div className="mt-10 flex flex-wrap gap-3 border-t border-border pt-6">
          <Link href="/board" className="rounded-full bg-foreground px-5 py-2.5 text-sm text-background">
            Back to the board
          </Link>
        </div>
      </div>
    </main>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="pb-2 pr-4  text-[10px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </th>
  );
}
