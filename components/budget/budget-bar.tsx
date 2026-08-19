"use client";

import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, Loader2, RefreshCw, TriangleAlert, X, Globe} from "lucide-react";
import { usePathname } from "next/navigation";
import { usd, useBudget } from "./budget-provider";

/**
 * The money bar. Pinned to the top because spend is not a settings-screen
 * concern when you are the one paying for the key.
 *
 * What it shows depends on what the provider is willing to say. OpenRouter
 * publishes a limit and a remaining balance, so it shows used, a meter, and
 * left. Anthropic publishes neither for a console key, so it shows what this
 * app has spent in total and says plainly that the balance isn't available,
 * rather than inventing a denominator.
 */
export function BudgetBar() {
  const { budget, loading, totalSpend, totalCalls, refresh, setKey, clearKey } = useBudget();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [tavily, setTavily] = useState<{ used: number; limit: number | null; left: number | null } | null>(null);

  // Read once on mount and again whenever the money figure moves, which is a
  // good enough proxy for "something happened" without polling.
  useEffect(() => {
    let alive = true;
    fetch("/api/alumni")
      .then((r) => r.json())
      .then((j) => { if (alive && j?.ok) setTavily(j.usage); })
      .catch(() => {});
    return () => { alive = false; };
  }, [totalCalls]);

  const path = usePathname();
  // The survey owns a full-bleed blue screen; a white bar across one reads as
  // a rendering fault, so the bar carries the blue there. The landing is
  // cream paper now and keeps the light bar.
  const onBlue = path === "/start";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await setKey(draft);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? "That key didn't work."); return; }
    setDraft("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
    setOpen(false);
  };

  const limit = budget?.limit ?? null;
  const used = budget?.used ?? null;
  const left = budget?.left ?? null;
  const hasBalance = !budget?.balanceUnavailable && limit != null && left != null;
  const pct = hasBalance && limit! > 0 ? Math.min(100, Math.max(0, ((used ?? 0) / limit!) * 100)) : null;
  const low = hasBalance && left! < limit! * 0.1;

  const dim = onBlue ? "text-white/55" : "text-muted-foreground";

  return (
    <div className={`no-print relative z-50 shrink-0 border-b backdrop-blur ${
      onBlue ? "border-white/15 bg-[var(--blue-deep)] text-white"
             : "border-border bg-background/95 supports-[backdrop-filter]:bg-background/80"
    }`}>
      <div className="mx-auto flex max-w-[1600px] items-center gap-x-2 overflow-hidden whitespace-nowrap px-3 py-1.5 sm:gap-x-5 sm:gap-y-2 sm:px-4 lg:px-8">
        <span className={`hidden shrink-0 label text-[10px] sm:inline ${dim}`}>
          {budget?.providerName ?? "API key"}
        </span>

        {loading ? (
          <span className={`flex items-center gap-2 text-xs ${dim}`}>
            <Loader2 className="h-3 w-3 animate-spin" /> reading balance
          </span>
        ) : !budget?.connected ? (
          <span className="flex items-center gap-2 text-xs min-w-0" style={{ color: onBlue ? "#ffd7d2" : "var(--clay)" }}>
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{budget?.error ?? budget?.message ?? "No key connected"}</span>
          </span>
        ) : hasBalance ? (
          /* ── the provider publishes a balance ───────────────────────────── */
          <div className="flex min-w-0 shrink items-center gap-2 sm:gap-3">
            <span className="tabular shrink-0 text-sm font-medium">{usd(used)}</span>
            <span className={`shrink-0 label text-[10px] ${dim}`}>used</span>

            <span
              className={`relative hidden h-1.5 w-28 shrink-0 overflow-hidden rounded-full sm:inline-block sm:w-40 ${onBlue ? "bg-white/20" : "bg-foreground/10"}`}
              role="meter"
              aria-valuenow={Math.round((used ?? 0) * 100) / 100}
              aria-valuemin={0}
              aria-valuemax={limit ?? undefined}
              aria-label={`${usd(used)} used of ${usd(limit)}`}
            >
              <span
                className="rail-fill absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${pct}%`,
                  background: low ? "var(--clay)" : onBlue ? "var(--blue-light)" : "var(--blue)",
                }}
              />
            </span>

            <span className="tabular shrink-0 text-sm font-medium" style={low ? { color: "var(--clay)" } : undefined}>
              {usd(left)}
            </span>
            <span className={`shrink-0 label text-[10px] ${dim}`}>left</span>
          </div>
        ) : (
          /* ── no balance endpoint: show what this app has spent in total ─── */
          <div className="flex min-w-0 shrink items-center gap-x-2 sm:gap-x-3">
            <span className="tabular shrink-0 text-sm font-medium">{usd(totalSpend, 4)}</span>
            <span className={`label text-[10px] ${dim}`}>
              spent · {totalCalls} call{totalCalls === 1 ? "" : "s"}
            </span>
            <span className={`hidden truncate text-xs lg:inline ${dim}`}>
              {budget.providerName} publishes no balance for this key
            </span>
          </div>
        )}

        {/* Where a balance does exist, this app's own total is still the number
            you want before hitting solve again. */}
        {budget?.connected && hasBalance && (
          <>
            <span className={`hidden h-3 w-px lg:block ${onBlue ? "bg-white/20" : "bg-border"}`} />
            <span className={`hidden text-xs lg:inline ${dim}`}>
              this app has spent{" "}
              <span className={`tabular font-medium ${onBlue ? "text-white" : "text-foreground"}`}>
                {usd(totalSpend, 4)}
              </span>
              <span className="ml-1.5">· {totalCalls} call{totalCalls === 1 ? "" : "s"}</span>
            </span>
          </>
        )}

        {/* Web search runs on its own quota, so it gets its own number rather
            than being folded into a total that means two different things. */}
        {tavily && tavily.limit != null && (
          <span className={`hidden shrink-0 items-center gap-1.5 sm:flex ${dim}`}>
            <span className="hidden h-3 w-px bg-border sm:block" />
            <Globe className="h-3 w-3 shrink-0" />
            <span className="tabular text-xs">
              {tavily.used}
              <span className="opacity-50">/{tavily.limit}</span>
            </span>
            <span className="hidden label text-[10px] lg:inline">web searches used</span>
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-[11px]" style={{ color: onBlue ? "var(--blue-light)" : "var(--teal)" }}>
              <Check className="h-3 w-3" /> key swapped
            </span>
          )}
          <span className={`hidden label text-[10px] lg:inline ${dim}`}>Haiku 4.5 only</span>
          <button
            onClick={() => void refresh()}
            className={`no-tap hidden rounded-full p-1 transition-colors sm:block ${onBlue ? "text-white/60 hover:text-white" : "text-muted-foreground hover:text-foreground"}`}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {(budget as { canEdit?: boolean } | null)?.canEdit !== false && (
          <button
            onClick={() => setOpen((v) => !v)}
            className={`no-tap flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors sm:px-3 ${
              onBlue ? "border-white/30 hover:bg-white/10" : "border-border hover:bg-[var(--blue-soft)]"
            }`}
            aria-expanded={open}
            aria-haspopup="dialog"
          >
            <KeyRound className="h-3 w-3" />
            <span className="hidden sm:inline">{budget?.masked ?? "add key"}</span>
            <span className="sm:hidden">{budget?.connected ? "key" : "add key"}</span>
          </button>
          )}
        </span>
      </div>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="API key"
          className="absolute right-4 top-full z-50 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-border bg-white p-5 text-foreground shadow-xl lg:right-8"
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold">Use a different key</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Works with an <strong>OpenRouter</strong> key (<code>sk-or-…</code>) or an{" "}
                <strong>Anthropic Console</strong> key (<code>sk-ant-…</code>). Either way it runs
                Haiku 4.5. The key is checked before it is stored, is never sent to your browser,
                and the old one is discarded along with its tally.
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <input
            id="api-key"
            type="password"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) void submit(); }}
            placeholder="sk-or-v1-…   or   sk-ant-api03-…"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-[var(--blue)]"
          />

          {error && (
            <p className="mt-2 flex items-start gap-1.5 text-sm" style={{ color: "var(--clay)" }}>
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => void submit()}
              disabled={busy || !draft.trim()}
              className="flex items-center gap-2 rounded-full bg-[var(--blue)] px-5 py-2.5 text-sm text-white transition-opacity disabled:opacity-40"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Use this key
            </button>
            {budget?.source === "user" && (
              <button
                onClick={() => void clearKey()}
                className="rounded-full border border-border px-5 py-2.5 text-sm transition-colors hover:bg-[var(--blue-soft)]"
              >
                Remove
              </button>
            )}
          </div>

          {!!budget?.recent?.length && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="label text-[10px] text-muted-foreground">Recent calls</p>
              <ul className="mt-2 space-y-1">
                {budget.recent.map((r, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-[11px]">
                    <span className="truncate text-muted-foreground">{r.purpose}</span>
                    <span className="tabular shrink-0">{usd(r.costUsd, 5)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
