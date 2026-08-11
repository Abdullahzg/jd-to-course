import { readFileSync } from "fs";
import { solveResilient } from "../lib/solver";
const base = JSON.parse(readFileSync("scratch/solve-payload.json", "utf8"));
const t0 = Date.now();
const r = solveResilient(base, 8000);
console.log(`resilient: ok=${r.ok} in ${Math.round((Date.now()-t0)/1000)}s plans=${r.ok?r.plans.length:0} covered=${r.ok?r.plans[0]?.skillsCovered?.length:"-"} shed=${JSON.stringify(r.shedForTime??[])}`);
