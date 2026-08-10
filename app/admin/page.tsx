"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

/**
 * Who came, and what they touched. Built to answer exactly one question the
 * owner asked: how many people from the competition actually used the thing,
 * and what did they do inside it.
 */

type Stats = {
  users: { id: string; email: string; name: string | null; createdAt: number; events: number; searches: number; applications: number; lastSeen: number | null }[];
  byName: { name: string; n: number }[];
  recent: { name: string; meta: string | null; createdAt: number; email: string | null }[];
};

export default function Admin() {
  const { status } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (status !== "authenticated") return;
    void fetch("/api/admin").then((r) => r.json()).then((j) => (j.ok ? setStats(j) : setErr(j.error ?? "no")));
  }, [status]);

  if (status === "loading") return <main className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></main>;
  if (status !== "authenticated") return <main className="p-10 text-center text-sm text-muted-foreground">Sign in first. <Link className="underline" href="/home">Go</Link></main>;
  if (err) return <main className="p-10 text-center text-sm text-muted-foreground">{err}</main>;
  if (!stats) return <main className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></main>;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="font-display text-xl font-semibold">Usage</h1>
      <p className="text-xs text-muted-foreground">{stats.users.length} accounts. Every row a person, every number something they actually did.</p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="bg-foreground/[0.03] text-muted-foreground">
            <tr>{["Who", "Joined", "Last seen", "Events", "Searches", "Applications"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {stats.users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2"><span className="font-medium">{u.name ?? "?"}</span> <span className="text-muted-foreground">{u.email}</span></td>
                <td className="px-3 py-2 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-muted-foreground">{u.lastSeen ? new Date(u.lastSeen).toLocaleString() : "-"}</td>
                <td className="px-3 py-2 tabular-nums">{u.events}</td>
                <td className="px-3 py-2 tabular-nums">{u.searches}</td>
                <td className="px-3 py-2 tabular-nums">{u.applications}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold">What gets used</h2>
          <ul className="mt-2 space-y-1">
            {stats.byName.map((e) => (
              <li key={e.name} className="flex items-center gap-2 text-xs">
                <span className="tabular-nums w-10 text-right font-medium">{e.n}</span>
                <span className="h-2 rounded bg-[var(--blue)]/30" style={{ width: `${Math.min(100, e.n * 3)}px` }} />
                <span className="text-muted-foreground">{e.name}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="text-sm font-semibold">Just now</h2>
          <ul className="mt-2 max-h-[420px] space-y-1 overflow-y-auto pr-2">
            {stats.recent.map((e, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">
                <span className="tabular-nums">{new Date(e.createdAt).toLocaleTimeString()}</span>{" "}
                <span className="text-foreground">{e.email ?? "anonymous"}</span> {e.name}
                {e.meta ? <span className="opacity-70"> {e.meta.slice(0, 80)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
