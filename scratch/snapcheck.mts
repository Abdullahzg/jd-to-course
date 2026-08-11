import { readFileSync } from "fs";
process.env.DATABASE_URL = readFileSync(".env.local","utf8").match(/^DATABASE_URL="?([^"\n]+)"?$/m)![1];
const { Pool } = await import("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}, max:1 });
const r = (await pool.query(`SELECT s.snapshot FROM carpa_searches s JOIN carpa_users u ON u.id=s."userId" WHERE u.email='fresh.judge@carpa.demo' ORDER BY s."createdAt" DESC LIMIT 1`)).rows[0];
if (!r) { console.log("no search"); process.exit(0); }
const snap = JSON.parse(r.snapshot);
const st = snap.payload?.state ?? {};
console.log("shortlist:", (st.shortlist??[]).length, "| considerationAll:", (st.considerationAll??[]).length, "| fits:", (st.fits??[]).length);
console.log("sample:", JSON.stringify((st.considerationAll??[]).slice(40,42)));
await pool.end();
