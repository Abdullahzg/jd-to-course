import { readFileSync } from "fs";
import { solve } from "../lib/solver";
const base = JSON.parse(readFileSync("scratch/solve-payload.json", "utf8"));
type Hit = { skill: string; strength?: string; rank?: number };
const W: Record<string, number> = { central: 0, useful: 1, tangential: 2 };
const score = (hits: Hit[]) =>
  Math.min(...hits.map((h) => (W[h.strength ?? "useful"] ?? 1) * 1000 + (h.rank ?? 500)));
for (const n of [14, 12, 10]) {
  const keep = new Set(Object.entries(base.relevance as Record<string, Hit[]>)
    .sort((a, b) => score(a[1]) - score(b[1])).slice(0, n).map(([k]) => k));
  const trimmed = Object.fromEntries(Object.entries(base.relevance as Record<string, Hit[]>).filter(([k]) => keep.has(k)));
  const t0 = Date.now();
  const r = solve({ ...base, relevance: trimmed }, 15000, 4_000_000);
  console.log(`top ${n}: ok=${r.ok} in ${Date.now() - t0}ms ${r.ok ? `plans=${r.plans.length} covered=${r.plans[0]?.skillsCovered?.length}` : ""}`);
}
