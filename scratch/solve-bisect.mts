import { readFileSync } from "fs";
import { solve } from "../lib/solver";
const base = JSON.parse(readFileSync("scratch/solve-payload.json", "utf8"));
const t = (name: string, p: unknown) => {
  const t0 = Date.now();
  const r = solve(p as never, 12000, 4_000_000);
  console.log(`${name}: ok=${r.ok} in ${Date.now() - t0}ms ${r.ok ? "" : "timedOut=" + r.infeasibility?.timedOut}`);
  return r.ok;
};
t("as-is", base);
t("horizon 8", { ...base, student: { ...base.student, horizonTerms: 8 } });
t("no relevance", { ...base, relevance: {}, targetSkills: [] });
const noCentral = Object.fromEntries(Object.entries(base.relevance).map(([k, v]) => [k, (v as {strength:string}[]).map((h) => ({ ...h, strength: h.strength === "central" ? "useful" : h.strength }))]));
t("centrals downgraded", { ...base, relevance: noCentral });
t("k=1", { ...base, k: 1 });
const centrals = Object.entries(base.relevance).filter(([,v]) => (v as {strength:string}[]).some(h=>h.strength==="central")).map(([k])=>k);
console.log("central courses:", centrals.join(", "));
