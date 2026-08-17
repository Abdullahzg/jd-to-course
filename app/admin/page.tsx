"use client";

import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Search, Table2 } from "lucide-react";
import { usePlanner } from "@/components/planner/planner-store";

type Stats = {
  users: { id: string; email: string; name: string | null; createdAt: number; events: number; searches: number; applications: number; lastSeen: number | null }[];
  byName: { name: string; n: number }[];
  recent: { name: string; meta: string | null; createdAt: number; email: string | null }[];
};

type Trail = {
  user: { id: string; email: string; name: string | null; createdAt: number };
  events: { name: string; meta: string | null; createdAt: number }[];
  searches: { id: string; title: string; createdAt: number }[];
  tracker: { company: string; status: string; kind: string; updatedAt: number }[];
};

type SearchDetail = {
  id: string; title: string; jd: string; snapshot: string;
  coursesPicked: number | null; partsAnswered: number | null; createdAt: number;
};

type TrackerItem = {
  id: string; company: string; role: string | null; kind: string;
  status: string; updatedAt: number; emailDate: number | null;
};

type Placement = { courseId: string; term: number; bucketId: string; covers: { skill: string }[] };
type SemesterPlan = { name: string; placements: { courseId: string; covers: number }[] };

const STATUS_DOT: Record<string, string> = {
  applied: "#3b82f6", assessment: "#d97706", interview: "#8b5cf6", offer: "#10b981",
  accepted: "#059669", rejected: "#ef4444", waitlisted: "#f97316", "action needed": "#9a6410", update: "#6b7280",
};

function semesterLabels(startTerm: string, n: number): string[] {
  const out: string[] = [];
  let t = startTerm;
  let y = new Date().getFullYear() + (startTerm === "FA" ? 0 : 1);
  for (let i = 0; i < n; i++) {
    out.push(`${t === "FA" ? "Fall" : "Spring"} ${y}`);
    if (t === "FA") { t = "SP"; y += 1; } else { t = "FA"; }
  }
  return out;
}

function parseSnapshotPlan(snapshot: string): { semesters: SemesterPlan[]; courseIds: string[] } | null {
  try {
    const data = JSON.parse(snapshot);
    const payload = data.payload ?? data;
    const result = payload.result;
    const state = payload.state;
    if (!result?.plans?.length) return null;
    const plan = result.plans[0];
    const startTerm = state?.student?.startTerm ?? "FA";
    const nTerms = plan.termCredits?.length ?? plan.placements.length;
    const names = semesterLabels(startTerm, nTerms);
    const courseIds = new Set<string>();
    const byTerm = new Map<number, { courseId: string; covers: number }[]>();
    for (const p of plan.placements as Placement[]) {
      courseIds.add(p.courseId);
      const list = byTerm.get(p.term) ?? [];
      list.push({ courseId: p.courseId, covers: p.covers?.length ?? 0 });
      byTerm.set(p.term, list);
    }
    const semesters = names.map((name, i) => ({
      name,
      placements: byTerm.get(i) ?? [],
    }));
    return { semesters, courseIds: [...courseIds] };
  } catch {
    return null;
  }
}

