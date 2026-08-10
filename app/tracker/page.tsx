"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { StatusPill } from "@/app/home/page";

/**
 * The tracker in full: every application the inbox revealed, grouped the way
 * a student thinks about them, each status carrying the sentence from the
 * email that made it true. The receipts rule from the course planner applies
 * here unchanged: click any status and see the exact words.
 */

type Ev = { id: string; status: string; quote: string | null; subject: string | null; emailDate: number | null };
type Item = {
  id: string; company: string; role: string | null; kind: string; status: string;
  quote: string | null; subject: string | null; emailDate: number | null;
  actionLink: string | null; deadline: string | null; updatedAt: number; events: Ev[];
};

const KIND_ORDER = ["internship", "job", "research", "grad school", "scholarship", "hackathon", "program", "other"];
const KIND_LABEL: Record<string, string> = {
  internship: "Internships", job: "Jobs", research: "Research",
  "grad school": "Grad school", scholarship: "Scholarships",
  hackathon: "Hackathons", program: "Programs", other: "Everything else",
};

export default function TrackerPage() {
  const { status } = useSession();
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("all");

  useEffect(() => {
    if (status !== "authenticated") return;
    void fetch("/api/tracker").then((r) => r.json()).then((j) => { if (j.ok) setItems(j.items); });
  }, [status]);

  const groups = useMemo(() => {
    const xs = (items ?? []).filter((i) => tab === "all" || i.kind === tab);
    const g = new Map<string, Item[]>();
    for (const i of xs) g.set(i.kind, [...(g.get(i.kind) ?? []), i]);
    return [...g.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]));
  }, [items, tab]);

  const actions = (items ?? []).filter((i) => i.status === "action needed" || (i.status === "assessment" && i.deadline));

  if (status === "loading") return <main className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></main>;
  if (status !== "authenticated") {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">The tracker belongs to an account.</p>
        <Link href="/home" className="mt-3 inline-block rounded-full bg-foreground px-5 py-2 text-sm text-background">Sign in</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-xl font-semibold">Applications</h1>
          <p className="text-xs text-muted-foreground">
            {(items ?? []).length} tracked, every status proved by the email that announced it.
          </p>
        </div>
        <Link href="/home" className="text-xs underline underline-offset-2 text-muted-foreground">back to home</Link>
      </div>

      {actions.length > 0 && (
        <div className="mt-4 rounded-xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--amber) 45%, transparent)" }}>
          <p className="text-xs font-medium" style={{ color: "var(--amber)" }}>Needs your hands</p>
          <ul className="mt-1 space-y-1">
            {actions.map((a) => (
              <li key={a.id} className="text-xs">
                <strong>{a.company}</strong>{a.role ? ` · ${a.role}` : ""}: {a.deadline ?? "action requested"}
                {a.actionLink && (
                  <a href={a.actionLink} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 underline">
                    open <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {["all", ...KIND_ORDER.filter((k) => (items ?? []).some((i) => i.kind === k))].map((k) => (
          <button key={k} onClick={() => setTab(k)} data-track="tracker_tab"
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${tab === k ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:text-foreground"}`}>
            {k === "all" ? "All" : KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {items === null && <div className="mt-4 space-y-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-foreground/5" />)}</div>}
      {items?.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing here yet. Connect an inbox on the home page and the year you already lived fills this in.</p>
          <Link href="/home" className="mt-3 inline-block rounded-full bg-foreground px-4 py-1.5 text-xs text-background">Connect an inbox</Link>
        </div>
      )}

      {groups.map(([kind, rows]) => (
        <section key={kind} className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{KIND_LABEL[kind]} · {rows.length}</h2>
          <div className="mt-2 space-y-1.5">
            {rows.map((t) => (
              <div key={t.id} className="rounded-xl border border-border bg-white">
                <button onClick={() => setOpen(open === t.id ? null : t.id)} data-track="tracker_row"
                        className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 p-3 text-left">
                  <span className="text-sm font-medium">{t.company}</span>
                  {t.role && <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t.role}</span>}
                  <StatusPill status={t.status} />
                  {t.deadline && <span className="text-[10px]" style={{ color: "var(--amber)" }}>{t.deadline}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{new Date(t.emailDate ?? t.updatedAt).toLocaleDateString()}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open === t.id ? "rotate-180" : ""}`} />
                  </span>
                </button>
                {open === t.id && (
                  <div className="border-t border-border p-3">
                    <p className="text-[11px] font-medium text-muted-foreground">The journey, each step in the email&rsquo;s own words</p>
                    <ol className="mt-1.5 space-y-1.5">
                      {t.events.map((e) => (
                        <li key={e.id} className="text-xs">
                          <span className="font-medium">{e.status}</span>
                          <span className="text-muted-foreground"> · {e.emailDate ? new Date(e.emailDate).toLocaleDateString() : ""}</span>
                          {e.quote && <blockquote className="mt-0.5 border-l-2 border-border pl-2 italic text-muted-foreground">&ldquo;{e.quote}&rdquo;</blockquote>}
                        </li>
                      ))}
                    </ol>
                    <div className="mt-2.5 flex items-center gap-2">
                      {t.actionLink && (
                        <a href={t.actionLink} target="_blank" rel="noreferrer"
                           className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px]">
                          open the link it sent <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                      <button
                        onClick={async () => {
                          await fetch("/api/tracker", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id }) });
                          setItems((xs) => (xs ?? []).filter((x) => x.id !== t.id));
                        }}
                        data-track="tracker_delete"
                        className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-muted-foreground hover:text-red-700">
                        <Trash2 className="h-3 w-3" /> not mine
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
