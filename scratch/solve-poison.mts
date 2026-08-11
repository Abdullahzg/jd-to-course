import { readFileSync } from "fs";
import { solve } from "../lib/solver";
const base = JSON.parse(readFileSync("scratch/solve-payload.json", "utf8"));
type Hit = { skill: string; strength?: string; rank?: number };
const W: Record<string, number> = { central: 0, useful: 1, tangential: 2 };
const score = (hits: Hit[]) => Math.min(...hits.map((h) => (W[h.strength ?? "useful"] ?? 1) * 1000 + (h.rank ?? 500)));
const order = Object.entries(base.relevance as Record<string, Hit[]>).sort((a,b)=>score(a[1])-score(b[1])).map(([k])=>k);
for (const id of order.slice(0, 8)) {
  const trimmed = { [id]: (base.relevance as Record<string, Hit[]>)[id] };
  const t0 = Date.now();
  const r = solve({ ...base, relevance: trimmed }, 6000, 1_200_000);
  console.log(`${id.padEnd(24)} alone: ok=${r.ok} in ${Date.now()-t0}ms`);
}
