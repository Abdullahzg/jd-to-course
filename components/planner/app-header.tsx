"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pencil } from "lucide-react";
import { usePlanner } from "./planner-store";

/**
 * A thin line saying what this plan is for.
 *
 * This used to carry two select menus, one for the school and one for the
 * degree, sitting there on every screen. They were the wrong thing twice over.
 * You already answered both questions in the survey, so the header was asking
 * again; and changing either one from here throws away the completed courses,
 * which is a destructive act dressed up as a dropdown.
 *
 * So it states the answers instead, and the way to change them is to go back to
 * the question that asked for them.
 */
export function AppHeader() {
  const { state, school, program } = usePlanner();
  const pathname = usePathname();

  const tabs = [
    { href: "/home", label: "Home", short: "Home" },
    { href: "/plan", label: "My course path", short: "Plan" },
    { href: "/tracker", label: "Applications", short: "Apps" },
    { href: "/sources", label: "Where the rules come from", short: "Sources" },
  ];

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4 lg:px-8">
        <Link href="/" className="font-display text-sm font-bold tracking-tight">Carpa</Link>
        <Link
          href="/start"
          className="group flex min-w-0 items-center gap-2 rounded-full border border-border px-3 py-1 transition-colors hover:border-[var(--blue)] hover:bg-[var(--blue-soft)]"
          title="Change your school, degree or the job"
        >
          <span className="min-w-0 truncate text-sm font-medium">
            {school?.shortName ?? school?.name ?? "No school yet"}
          </span>
          {program && (
            <>
              <span className="hidden text-muted-foreground sm:inline">·</span>
              <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:inline">
                {program.name}
              </span>
            </>
          )}
          <Pencil className="h-3 w-3 shrink-0 text-muted-foreground transition-colors group-hover:text-[var(--blue)]" />
        </Link>

        {state.roleSummary && (
          <p className="hidden min-w-0 max-w-md truncate text-sm text-muted-foreground lg:block">
            planning for: {state.roleSummary}
          </p>
        )}

        <nav className="ml-auto flex items-center gap-1" aria-label="Screens">
          {tabs.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                }`}
              >
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.short}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
