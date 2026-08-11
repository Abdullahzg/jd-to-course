"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { CarpaMark } from "@/components/carpa-mark";

/**
 * The way back. Every page inside the product shows the same slim bar, so
 * no screen is ever a dead end: the complaint that forced this was a user
 * standing on the tracker with no route home. The landing keeps its own
 * header and gets nothing from here.
 */
const LINKS = [
  { href: "/home", label: "Dashboard" },
  { href: "/start", label: "Planner" },
  { href: "/tracker", label: "Tracker" },
];

export function AppNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  if (pathname === "/") return null;

  const isAdmin = Boolean((session as { isAdmin?: boolean } | null)?.isAdmin);
  const active = (href: string) =>
    pathname === href || pathname.startsWith(href + "/") ||
    (href === "/start" && (pathname.startsWith("/plan") || pathname.startsWith("/sources")));

  return (
    <nav className="border-b border-border bg-white print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-4">
          <Link href="/" data-track="nav_brand" className="flex shrink-0 items-center gap-1.5 font-display text-sm font-bold tracking-tight">
            <CarpaMark className="h-4.5 w-4.5 rounded-[4px]" /> Carpa
          </Link>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} data-track={`nav_${l.label.toLowerCase()}`}
                  className={`shrink-0 text-xs transition-colors ${active(l.href) ? "font-medium text-foreground underline underline-offset-4" : "text-muted-foreground hover:text-foreground"}`}>
              {l.label}
            </Link>
          ))}
          {isAdmin && (
            <Link href="/admin" data-track="nav_admin"
                  className={`shrink-0 text-xs transition-colors ${active("/admin") ? "font-medium text-foreground underline underline-offset-4" : "text-muted-foreground hover:text-foreground"}`}>
              Admin
            </Link>
          )}
        </div>
        {session?.user ? (
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">{session.user.name?.split(" ")[0]}</span>
            <button onClick={() => signOut({ callbackUrl: "/" })} data-track="nav_signout" aria-label="Sign out"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        ) : (
          <Link href="/home" className="shrink-0 text-xs text-muted-foreground hover:text-foreground">Sign in</Link>
        )}
      </div>
    </nav>
  );
}
