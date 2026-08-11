import { readFileSync } from "fs";
process.env.DATABASE_URL = readFileSync(".env.local","utf8").match(/^DATABASE_URL="?([^"\n]+)"?$/m)![1];
const { Pool } = await import("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}, max:1 });
const j = (await pool.query(`SELECT status, phase, done, total, found, created, updated, "costUsd", error FROM carpa_scan_jobs ORDER BY "createdAt" DESC LIMIT 1`)).rows[0];
console.log(JSON.stringify(j));
await pool.end();
