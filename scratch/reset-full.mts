import { readFileSync } from "fs";
process.env.DATABASE_URL = readFileSync(".env.local","utf8").match(/^DATABASE_URL="?([^"\n]+)"?$/m)![1];
const { Pool } = await import("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false}, max:1 });
const uid = (await pool.query(`SELECT id FROM carpa_users WHERE email='judge.real@carpa.demo'`)).rows[0]?.id;
if (uid) {
  await pool.query(`DELETE FROM carpa_tracker_events WHERE "itemId" IN (SELECT id FROM carpa_tracker WHERE "userId"=$1)`, [uid]);
  await pool.query(`DELETE FROM carpa_tracker WHERE "userId"=$1`, [uid]);
  await pool.query(`DELETE FROM carpa_mail_state WHERE "userId"=$1`, [uid]);
  await pool.query(`DELETE FROM carpa_seen_emails WHERE "userId"=$1`, [uid]);
  await pool.query(`DELETE FROM carpa_scan_jobs WHERE "userId"=$1`, [uid]);
  console.log("judge.real fully reset for a whole-inbox backfill");
}
await pool.end();
