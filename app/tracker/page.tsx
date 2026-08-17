"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ChevronDown, Download, ExternalLink, Loader2, Plus, RefreshCw, Search, Trash2, Wand2, X } from "lucide-react";
import { InboxActions } from "@/components/inbox-actions";

/**
 * The tracker as the spreadsheet it replaces, minus the typing.
 *
 * A real table: every column visible, every cell that can sensibly change
 * editable in place, one export button that produces a file Excel opens
 * without complaint. The receipts rule holds: expand any row and each status
 * in its journey carries the sentence from the email that made it true.
 */

type Ev = { id: string; status: string; quote: string | null; subject: string | null; emailDate: number | null; fromAddr?: string | null; hasBody?: boolean };
type Item = {
  id: string; company: string; role: string | null; kind: string; status: string;
  quote: string | null; subject: string | null; emailDate: number | null;
  actionLink: string | null; deadline: string | null; notes: string | null;
  updatedAt: number; origin?: string | null; events: Ev[];
};

const KINDS = ["internship", "job", "research", "grad school", "scholarship", "hackathon", "program", "other"];
const STATUSES = ["applied", "assessment", "interview", "offer", "accepted", "rejected", "waitlisted", "action needed", "update"];
const STATUS_DOT: Record<string, string> = {
  applied: "#3b82f6", assessment: "#d97706", interview: "#8b5cf6", offer: "#10b981",
  accepted: "#059669", rejected: "#ef4444", waitlisted: "#f97316", "action needed": "var(--amber)", update: "#6b7280",
};
const COLS = [
  { key: "company", label: "Company" }, { key: "role", label: "Role" }, { key: "kind", label: "Kind" },
  { key: "status", label: "Status" }, { key: "updated", label: "Updated" }, { key: "deadline", label: "Deadline" },
  { key: "notes", label: "Notes" }, { key: "actions", label: "" },
] as const;
const KIND_LABEL: Record<string, string> = {
  internship: "Internships", job: "Jobs", research: "Research", "grad school": "Grad school",
  scholarship: "Scholarships", hackathon: "Hackathons", program: "Programs", other: "Everything else",
};

