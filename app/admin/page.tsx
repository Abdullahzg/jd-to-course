"use client";

import React, { useEffect, useState } from "react";
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

type Trail = {
  user: { id: string; email: string; name: string | null; createdAt: number };
  events: { name: string; meta: string | null; createdAt: number }[];
  searches: { title: string; createdAt: number }[];
  tracker: { company: string; status: string; kind: string; updatedAt: number }[];
};

export default function Admin() {
  const { status } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [trail, setTrail] = useState<Trail | null>(null);
  const openTrail = async (id: string) => {
    if (openUser === id) { setOpenUser(null); setTrail(null); return; }
    setOpenUser(id); setTrail(null);
    const j = await fetch(`/api/admin?user=${id}`).then((r) => r.json()).catch(() => null);
    if (j?.ok) setTrail(j);
  };

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
              <React.Fragment key={u.id}>
              <tr className="cursor-pointer border-t border-border transition-colors hover:bg-foreground/[0.03]"
                  onClick={() => void openTrail(u.id)} title="Open this person's whole trail">
                <td className="px-3 py-2"><span className="font-medium">{u.name ?? "?"}</span> <span className="text-muted-foreground">{u.email}</span></td>
                <td className="px-3 py-2 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-muted-foreground">{u.lastSeen ? new Date(u.lastSeen).toLocaleString() : "-"}</td>
                <td className="px-3 py-2 tabular-nums">{u.events}</td>
                <td className="px-3 py-2 tabular-nums">{u.searches}</td>
                <td className="px-3 py-2 tabular-nums">{u.applications}</td>
              </tr>
              {openUser === u.id && (
                <tr className="border-t border-border bg-foreground/[0.02]">
                  <td colSpan={6} className="px-4 py-3">
                    {!trail ? (
                      <div className="h-16 animate-pulse rounded-lg bg-foreground/5" />
                    ) : (
                      <div className="grid gap-4 lg:grid-cols-3">
                        <section className="lg:col-span-2">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            The whole trail, first visit to now · {trail.events.length} events
                          </p>
                          <ul className="mt-1.5 max-h-[380px] space-y-0.5 overflow-y-auto rounded-lg border border-border bg-white p-2">
                            {trail.events.map((e, i) => (
                              <li key={i} className="flex gap-2 text-[11px]">
                                <span className="tabular-nums shrink-0 text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                                <span className="shrink-0 font-medium">{e.name}</span>
                                <span className="min-w-0 truncate text-muted-foreground">{e.meta ?? ""}</span>
                              </li>
                            ))}
                            {!trail.events.length && <li className="text-[11px] text-muted-foreground">No events recorded.</li>}
                          </ul>
                        </section>
                        <section className="space-y-3">
                          <div>
                            <p className="text-[11px] font-medium text-muted-foreground">Course searches · {trail.searches.length}</p>
                            <ul className="mt-1 max-h-[150px] space-y-0.5 overflow-y-auto text-[11px]">
                              {trail.searches.map((s, i) => (
                                <li key={i}><span className="tabular-nums text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</span> {s.title.slice(0, 60)}</li>
                              ))}
                              {!trail.searches.length && <li className="text-muted-foreground">none</li>}
                            </ul>
                          </div>
                          <div>
                            <p className="text-[11px] font-medium text-muted-foreground">Tracker rows · {trail.tracker.length}</p>
                            <ul className="mt-1 max-h-[150px] space-y-0.5 overflow-y-auto text-[11px]">
                              {trail.tracker.map((t, i) => (
                                <li key={i}>{t.company} <span className="text-muted-foreground">· {t.kind} · {t.status}</span></li>
                              ))}
                              {!trail.tracker.length && <li className="text-muted-foreground">none</li>}
                            </ul>
                          </div>
                        </section>
                      </div>
                    )}
                  </td>
                </tr>
              )}
              </React.Fragment>
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
