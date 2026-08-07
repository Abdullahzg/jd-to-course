// Pulls one bulletin page per course code and commits it as a snapshot.
// Every description the planner later quotes has to be traceable to one of
// these files, so the raw HTML is kept exactly as served.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const codes = readFileSync('/tmp/codes.txt', 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
mkdirSync('data/snapshots/courses', { recursive: true });
const CONC = 6, sleep = ms => new Promise(r => setTimeout(r, ms));
let done = 0, failed = [];
async function one(code) {
  const slug = code.replace(/\s+/g, '');
  const path = `data/snapshots/courses/${slug}.html`;
  if (existsSync(path)) { done++; return; }
  const url = `https://bulletin.columbia.edu/search/?P=${encodeURIComponent(code)}`;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (course-planner research)' } });
      if (!r.ok) throw new Error('http ' + r.status);
      const html = await r.text();
      writeFileSync(path, html);
      done++; return;
    } catch (e) { await sleep(900 * (a + 1)); if (a === 2) failed.push(code + ': ' + e.message); }
  }
}
for (let i = 0; i < codes.length; i += CONC) {
  await Promise.all(codes.slice(i, i + CONC).map(one));
  await sleep(320);
  if (i % 30 === 0) console.log(`  ${done}/${codes.length}`);
}
console.log(`fetched ${done}/${codes.length}, failed ${failed.length}`);
if (failed.length) console.log(failed.slice(0, 10).join('\n'));