export default function Admin() {
  const { status } = useSession();
  const { restoreSnapshot } = usePlanner();
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [trail, setTrail] = useState<Trail | null>(null);
  const [openSearch, setOpenSearch] = useState<string | null>(null);
  const [searchDetail, setSearchDetail] = useState<SearchDetail | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [openTracker, setOpenTracker] = useState(false);
  const [trackerItems, setTrackerItems] = useState<TrackerItem[] | null>(null);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [catalog, setCatalog] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    void fetch("/api/catalog").then((r) => r.json()).then((c) => {
      const m = new Map<string, string>();
      for (const s of c?.schools ?? []) {
        for (const course of s.courses ?? []) {
          m.set(course.id, course.code);
        }
      }
      setCatalog(m);
    }).catch(() => {});
  }, [status]);

  const openTrail = async (id: string) => {
    if (openUser === id) { setOpenUser(null); setTrail(null); setOpenSearch(null); setOpenTracker(false); return; }
    setOpenUser(id); setTrail(null); setOpenSearch(null); setSearchDetail(null); setOpenTracker(false);
    const j = await fetch(`/api/admin?user=${id}`).then((r) => r.json()).catch(() => null);
    if (j?.ok) setTrail(j);
  };

  const viewSearch = async (userId: string, searchId: string) => {
    if (openSearch === searchId) { setOpenSearch(null); setSearchDetail(null); return; }
    setOpenSearch(searchId); setSearchDetail(null); setSearchLoading(true);
    const j = await fetch(`/api/admin?user=${userId}&search=${searchId}`).then((r) => r.json()).catch(() => null);
    setSearchLoading(false);
    if (j?.ok) setSearchDetail(j.search);
  };

  const openPlan = async (searchDetail: SearchDetail) => {
    try {
      const data = JSON.parse(searchDetail.snapshot);
      const payload = data.payload ?? data;
      restoreSnapshot(payload);
      try { sessionStorage.setItem("slack.planner.restored", JSON.stringify(payload)); } catch { /* ok */ }
      router.push("/plan");
    } catch { /* fail silently */ }
  };

  const viewTracker = async (userId: string) => {
    if (openTracker) { setOpenTracker(false); setTrackerItems(null); return; }
    setOpenTracker(true); setTrackerItems(null); setTrackerLoading(true);
    const j = await fetch(`/api/admin?user=${userId}&tracker=1`).then((r) => r.json()).catch(() => null);
    setTrackerLoading(false);
    if (j?.ok) setTrackerItems(j.items);
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
        <table className="table-mobile w-full min-w-[640px] text-left text-xs">
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
                            <div className="flex items-center justify-between">
                              <p className="text-[11px] font-medium text-muted-foreground">Course searches · {trail.searches.length}</p>
                              {trail.searches.length > 0 && (
                                <span className="text-[10px] text-muted-foreground">click to open</span>
                              )}
                            </div>
                            <ul className="mt-1 max-h-[150px] space-y-0.5 overflow-y-auto text-[11px]">
                              {trail.searches.map((s) => (
                                <li key={s.id}>
                                  <button onClick={() => void viewSearch(u.id, s.id)}
                                          className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-foreground/5">
                                    <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    <span className="tabular-nums text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</span>
                                    <span className="min-w-0 truncate">{s.title.slice(0, 60)}</span>
                                  </button>
                                </li>
                              ))}
                              {!trail.searches.length && <li className="text-muted-foreground">none</li>}
                            </ul>
                          </div>

                          <div>
                            <div className="flex items-center justify-between">
                              <p className="text-[11px] font-medium text-muted-foreground">Tracker rows · {trail.tracker.length}</p>
                              {trail.tracker.length > 0 && (
                                <button onClick={() => void viewTracker(u.id)}
                                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                                  <Table2 className="h-3 w-3" /> view all
                                </button>
                              )}
                            </div>
                            <ul className="mt-1 max-h-[150px] space-y-0.5 overflow-y-auto text-[11px]">
                              {trail.tracker.map((t, i) => (
                                <li key={i} className="flex items-center gap-1.5 px-1 py-0.5">
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_DOT[t.status] ?? "#9ca3af" }} />
                                  {t.company} <span className="text-muted-foreground">· {t.kind} · {t.status}</span>
                                </li>
                              ))}
                              {!trail.tracker.length && <li className="text-muted-foreground">none</li>}
                            </ul>
                          </div>
                        </section>
                      </div>
                    )}

                    {openSearch && searchLoading && (
                      <div className="mt-3 h-20 animate-pulse rounded-lg bg-foreground/5" />
                    )}
                    {openSearch && searchDetail && (
                      <div className="mt-3 space-y-3">
                        <div className="rounded-lg border border-border bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">{searchDetail.title}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {new Date(searchDetail.createdAt).toLocaleString()} ·
                                {searchDetail.coursesPicked != null ? ` ${searchDetail.coursesPicked} courses picked` : ""}
                                {searchDetail.partsAnswered != null ? ` · ${searchDetail.partsAnswered} parts answered` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button onClick={() => openPlan(searchDetail)}
                                      className="inline-flex items-center gap-1 rounded-full bg-foreground px-3 py-1 text-[11px] font-medium text-background hover:opacity-90">
                                <ExternalLink className="h-3 w-3" /> Open plan
                              </button>
                              <button onClick={() => { setOpenSearch(null); setSearchDetail(null); }}
                                      className="text-[11px] text-muted-foreground underline underline-offset-2">close</button>
                            </div>
                          </div>

                          {/* Semester plan view */}
                          {(() => {
                            const plan = parseSnapshotPlan(searchDetail.snapshot);
                            if (!plan) return null;
                            return (
                              <div className="mt-3">
                                <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Degree plan by semester</p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {plan.semesters.map((s) => (
                                    <div key={s.name} className="rounded-lg border border-border bg-foreground/[0.02] p-2">
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{s.name}</p>
                                      {s.placements.length === 0 && <p className="text-[10px] text-muted-foreground mt-0.5">—</p>}
                                      {s.placements.map((p) => (
                                        <div key={p.courseId} className="flex items-center gap-1.5 text-[11px] mt-0.5">
                                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.covers > 0 ? "bg-emerald-500" : "bg-amber-500"}`} />
                                          <span className="font-medium">{catalog?.get(p.courseId) ?? p.courseId}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          <details className="mt-2">
                            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                              Job posting preview
                            </summary>
                            <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-foreground/[0.03] p-2 text-[10px] leading-relaxed text-muted-foreground">
                              {searchDetail.jd.slice(0, 3000)}{searchDetail.jd.length > 3000 ? "…" : ""}
                            </pre>
                          </details>
                        </div>
                      </div>
                    )}

                    {openTracker && trackerLoading && (
                      <div className="mt-3 h-20 animate-pulse rounded-lg bg-foreground/5" />
                    )}
                    {openTracker && trackerItems && (
                      <div className="mt-3 rounded-lg border border-border bg-white">
                        <div className="flex items-center justify-between border-b border-border px-3 py-2">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            {trackerItems.length} tracked applications
                          </p>
                          <button onClick={() => { setOpenTracker(false); setTrackerItems(null); }}
                                  className="text-[11px] text-muted-foreground underline underline-offset-2">close</button>
                        </div>
                        <div className="max-h-[300px] overflow-y-auto">
                          <table className="w-full text-left text-[11px]">
                            <thead className="bg-foreground/[0.03] text-muted-foreground sticky top-0">
                              <tr>{["Company", "Kind", "Status", "Updated"].map((h) => <th key={h} className="px-3 py-1.5 font-medium">{h}</th>)}</tr>
                            </thead>
                            <tbody>
                              {trackerItems.map((t) => (
                                <tr key={t.id} className="border-t border-border">
                                  <td className="px-3 py-1 font-medium">{t.company}{t.role ? <span className="text-muted-foreground"> · {t.role}</span> : null}</td>
                                  <td className="px-3 py-1 text-muted-foreground">{t.kind}</td>
                                  <td className="px-3 py-1">
                                    <span className="flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_DOT[t.status] ?? "#9ca3af" }} />
                                      {t.status}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1 tabular-nums text-muted-foreground">{new Date(t.updatedAt).toLocaleDateString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
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