"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ChevronDown, Download, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { StatusPill } from "@/app/home/page";

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
  updatedAt: number; events: Ev[];
};

const KINDS = ["internship", "job", "research", "grad school", "scholarship", "hackathon", "program", "other"];
const STATUSES = ["applied", "assessment", "interview", "offer", "accepted", "rejected", "waitlisted", "action needed", "update"];
const KIND_LABEL: Record<string, string> = {
  internship: "Internships", job: "Jobs", research: "Research", "grad school": "Grad school",
  scholarship: "Scholarships", hackathon: "Hackathons", program: "Programs", other: "Everything else",
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

  const patch = (id: string, fields: Partial<Item>) => {
    // Optimistic: the cell changes under the cursor, the server catches up,
    // and a failure puts the truth back on the next load.
    setItems((xs) => (xs ?? []).map((x) => (x.id === id ? { ...x, ...fields } : x)));
    void fetch("/api/tracker", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...fields }) });
  };

  const visible = useMemo(
    () => (items ?? []).filter((i) => tab === "all" || i.kind === tab),
    [items, tab],
  );

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

  const actions = (items ?? []).filter((i) => i.status === "action needed" || (i.status === "assessment" && i.deadline));

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
          <button onClick={exportCsv} disabled={!items?.length} data-track="tracker_export"
                  className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background disabled:opacity-40">
            <Download className="h-3.5 w-3.5" /> Export for Excel (CSV)
          </button>
          <Link href="/home" className="text-xs text-muted-foreground underline underline-offset-2">home</Link>
        </div>
      </div>

      {/* the season at a glance, before any scrolling */}
      {(items ?? []).length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "In motion", dot: "#3b82f6", n: (items ?? []).filter((i) => ["applied", "assessment", "update", "waitlisted"].includes(i.status)).length },
            { label: "Interviews", dot: "#8b5cf6", n: (items ?? []).filter((i) => i.status === "interview").length },
            { label: "Offers and accepts", dot: "#10b981", n: (items ?? []).filter((i) => ["offer", "accepted"].includes(i.status)).length },
            { label: "Needs your hands", dot: "var(--amber)", n: (items ?? []).filter((i) => i.status === "action needed").length },
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
          <table className="w-full min-w-[880px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#f3f4f6] text-muted-foreground">
              <tr>
                {["Company", "Role", "Kind", "Status", "Updated", "Deadline", "Notes", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <Row key={t.id} t={t} open={open === t.id}
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
      <tr className="border-t border-border">
        <td className={cell}>
          <input defaultValue={t.company} onBlur={(e) => e.target.value.trim() && e.target.value !== t.company && onPatch({ company: e.target.value.trim() })}
                 className={`${inputCls} font-medium`} aria-label="Company" />
        </td>
        <td className={cell}>
          <input defaultValue={t.role ?? ""} placeholder="add role" onBlur={(e) => e.target.value !== (t.role ?? "") && onPatch({ role: e.target.value })}
                 className={inputCls} aria-label="Role" />
        </td>
        <td className={cell}>
          <select value={t.kind} onChange={(e) => onPatch({ kind: e.target.value })} aria-label="Kind"
                  className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-border focus:border-[var(--blue)] focus:outline-none">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </td>
        <td className={cell}>
          <select value={t.status} onChange={(e) => onPatch({ status: e.target.value })} aria-label="Status"
                  className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-border focus:border-[var(--blue)] focus:outline-none">
            {STATUSES.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <StatusPill status={t.status} />
        </td>
        <td className={`${cell} tabular-nums text-muted-foreground`}>
          {t.emailDate ? new Date(t.emailDate).toLocaleDateString() : new Date(t.updatedAt).toLocaleDateString()}
        </td>
        <td className={cell}>
          <input defaultValue={t.deadline ?? ""} placeholder="add" onBlur={(e) => e.target.value !== (t.deadline ?? "") && onPatch({ deadline: e.target.value })}
                 className={`${inputCls} w-24`} aria-label="Deadline" />
        </td>
        <td className={cell}>
          <input defaultValue={t.notes ?? ""} placeholder="add a note" onBlur={(e) => e.target.value !== (t.notes ?? "") && onPatch({ notes: e.target.value })}
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
            <p className="text-[11px] font-medium text-muted-foreground">The journey, each step in the email&rsquo;s own words</p>
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

function Center({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-[60vh] items-center justify-center px-4">{children}</main>;
}
