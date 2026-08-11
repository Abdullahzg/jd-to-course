// skills -> fit (non-stream) -> solve, mimicking the survey exactly.
import { readFileSync, writeFileSync } from "node:fs";
const SP = process.argv[2];
const jd = readFileSync(`${SP}/jd_backend.txt`, "utf8");
const base = "http://localhost:3000";

const cat = await fetch(`${base}/api/catalog`).then(r=>r.json());
const school = cat.schools.find(s=>s.id==="COLUMBIA") ?? cat.schools[0];
const pool = school.courses.map(c=>c.id);

const sk = await fetch(`${base}/api/skills`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jd})}).then(r=>r.json());
const facets = sk.facets ?? [];
console.log("facets:", facets.length, facets.map(f=>`${f.name}(${f.actor??"?"})`).join(", ").slice(0,220));

console.log("fit running (non-stream)...");
const t0=Date.now();
const rl = await fetch(`${base}/api/fit`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jd, schoolId:school.id, courseIds:pool, facets, stream:false})}).then(r=>r.json());
console.log("fit done in", Math.round((Date.now()-t0)/1000)+"s | fits:", (rl.fits??[]).length, "| shortlist:", (rl.shortlistCodes??[]).length, "| considerationAll:", (rl.considerationAll??[]).length, "| cost:", rl.costUsd);
console.log("considerationAll sample:", JSON.stringify((rl.considerationAll??[]).slice(36,39)));

const relevance = {};
for (const f of rl.fits ?? []) for (const a of f.aspects ?? []) {
  (relevance[f.courseId] ??= []).push({ skill:a, evidence:f.courseQuote, strength:f.strength, why:f.aspectWhy?.[a], rank:f.rank });
}
const centrality = Object.fromEntries(facets.map(f=>[f.name, f.weight]));
const payload = {
  schoolId: school.id, programId: "COLUMBIA:CS_BA",
  student: { program:"COLUMBIA:CS_BA", completed:[], startTerm:"FA", horizonTerms:4, locked:[], excluded:[], completedCredits:0 },
  targetSkills: facets.map(f=>f.name), skillMatches:{}, relevance, centrality, k:3,
};
writeFileSync("scratch/solve-payload.json", JSON.stringify(payload));
console.log("relevance courses:", Object.keys(relevance).length, "| central hits:", Object.values(relevance).flat().filter(h=>h.strength==="central").length);
const t1=Date.now();
const sv = await fetch(`${base}/api/solve`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).then(r=>r.json());
console.log("solve:", sv.ok, "in", Math.round((Date.now()-t1)/1000)+"s", sv.ok? `plans:${sv.plans.length}` : JSON.stringify(sv.infeasibility).slice(0,160));
