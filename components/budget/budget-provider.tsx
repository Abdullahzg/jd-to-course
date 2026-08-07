"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type BudgetSnapshot = {
  connected: boolean;
  source: "user" | "env" | "none";
  provider?: "openrouter" | "anthropic" | null;
  providerName?: string | null;
  masked?: string;
  fingerprint?: string;
  label?: string;
  /** dollars spent against a limit, when the provider publishes one */
  used?: number | null;
  left?: number | null;
  limit?: number | null;
  /** the provider does not expose a balance for this key */
  balanceUnavailable?: boolean;
  /** dollars this app has spent on this key, as seen by the server instance */
  spentHere?: number;
  callsHere?: number;
  recent?: { purpose: string; provider: string; model: string; costUsd: number; promptTokens: number; completionTokens: number; at: number }[];
  error?: string;
  message?: string;
};

type Ctx = {
  budget: BudgetSnapshot | null;
  loading: boolean;
  /** everything this app has ever spent on the live key, from this browser */
  totalSpend: number;
  totalCalls: number;
  /** every AI route returns `costUsd`; hand it here so the bar stays truthful */
  noteSpend: (costUsd: number | undefined) => void;
  refresh: () => Promise<void>;
  setKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  clearKey: () => Promise<void>;
};

const BudgetCtx = createContext<Ctx | null>(null);

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const [budget, setBudget] = useState<BudgetSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [totalSpend, setTotalSpend] = useState(0);
  const [totalCalls, setTotalCalls] = useState(0);
  const fingerprint = useRef<string | null>(null);

  /**
   * The running total is kept per key in localStorage, keyed by the key's
   * fingerprint. The server-side tally only survives inside one serverless
   * instance, and neither provider reports "what this app spent", so this is
   * the only figure that is both durable and about *this* app.
   */
  const loadTotal = useCallback((fp: string) => {
    try {
      const raw = localStorage.getItem(`coursepath.spend.${fp}`);
      if (!raw) { setTotalSpend(0); setTotalCalls(0); return; }
      const { usd, calls } = JSON.parse(raw);
      setTotalSpend(Number(usd) || 0);
      setTotalCalls(Number(calls) || 0);
    } catch { /* a corrupt entry is not worth a crash */ }
  }, []);

  const noteSpend = useCallback((costUsd: number | undefined) => {
    if (typeof costUsd !== "number" || !isFinite(costUsd) || costUsd <= 0) return;
    setTotalSpend((s) => {
      const next = s + costUsd;
      setTotalCalls((c) => {
        const calls = c + 1;
        const fp = fingerprint.current;
        if (fp) {
          try {
            localStorage.setItem(`coursepath.spend.${fp}`, JSON.stringify({ usd: next, calls }));
          } catch { /* quota; the number still shows for this page */ }
        }
        return calls;
      });
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/budget", { cache: "no-store" });
      const snap: BudgetSnapshot = await res.json();
      setBudget(snap);
      if (snap.fingerprint && snap.fingerprint !== fingerprint.current) {
        fingerprint.current = snap.fingerprint;
        loadTotal(snap.fingerprint);
      }
    } catch {
      setBudget({ connected: false, source: "none", error: "Couldn't read the budget." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const setKey = useCallback(async (key: string) => {
    const res = await fetch("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) return { ok: false, error: json.error ?? "That key didn't work." };
    // The response already carries the new key's own usage and remaining
    // limit, so the bar recomputes the moment the swap lands. The session
    // tally belongs to the key that spent it, so it goes back to zero.
    setBudget(json);
    // The tally belongs to the key that spent it, so a swap loads that key's
    // own history rather than carrying the old key's forward.
    fingerprint.current = json.fingerprint ?? null;
    if (json.fingerprint) loadTotal(json.fingerprint); else { setTotalSpend(0); setTotalCalls(0); }
    return { ok: true };
  }, []);

  const clearKey = useCallback(async () => {
    const res = await fetch("/api/budget", { method: "DELETE" });
    const snap: BudgetSnapshot = await res.json();
    setBudget(snap);
    fingerprint.current = snap.fingerprint ?? null;
    if (snap.fingerprint) loadTotal(snap.fingerprint); else { setTotalSpend(0); setTotalCalls(0); }
  }, [loadTotal]);

  const value = useMemo(
    () => ({ budget, loading, totalSpend, totalCalls, noteSpend, refresh, setKey, clearKey }),
    [budget, loading, totalSpend, totalCalls, noteSpend, refresh, setKey, clearKey],
  );

  return <BudgetCtx.Provider value={value}>{children}</BudgetCtx.Provider>;
}

export function useBudget(): Ctx {
  const ctx = useContext(BudgetCtx);
  if (!ctx) throw new Error("useBudget must be used inside BudgetProvider");
  return ctx;
}

export const usd = (n: number | null | undefined, digits = 2) =>
  n == null ? "n/a" : `$${n.toFixed(digits)}`;
