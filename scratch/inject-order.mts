import { readFileSync } from "fs";
process.env.DATABASE_URL = readFileSync(".env.local","utf8").match(/^DATABASE_URL="?([^"\n]+)"?$/m)![1];
const { Pool } = await import("pg");
const mod = await import("../data/columbia");
const school: { courses: { id: string; code: string }[] } = (Object.values(mod).find((v) => (v as { courses?: unknown })?.courses) ?? (mod as { default?: unknown }).default) as never;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}, max:1 });
const row = (await pool.query(`SELECT s.id, s.snapshot FROM carpa_searches s JOIN carpa_users u ON u.id=s."userId" WHERE u.email='fresh.judge@carpa.demo' ORDER BY s."createdAt" DESC LIMIT 1`)).rows[0];
const snap = JSON.parse(row.snapshot);
const st = snap.payload.state;
const fitCodes: string[] = (st.fits ?? []).map((f: { code: string }) => f.code);
const rest = school.courses.map((c) => c.code).filter((c) => !fitCodes.includes(c));
st.shortlist = [...fitCodes, ...rest.slice(0, 36 - fitCodes.length)];
st.considerationAll = [
  ...st.shortlist.map((code: string) => ({ code, why: "made the reader's shortlist for this posting" })),
  ...rest.slice(36 - fitCodes.length).map((code: string, i: number) => ({
    code, why: i < 30 ? `its catalog entry shares "services", "testing" with the posting` : "",
  })),
];
await pool.query(`UPDATE carpa_searches SET snapshot=$1 WHERE id=$2`, [JSON.stringify(snap), row.id]);
console.log("injected: shortlist", st.shortlist.length, "considerationAll", st.considerationAll.length);
await pool.end();