export default function TrackerPage() {
  const { status } = useSession();
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");

  const reload = async () => {
    const j = await fetch("/api/tracker").then((r) => r.json()).catch(() => null);
    if (j?.ok) setItems(j.items);
  };

  /**
   * Sync means "go and look now". It reads whatever source this account is
   * already connected to, incrementally, then refreshes the table underneath
   * you. Nothing to configure: an account with no inbox connected is told so
   * rather than being sent to a settings page it did not ask for.
   */
  const sync = async () => {
    setSyncing(true); setSyncNote("Looking for anything new");
    const st = await fetch("/api/inbox/status").then((r) => r.json()).catch(() => null);
    const mode = st?.savedImap ? "imap" : st?.gmailConnected ? "gmail" : st?.lastMode === "judge" ? "judge" : null;
    if (!mode) {
      setSyncing(false);
      setSyncNote("No inbox is connected to this account yet. Connect one below and sync will keep it current.");
      return;
    }
    const r = await fetch("/api/inbox/scan", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: "The sync could not start." }));
    if (!r.ok) { setSyncing(false); setSyncNote(r.error ?? "The sync failed."); return; }
    if (r.done) { await reload(); setSyncing(false); setSyncNote(`Up to date: ${r.total} applications.`); return; }
    window.dispatchEvent(new Event("carpa-scan-started"));
    const tick = async () => {
      const j = (await fetch(`/api/inbox/scan?job=${r.jobId}`).then((x) => x.json()).catch(() => null))?.job;
      if (!j) { setTimeout(() => void tick(), 3000); return; }
      if (j.status === "running") {
        const n = (x: number) => Number(x).toLocaleString();
        setSyncNote(j.phase === "triage" ? `Sorting ${n(j.total)} emails: ${n(j.done)} done`
          : j.phase === "reading" ? `Reading the ${n(j.total)} that matter`
          : j.phase === "extracting" ? `Extracting statuses: ${n(j.done)} of ${n(j.total)}`
          : "Connecting to the mailbox");
        setTimeout(() => void tick(), 3000);
        return;
      }
      await reload();
      setSyncing(false);
      setSyncNote(j.status === "done"
        ? (j.created || j.updated
            ? `${j.created} new, ${j.updated} updated.`
            : "Nothing new since the last sync.")
        : j.error ?? "The sync failed.");
    };
    void tick();
  };
  const [statusFilter, setStatusFilter] = useState("all");
  const [actionsOnly, setActionsOnly] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "updated", dir: -1 });
  // Column widths are yours to drag; the numbers are only the opening offer.
  const [widths, setWidths] = useState<Record<string, number>>({ company: 190, role: 260, kind: 112, status: 152, updated: 96, deadline: 170, notes: 130 });
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const r = resizing.current; if (!r) return;
      setWidths((w) => ({ ...w, [r.key]: Math.max(64, r.startW + e.clientX - r.startX) }));
    };
    const up = () => { resizing.current = null; document.body.style.cursor = ""; };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    void fetch("/api/tracker").then((r) => r.json()).then((j) => { if (j.ok) setItems(j.items); });
  }, [status]);

  const patch = (id: string, fields: Partial<Item>) => {
    // Optimistic: the cell changes under the cursor, the server catches up,
    // and a failure puts the truth back on the next load.
    setItems((xs) => (xs ?? []).map((x) => (x.id === id ? { ...x, ...fields } : x)));
    void fetch("/api/tracker", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) });
  };

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const dateOf = (i: Item) => i.emailDate ?? i.updatedAt;
    const val = (i: Item, k: string): string | number =>
      k === "company" ? i.company.toLowerCase()
      : k === "role" ? (i.role ?? "").toLowerCase()
      : k === "kind" ? i.kind
      : k === "status" ? i.status
      : k === "deadline" ? (i.deadline ?? "")
      : k === "notes" ? (i.notes ?? "").toLowerCase()
      : dateOf(i);
    return (items ?? [])
      .filter((i) => tab === "all" || i.kind === tab)
      .filter((i) => statusFilter === "all" || i.status === statusFilter)
      .filter((i) => !actionsOnly || i.status === "action needed" || (i.status === "assessment" && i.deadline))
      .filter((i) => !needle || [i.company, i.role, i.notes, i.status, i.kind, i.subject].some((f) => (f ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => { const x = val(a, sort.key), y = val(b, sort.key); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [items, tab, q, statusFilter, actionsOnly, sort]);

  const exportCsv = () => {
    // UTF-8 BOM so Excel opens it with the right encoding on double click.
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Company", "Role", "Kind", "Status", "Last update", "Deadline", "Link", "Notes", "Proof (verbatim from the email)", "Timeline"];
    const rows = (items ?? []).map((t) => [
      t.company, t.role ?? "", t.kind, t.status,
      t.emailDate ? new Date(t.emailDate).toISOString().slice(0, 10) : "",
      t.deadline ?? "", t.actionLink ?? "", t.notes ?? "", t.quote ?? "",
      t.events.map((e) => `${e.status}${e.emailDate ? ` (${new Date(e.emailDate).toISOString().slice(0, 10)})` : ""}`).join(" > "),
    ]);
    const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "carpa-applications.csv"; a.click();
    URL.revokeObjectURL(url);
  };


  if (status === "loading") return <Center><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></Center>;
  if (status !== "authenticated") {
    return (
      <Center>
        <div className="text-center">
          <p className="text-sm text-muted-foreground">The tracker belongs to an account.</p>
          <Link href="/home" className="mt-3 inline-block rounded-full bg-foreground px-5 py-2 text-sm text-background">Sign in</Link>
        </div>
      </Center>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-xl font-semibold">Applications</h1>
          <p className="text-xs text-muted-foreground">
            {(items ?? []).length} tracked. Click a cell to change it; expand a row for the receipts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPrompting(true)} data-track="tracker_prompt_open"
                  title="Describe several fixes in a sentence and see exactly what would change"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs font-medium">
            <Wand2 className="h-3.5 w-3.5" /> Fix with a prompt
          </button>
          <button onClick={() => void sync()} disabled={syncing} data-track="tracker_sync"
                  title="Read anything that arrived since the last scan, then refresh this table"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs font-medium disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing" : "Sync"}
          </button>
          <button onClick={() => setAdding(true)} data-track="tracker_add_open"
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background">
            <Plus className="h-3.5 w-3.5" /> Add an application
          </button>
          <button onClick={exportCsv} disabled={!items?.length} data-track="tracker_export"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs font-medium disabled:opacity-40">
            <Download className="h-3.5 w-3.5" /> Export for Excel (CSV)
          </button>
          <Link href="/home" className="text-xs text-muted-foreground underline underline-offset-2">home</Link>
        </div>
      </div>

      {prompting && (
        <FixWithPrompt
          onClose={() => setPrompting(false)}
          onApplied={() => { setPrompting(false); void reload(); }}
        />
      )}

      {adding && (
        <AddApplication
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void fetch("/api/tracker").then((r) => r.json()).then((j) => { if (j.ok) setItems(j.items); }); }}
        />
      )}

      <div className="mt-3">
        <InboxActions onDone={() => { void fetch("/api/tracker").then((r) => r.json()).then((j) => { if (j.ok) setItems(j.items); }); }} />
      </div>

      {/* the season at a glance, before any scrolling */}
      {(items ?? []).length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "In motion", dot: "#3b82f6", n: (items ?? []).filter((i) => ["applied", "assessment", "update", "waitlisted"].includes(i.status)).length },
            { label: "Interviews", dot: "#8b5cf6", n: (items ?? []).filter((i) => i.status === "interview").length },
            { label: "Offers and accepts", dot: "#10b981", n: (items ?? []).filter((i) => ["offer", "accepted"].includes(i.status)).length },
            { label: "Needs your hands", dot: "var(--amber)", n: (items ?? []).filter((i) => i.status === "action needed" || (i.status === "assessment" && i.deadline)).length },
          ].map((c) => (
            <div key={c.label} className="card-lift rounded-xl border border-border bg-white px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />
                {c.label}
              </p>
              <p className="mt-0.5 font-display text-xl font-semibold">{c.n}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, role, notes"
                 className="w-64 rounded-full border border-border bg-white py-1.5 pl-8 pr-3 text-xs focus:border-[var(--blue)] focus:outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status"
                className="rounded-full border border-border bg-white px-2.5 py-1.5 text-xs focus:border-[var(--blue)] focus:outline-none">
          <option value="all">every status</option>
          {STATUSES.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button onClick={() => setActionsOnly((v) => !v)} data-track="tracker_actions_only"
                className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${actionsOnly ? "border-transparent text-white" : "text-muted-foreground hover:text-foreground border-border"}`}
                style={actionsOnly ? { background: "var(--amber)" } : undefined}>
          Needs your hands · {(items ?? []).filter((i) => i.status === "action needed" || (i.status === "assessment" && i.deadline)).length}
        </button>
        {(q || statusFilter !== "all" || actionsOnly) && (
          <button onClick={() => { setQ(""); setStatusFilter("all"); setActionsOnly(false); }}
                  className="text-xs text-muted-foreground underline underline-offset-2">clear</button>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{visible.length} shown</span>
        <span className="w-full text-[10px] text-muted-foreground sm:w-auto">
          {syncNote || "Click a column name to sort. Drag the line at a column\u2019s edge to resize."}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {["all", ...KINDS.filter((k) => (items ?? []).some((i) => i.kind === k))].map((k) => (
          <button key={k} onClick={() => setTab(k)} data-track="tracker_tab"
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${tab === k ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:text-foreground"}`}>
            {k === "all" ? `All · ${(items ?? []).length}` : `${KIND_LABEL[k]} · ${(items ?? []).filter((i) => i.kind === k).length}`}
          </button>
        ))}
      </div>

      {items === null && (
        <div className="mt-4 space-y-1.5">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-foreground/5" />)}
        </div>
      )}
      {items?.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing here yet. Connect an inbox and the year you already lived fills this in.</p>
          <Link href="/setup" className="mt-3 inline-block rounded-full bg-foreground px-4 py-1.5 text-xs text-background">Connect an inbox</Link>
        </div>
      )}

      {(items?.length ?? 0) > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full table-fixed text-left text-xs" style={{ minWidth: Object.values(widths).reduce((a, b) => a + b, 84) }}>
            <colgroup>
              {COLS.map((c) => <col key={c.key} style={{ width: c.key === "actions" ? 84 : widths[c.key] }} />)}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#f3f4f6] text-muted-foreground">
              <tr>
                {COLS.map((c) => c.key === "actions" ? <th key={c.key} className="px-3 py-2" /> : (
                  <th key={c.key} className="group relative px-3 py-2 font-medium select-none">
                    <button onClick={() => setSort((sv) => ({ key: c.key, dir: sv.key === c.key ? (sv.dir === 1 ? -1 : 1) : c.key === "updated" ? -1 : 1 }))}
                            title="Sort by this column" data-track="tracker_sort"
                            className="inline-flex max-w-full items-center gap-1 truncate transition-colors hover:text-foreground">
                      {c.label}
                      {sort.key === c.key
                        ? <span aria-hidden className="text-[9px]">{sort.dir === 1 ? "\u25B2" : "\u25BC"}</span>
                        : <span aria-hidden className="text-[8px] opacity-30">{"\u25B2\u25BC"}</span>}
                    </button>
                    {/* the visible line IS the handle; nobody drags what they cannot see */}
                    <span onMouseDown={(e) => { resizing.current = { key: c.key, startX: e.clientX, startW: widths[c.key] }; document.body.style.cursor = "col-resize"; e.preventDefault(); }}
                          title="Drag to resize this column" aria-hidden
                          className="absolute right-0 top-1/2 z-10 h-2/3 w-2 -translate-y-1/2 cursor-col-resize border-r-2 border-border hover:border-[var(--blue)]" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                // Keyed by its last-updated stamp as well as its id: the cells
                // are uncontrolled inputs, so a row changed underneath us (by a
                // sync, or by a prompt) has to remount to show its new values.
                // Local edits do not touch updatedAt, so typing never remounts.
                <Row key={`${t.id}-${t.updatedAt}`} t={t} open={open === t.id}
                     onToggle={() => setOpen(open === t.id ? null : t.id)}
                     onPatch={(f) => patch(t.id, f)}
                     onDelete={async () => {
                       await fetch("/api/tracker", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id }) });
                       setItems((xs) => (xs ?? []).filter((x) => x.id !== t.id));
                     }} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function Row({ t, open, onToggle, onPatch, onDelete }: {
  t: Item; open: boolean; onToggle: () => void;
  onPatch: (f: Partial<Item>) => void; onDelete: () => void;
}) {
  const cell = "px-3 py-1.5 align-middle";
  const inputCls = "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs transition-colors hover:border-border focus:border-[var(--blue)] focus:outline-none";
  return (
    <>
      <tr className="border-t border-border transition-colors hover:bg-foreground/[0.02]"
          style={t.status === "action needed" ? { boxShadow: "inset 3px 0 0 var(--amber)" } : undefined}>
        <td className={cell}>
          <input defaultValue={t.company} title={t.company}
                 onBlur={(e) => e.target.value.trim() && e.target.value !== t.company && onPatch({ company: e.target.value.trim() })}
                 className={`${inputCls} font-medium`} aria-label="Company" />
        </td>
        <td className={cell}>
          <input defaultValue={t.role ?? ""} placeholder="add role" title={t.role ?? ""}
                 onBlur={(e) => e.target.value !== (t.role ?? "") && onPatch({ role: e.target.value })}
                 className={inputCls} aria-label="Role" />
        </td>
        <td className={cell}>
          <select value={t.kind} onChange={(e) => onPatch({ kind: e.target.value })} aria-label="Kind"
                  className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-border focus:border-[var(--blue)] focus:outline-none">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </td>
        <td className={cell}>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_DOT[t.status] ?? "#9ca3af" }} />
            <select value={t.status} onChange={(e) => onPatch({ status: e.target.value })} aria-label="Status"
                    className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-border focus:border-[var(--blue)] focus:outline-none">
              {STATUSES.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </span>
          {t.events.length > 1 && (
            <button onClick={onToggle} data-track="tracker_history"
                    className="mt-0.5 block pl-3.5 text-left text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                    title="Every earlier status, dated, each with the sentence that set it">
              history · {t.events.length} steps
            </button>
          )}
        </td>
        <td className={`${cell} tabular-nums text-muted-foreground`}>
          {t.emailDate ? new Date(t.emailDate).toLocaleDateString() : new Date(t.updatedAt).toLocaleDateString()}
        </td>
        <td className={cell}>
          <input defaultValue={t.deadline ?? ""} placeholder="add" title={t.deadline ?? ""}
                 onBlur={(e) => e.target.value !== (t.deadline ?? "") && onPatch({ deadline: e.target.value })}
                 className={inputCls} aria-label="Deadline" />
        </td>
        <td className={cell}>
          <input defaultValue={t.notes ?? ""} placeholder="add a note" title={t.notes ?? ""}
                 onBlur={(e) => e.target.value !== (t.notes ?? "") && onPatch({ notes: e.target.value })}
                 className={inputCls} aria-label="Notes" />
        </td>
        <td className={`${cell} whitespace-nowrap text-right`}>
          {t.actionLink && (
            <a href={t.actionLink} target="_blank" rel="noreferrer" title="Open the link the email sent"
               className="mr-1 inline-flex text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>
          )}
          <button onClick={onToggle} aria-label="Show the receipts" title="The journey, with quotes"
                  className="mr-1 inline-flex text-muted-foreground hover:text-foreground">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          <button onClick={onDelete} aria-label="Remove" title="Not mine"
                  className="inline-flex text-muted-foreground hover:text-red-700"><Trash2 className="h-3.5 w-3.5" /></button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-foreground/[0.02]">
          <td colSpan={8} className="px-4 py-2.5">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t.origin === "manual"
                ? "You added this one by hand. Later emails about it still land here."
                : "The journey, each step in the email\u2019s own words"}
            </p>
            <ol className="mt-1 space-y-1">
              {t.events.map((e) => <EventRow key={e.id} e={e} />)}
            </ol>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * One step of the journey, with the email it came from one click away.
 * The body renders inside a sandboxed iframe with scripts off, so a
 * recruiter's HTML can look like itself without running anything here.
 */
function EventRow({ e }: { e: Ev }) {
  const [openMail, setOpenMail] = useState(false);
  const [body, setBody] = useState<string | null | undefined>(undefined);
  const toggle = async () => {
    const next = !openMail;
    setOpenMail(next);
    if (next && body === undefined) {
      try {
        const r = await fetch(`/api/tracker?eventBody=${e.id}`).then((x) => x.json());
        setBody(r?.body ?? null);
      } catch { setBody(null); }
    }
  };
  const looksHtml = (b: string) => /<[a-z][\s\S]*>/i.test(b);
  return (
    <li className="text-xs">
      <span className="font-medium">{e.status}</span>
      <span className="text-muted-foreground"> · {e.emailDate ? new Date(e.emailDate).toLocaleDateString() : ""}</span>
      {e.fromAddr && <span className="text-muted-foreground"> · {e.fromAddr}</span>}
      {e.hasBody && (
        <button onClick={() => void toggle()} data-track="tracker_view_email"
                className="ml-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
          {openMail ? "Hide the email" : "View the email"}
          <ChevronDown className={`h-3 w-3 transition-transform ${openMail ? "rotate-180" : ""}`} />
        </button>
      )}
      {e.quote && <blockquote className="mt-0.5 border-l-2 border-border pl-2 italic text-muted-foreground">&ldquo;{e.quote}&rdquo;</blockquote>}
      {openMail && (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-border bg-white">
          {body === undefined && <div className="h-24 animate-pulse bg-foreground/5" />}
          {body === null && <p className="p-3 text-[11px] text-muted-foreground">The email itself was not stored for this step; rows from before the upgrade only kept the quote. The next scan stores full emails.</p>}
          {typeof body === "string" && (looksHtml(body)
            ? <iframe sandbox="" srcDoc={body} title="The email" className="h-80 w-full bg-white" />
            : <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-[11px] leading-relaxed">{body}</pre>)}
        </div>
      )}
    </li>
  );
}

/**
 * The row the inbox could not know about.
 *
 * Applications arrive through portals that never email, through a friend's
 * link, over the phone. A tracker that only fills itself is one a student
 * abandons the first time it misses one, so this takes everything a row can
 * hold and marks the result as entered by a person: the receipts panel will
 * say so rather than implying an email proved it.
 */
type PlannedOp = {
  action: "edit" | "add" | "delete";
  n?: number; company?: string; role?: string; kind?: string; status?: string;
  deadline?: string; notes?: string; reason: string;
  current?: { company: string; role: string | null; kind: string; status: string } | null;
};

/**
 * Say what is wrong, in a sentence, and see exactly what would change.
 *
 * Nothing is applied by the model's own authority: the request is turned into
 * a list of operations, each with the row it touches and a reason in plain
 * words, and only a person pressing the button carries them out. It is the
 * same rule the rest of this product runs on, that nothing reaches the record
 * without something you can read first.
 */
function FixWithPrompt({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [text, setText] = useState("");
  const [ops, setOps] = useState<PlannedOp[] | null>(null);
  const [unclear, setUnclear] = useState("");
  const [busy, setBusy] = useState<"plan" | "apply" | null>(null);
  const [err, setErr] = useState("");
  const [skip, setSkip] = useState<Set<number>>(new Set());

  const plan = async () => {
    setBusy("plan"); setErr(""); setOps(null); setSkip(new Set());
    const r = await fetch("/api/tracker/prompt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: text }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: "That did not go through." }));
    setBusy(null);
    if (!r.ok) { setErr(r.error ?? "That did not go through."); return; }
    setOps(r.ops ?? []); setUnclear(r.unclear ?? "");
  };

  const apply = async () => {
    if (!ops) return;
    setBusy("apply"); setErr("");
    const chosen = ops.filter((_, i) => !skip.has(i));
    const r = await fetch("/api/tracker/prompt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply: chosen }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: "That did not save." }));
    setBusy(null);
    if (!r.ok) { setErr(r.error ?? "That did not save."); return; }
    onApplied();
  };

  const verb = { edit: "Change", add: "Add", delete: "Delete" } as const;
  const tone = { edit: "var(--blue)", add: "var(--teal)", delete: "#b91c1c" } as const;

  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal>
      <div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            {!ops ? (
              <>
              <h2 className="font-display text-lg font-semibold">Fix with a prompt</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Describe everything you want changed, in your own words, across as many rows as you like.
                You will see exactly what it intends to do before anything happens.
              </p>
              </>
            ) : (
              <h2 className="font-display text-lg font-semibold">Review the changes</h2>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!ops && (
        <>
        <div className="mt-3 rounded-xl bg-foreground/[0.03] p-3">
          <p className="text-[11px] font-medium">What it can do</p>
          <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
            <li><strong>Edit anything, in bulk</strong> — company, role, kind, status, deadline, notes. &ldquo;The Stripe one went to interview, and the deadline is 12 September.&rdquo;</li>
            <li><strong>Fix what the inbox got wrong</strong> — &ldquo;Anything from Fauji is one company, call them all Fauji Fertilizer, and they are jobs not internships.&rdquo;</li>
            <li><strong>Add rows it never saw</strong> — &ldquo;Add Jane Street, quant intern, applied last Tuesday through the portal.&rdquo;</li>
            <li><strong>Delete what does not belong</strong> — &ldquo;Drop the two scholarship rows I never applied to.&rdquo;</li>
            <li><strong>Several at once</strong> — write it all in one go; each change is listed separately for you to approve or skip.</li>
          </ul>
        </div>

        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus
          placeholder="Mark everything from Google as rejected, rename the two Mitacs rows to Mitacs Globalink, add Jane Street as a quant internship I applied to last week, and delete the Deriv row."
          className="mt-3 w-full resize-y rounded-lg border border-border p-2.5 text-sm focus:border-[var(--blue)] focus:outline-none"
        />
        </>)}

        {err && <p className="mt-2 text-xs" style={{ color: "#b91c1c" }}>{err}</p>}

        {ops && (
          <div className="mt-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              {ops.length === 0 ? "Nothing to change" : `${ops.length - skip.size} change${ops.length - skip.size === 1 ? "" : "s"} ready, nothing applied yet`}
            </p>
            {!!unclear && <p className="mt-1 text-[11px]" style={{ color: "var(--amber-deep, #92400e)" }}>{unclear}</p>}
            <ul className="mt-1.5 max-h-72 space-y-1.5 overflow-y-auto">
              {ops.map((op, i) => (
                <li key={i} className={`rounded-lg border border-border p-2.5 text-xs transition-opacity ${skip.has(i) ? "opacity-40" : ""}`}>
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 font-medium" style={{ color: tone[op.action] }}>{verb[op.action]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {op.current ? `${op.current.company}${op.current.role ? ` · ${op.current.role}` : ""}` : `${op.company ?? "new row"}${op.role ? ` · ${op.role}` : ""}`}
                      </p>
                      {op.action === "edit" && (
                        <p className="text-muted-foreground">
                          {(["company", "role", "kind", "status", "deadline", "notes"] as const)
                            .filter((f) => op[f] !== undefined && op[f] !== "")
                            .map((f) => `${f}: ${op.current && f in op.current ? `${(op.current as Record<string, unknown>)[f] ?? "empty"} → ` : ""}${op[f]}`)
                            .join(" · ")}
                        </p>
                      )}
                      <p className="mt-0.5 text-muted-foreground">{op.reason}</p>
                    </div>
                    <button onClick={() => setSkip((sv) => { const n = new Set(sv); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                            className="shrink-0 text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                      {skip.has(i) ? "include" : "skip"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!ops ? (
            <button onClick={() => void plan()} disabled={busy !== null || text.trim().length < 4} data-track="tracker_prompt_plan"
                    className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-50">
              {busy === "plan" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy === "plan" ? "Working out what you mean" : "See what would change"}
            </button>
          ) : (
            <>
              <button onClick={() => void apply()} disabled={busy !== null || ops.length - skip.size === 0} data-track="tracker_prompt_apply"
                      className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-50">
                {busy === "apply" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy === "apply" ? "Applying" : `Apply ${ops.length - skip.size} change${ops.length - skip.size === 1 ? "" : "s"}`}
              </button>
              <button onClick={() => { setOps(null); setUnclear(""); }} className="rounded-full border border-border px-5 py-2 text-sm">
                Rewrite the request
              </button>
            </>
          )}
          <button onClick={onClose} className="rounded-full border border-border px-5 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AddApplication({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    company: "", role: "", kind: "internship", status: "applied",
    date: new Date().toISOString().slice(0, 10), deadline: "", actionLink: "", notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    if (!f.company.trim()) { setErr("A company or organisation, at least."); return; }
    setBusy(true); setErr("");
    const r = await fetch("/api/tracker", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, emailDate: f.date ? new Date(f.date).getTime() : Date.now() }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: "That did not save. Try again." }));
    setBusy(false);
    if (r.ok) onSaved(); else setErr(r.error ?? "That did not save.");
  };

  const field = "w-full rounded-lg border border-border px-2.5 py-1.5 text-sm focus:border-[var(--blue)] focus:outline-none";
  const label = "text-[11px] font-medium text-muted-foreground";
  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-black/40 p-4"
         role="dialog" aria-modal onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="my-8 w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Add an application</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              For anything your inbox never announced. It joins the table as a normal row you can edit,
              filter and export, marked as entered by you rather than proved by an email.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className={label}>Company or organisation</span>
            <input autoFocus value={f.company} onChange={set("company")} placeholder="Stripe, Columbia, Mitacs"
                   className={field} />
          </label>
          <label className="sm:col-span-2">
            <span className={label}>Role or programme</span>
            <input value={f.role} onChange={set("role")} placeholder="Software Engineering Intern" className={field} />
          </label>
          <label>
            <span className={label}>Kind</span>
            <select value={f.kind} onChange={set("kind")} className={field}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label>
            <span className={label}>Where it stands</span>
            <select value={f.status} onChange={set("status")} className={field}>
              {STATUSES.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <label>
            <span className={label}>Date of this status</span>
            <input type="date" value={f.date} onChange={set("date")} className={field} />
          </label>
          <label>
            <span className={label}>Deadline, if any</span>
            <input value={f.deadline} onChange={set("deadline")} placeholder="within 5 days, or 12 Jan" className={field} />
          </label>
          <label className="sm:col-span-2">
            <span className={label}>Link</span>
            <input value={f.actionLink} onChange={set("actionLink")} placeholder="https://..." className={field} inputMode="url" />
          </label>
          <label className="sm:col-span-2">
            <span className={label}>Notes</span>
            <textarea value={f.notes} onChange={set("notes")} rows={2}
                      placeholder="Referred by Sara. Recruiter said decisions go out in March."
                      className={`${field} resize-y`} />
          </label>
        </div>

        {err && <p className="mt-2 text-xs" style={{ color: "#b91c1c" }}>{err}</p>}

        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => void save()} disabled={busy} data-track="tracker_add_save"
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background disabled:opacity-50">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {busy ? "Saving" : "Add it to the tracker"}
          </button>
          <button onClick={onClose} className="rounded-full border border-border px-5 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-[60vh] items-center justify-center px-4">{children}</main>;
}
