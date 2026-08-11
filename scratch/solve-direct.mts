import { readFileSync } from "fs";
import { solve } from "../lib/solver";
const payload = JSON.parse(readFileSync("scratch/solve-payload.json", "utf8"));
for (const [budget, nodes] of [[8000, undefined], [20000, 2_000_000], [60000, 20_000_000]] as const) {
  const t0 = Date.now();
  const r = solve(payload, budget as number, nodes as number | undefined);
  console.log(`budget ${budget}ms nodes ${nodes ?? "default"}: ok=${r.ok} in ${Date.now() - t0}ms`,
    r.ok ? `plans=${r.plans.length}` : `timedOut=${r.infeasibility?.timedOut}`);
  if (r.ok) break;
}
