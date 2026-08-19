import { Pool, types } from "pg";

/**
 * One Postgres, nine tables, every one prefixed carpa_.
 *
 * The database is shared with an unrelated project, so the prefix is a fence:
 * this module creates, reads and writes carpa_* tables and nothing else, ever.
 * Postgres replaced the SQLite file because the app now has to remember things
 * a redeploy must not erase: who signed in, what their inbox already told us,
 * and the credentials that let a scan run again without asking again.
 *
 * Everything here is async where SQLite was sync; the call sites all live in
 * route handlers and auth callbacks, which were already async.
 */

// int8 comes back as a string by default to protect 2^63 values; our bigints
// are millisecond timestamps and counts, safely inside Number territory.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => Number(v));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  // Supabase's transaction pooler: TLS on, named prepared statements off.
  // node-postgres uses unnamed statements for parameterised queries, which
  // transaction pooling supports, so no further ceremony is needed.
  ssl: { rejectUnauthorized: false },
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 12_000,
});

let ready: Promise<void> | null = null;
function init(): Promise<void> {
  ready ??= (async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. The app now stores everything in Postgres.");
    await pool.query(`
CREATE TABLE IF NOT EXISTS carpa_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  image TEXT,
  "createdAt" BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS carpa_searches (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  title TEXT NOT NULL,
  jd TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  "coursesPicked" BIGINT,
  "partsAnswered" BIGINT,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS carpa_searches_user ON carpa_searches("userId", "createdAt" DESC);
CREATE TABLE IF NOT EXISTS carpa_tracker (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  company TEXT NOT NULL,
  role TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  quote TEXT,
  subject TEXT,
  "emailDate" BIGINT,
  "actionLink" TEXT,
  deadline TEXT,
  notes TEXT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS carpa_tracker_user ON carpa_tracker("userId", "updatedAt" DESC);
CREATE TABLE IF NOT EXISTS carpa_tracker_events (
  id TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL,
  status TEXT NOT NULL,
  quote TEXT,
  subject TEXT,
  "emailDate" BIGINT,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS carpa_ev_item ON carpa_tracker_events("itemId", "emailDate");
CREATE TABLE IF NOT EXISTS carpa_events (
  id BIGSERIAL PRIMARY KEY,
  "userId" TEXT,
  name TEXT NOT NULL,
  meta TEXT,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS carpa_events_user ON carpa_events("userId", "createdAt" DESC);
CREATE TABLE IF NOT EXISTS carpa_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS carpa_mail_creds (
  "userId" TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  email TEXT NOT NULL,
  "appPassword" TEXT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS carpa_mail_state (
  "userId" TEXT NOT NULL,
  source TEXT NOT NULL,
  "lastDate" BIGINT NOT NULL,
  "lastScanAt" BIGINT NOT NULL,
  PRIMARY KEY ("userId", source)
);
CREATE TABLE IF NOT EXISTS carpa_seen_emails (
  "userId" TEXT NOT NULL,
  source TEXT NOT NULL,
  "emailId" TEXT NOT NULL,
  PRIMARY KEY ("userId", source, "emailId")
);
CREATE TABLE IF NOT EXISTS carpa_scan_jobs (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  done BIGINT NOT NULL DEFAULT 0,
  total BIGINT NOT NULL DEFAULT 0,
  found BIGINT NOT NULL DEFAULT 0,
  created BIGINT NOT NULL DEFAULT 0,
  updated BIGINT NOT NULL DEFAULT 0,
  "alreadyKnown" BIGINT NOT NULL DEFAULT 0,
  "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  error TEXT,
  "createdAt" BIGINT NOT NULL,
  "updatedAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS carpa_jobs_user ON carpa_scan_jobs("userId", "createdAt" DESC);
CREATE TABLE IF NOT EXISTS carpa_ai_calls (
  id BIGSERIAL PRIMARY KEY,
  fp TEXT NOT NULL,
  purpose TEXT,
  model TEXT,
  "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS carpa_ai_fp ON carpa_ai_calls(fp, "createdAt" DESC);
CREATE TABLE IF NOT EXISTS carpa_rate (
  id BIGSERIAL PRIMARY KEY,
  bucket TEXT NOT NULL,
  "createdAt" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS carpa_rate_bucket ON carpa_rate(bucket, "createdAt" DESC);
ALTER TABLE carpa_tracker_events ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE carpa_tracker_events ADD COLUMN IF NOT EXISTS "fromAddr" TEXT;
ALTER TABLE carpa_tracker ADD COLUMN IF NOT EXISTS origin TEXT;
CREATE TABLE IF NOT EXISTS carpa_skipped_emails (
  "userId" TEXT NOT NULL,
  source TEXT NOT NULL,
  "emailId" TEXT NOT NULL,
  "fromAddr" TEXT,
  subject TEXT,
  "emailDate" BIGINT,
  reason TEXT NOT NULL,
  PRIMARY KEY ("userId", source, "emailId")
);
CREATE INDEX IF NOT EXISTS carpa_skipped_user ON carpa_skipped_emails("userId", "emailDate" DESC);
`);
  })();
  return ready;
}

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  await init();
  const r = await pool.query(text, params as never[]);
  return r.rows as T[];
}

export const uid = () => crypto.randomUUID();
const now = () => Date.now();

// ── users ────────────────────────────────────────────────────────────────────
export async function upsertUser(u: { email: string; name?: string | null; image?: string | null }): Promise<string> {
  const rows = await q<{ id: string }>(
    `INSERT INTO carpa_users (id, email, name, image, "createdAt") VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, carpa_users.name),
       image = COALESCE(EXCLUDED.image, carpa_users.image)
     RETURNING id`,
    [uid(), u.email, u.name ?? null, u.image ?? null, now()],
  );
  return rows[0].id;
}

// ── searches ────────────────────────────────────────────────────────────────
export async function saveSearch(userId: string, s: {
  title: string; jd: string; snapshot: string; coursesPicked?: number; partsAnswered?: number;
}): Promise<string> {
  // Re-running the same posting updates the saved copy rather than piling up
  // near duplicates a student then has to tell apart by timestamp.
  const dupe = await q<{ id: string }>(`SELECT id FROM carpa_searches WHERE "userId" = $1 AND jd = $2`, [userId, s.jd]);
  if (dupe[0]) {
    await q(`UPDATE carpa_searches SET title=$1, snapshot=$2, "coursesPicked"=$3, "partsAnswered"=$4, "createdAt"=$5 WHERE id=$6`,
      [s.title, s.snapshot, s.coursesPicked ?? null, s.partsAnswered ?? null, now(), dupe[0].id]);
    return dupe[0].id;
  }
  const id = uid();
  await q(`INSERT INTO carpa_searches (id, "userId", title, jd, snapshot, "coursesPicked", "partsAnswered", "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, userId, s.title, s.jd, s.snapshot, s.coursesPicked ?? null, s.partsAnswered ?? null, now()]);
  return id;
}
export async function listSearches(userId: string) {
  return q<{ id: string; title: string; jd: string; coursesPicked: number | null; partsAnswered: number | null; createdAt: number }>(
    `SELECT id, title, jd, "coursesPicked", "partsAnswered", "createdAt" FROM carpa_searches WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 50`,
    [userId]);
}
export async function getSearch(userId: string, id: string) {
  const rows = await q<{ id: string; title: string; jd: string; snapshot: string; createdAt: number }>(
    `SELECT * FROM carpa_searches WHERE "userId" = $1 AND id = $2`, [userId, id]);
  return rows[0];
}

// ── tracker ─────────────────────────────────────────────────────────────────
export type TrackerItem = {
  id: string; userId: string; company: string; role: string | null; kind: string;
  status: string; quote: string | null; subject: string | null; emailDate: number | null;
  actionLink: string | null; deadline: string | null; notes: string | null;
  createdAt: number; updatedAt: number;
};
export async function listTracker(userId: string): Promise<TrackerItem[]> {
  return q<TrackerItem>(`SELECT * FROM carpa_tracker WHERE "userId" = $1 ORDER BY "updatedAt" DESC LIMIT 500`, [userId]);
}
export async function trackerEvents(itemId: string) {
  return q<{ id: string; status: string; quote: string | null; subject: string | null; emailDate: number | null; fromAddr: string | null; hasBody: boolean }>(
    `SELECT id, status, quote, subject, "emailDate", "fromAddr", (body IS NOT NULL) AS "hasBody"
     FROM carpa_tracker_events WHERE "itemId" = $1 ORDER BY COALESCE("emailDate", "createdAt") ASC`, [itemId]);
}
/** Every event for a set of rows in one query; 55 rows was 55 round trips. */
export async function trackerEventsFor(itemIds: string[]) {
  if (!itemIds.length) return new Map<string, { id: string; status: string; quote: string | null; subject: string | null; emailDate: number | null; fromAddr: string | null; hasBody: boolean }[]>();
  const rows = await q<{ itemId: string; id: string; status: string; quote: string | null; subject: string | null; emailDate: number | null; fromAddr: string | null; hasBody: boolean }>(
    `SELECT "itemId", id, status, quote, subject, "emailDate", "fromAddr", (body IS NOT NULL) AS "hasBody"
     FROM carpa_tracker_events WHERE "itemId" = ANY($1) ORDER BY COALESCE("emailDate", "createdAt") ASC`, [itemIds]);
  const out = new Map<string, typeof rows>();
  for (const r of rows) { const list = out.get(r.itemId) ?? []; list.push(r); out.set(r.itemId, list); }
  return out;
}

/** One event's stored email, fetched only when someone opens it. */
export async function trackerEventBody(userId: string, eventId: string) {
  const rows = await q<{ body: string | null }>(
    `SELECT e.body FROM carpa_tracker_events e JOIN carpa_tracker t ON t.id = e."itemId"
     WHERE e.id = $1 AND t."userId" = $2`, [eventId, userId]);
  return rows[0]?.body ?? null;
}
export async function insertTrackerItem(t: Omit<TrackerItem, "id" | "createdAt" | "updatedAt" | "notes"> & { notes?: string | null; eventBody?: string | null; eventFrom?: string | null; origin?: string | null }): Promise<string> {
  const id = uid();
  await q(`INSERT INTO carpa_tracker (id, "userId", company, role, kind, status, quote, subject, "emailDate", "actionLink", deadline, notes, origin, "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, t.userId, t.company, t.role, t.kind, t.status, t.quote, t.subject, t.emailDate, t.actionLink, t.deadline, t.notes ?? null, t.origin ?? null, now(), now()]);
  await addTrackerEvent(id, { status: t.status, quote: t.quote, subject: t.subject, emailDate: t.emailDate, body: t.eventBody ?? null, fromAddr: t.eventFrom ?? null });
  return id;
}
export async function updateTrackerItem(id: string, patch: Partial<Pick<TrackerItem, "status" | "quote" | "subject" | "emailDate" | "actionLink" | "deadline" | "role" | "kind" | "notes" | "company">>, eventExtra?: { body?: string | null; fromAddr?: string | null }) {
  const rows = await q<TrackerItem>(`SELECT * FROM carpa_tracker WHERE id = $1`, [id]);
  const cur = rows[0];
  if (!cur) return;
  await q(`UPDATE carpa_tracker SET status=$1, quote=$2, subject=$3, "emailDate"=$4, "actionLink"=$5, deadline=$6, role=$7, kind=$8, notes=$9, company=$10, "updatedAt"=$11 WHERE id=$12`,
    [
      patch.status ?? cur.status, patch.quote ?? cur.quote, patch.subject ?? cur.subject,
      patch.emailDate ?? cur.emailDate, patch.actionLink ?? cur.actionLink, patch.deadline ?? cur.deadline,
      patch.role ?? cur.role, patch.kind ?? cur.kind, patch.notes ?? cur.notes, patch.company ?? cur.company, now(), id,
    ]);
  if (patch.status && patch.status !== cur.status) {
    await addTrackerEvent(id, { status: patch.status, quote: patch.quote ?? null, subject: patch.subject ?? null, emailDate: patch.emailDate ?? null, body: eventExtra?.body ?? null, fromAddr: eventExtra?.fromAddr ?? null });
  }
}
export async function addTrackerEvent(itemId: string, e: { status: string; quote?: string | null; subject?: string | null; emailDate?: number | null; body?: string | null; fromAddr?: string | null }) {
  await q(`INSERT INTO carpa_tracker_events (id, "itemId", status, quote, subject, "emailDate", body, "fromAddr", "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [uid(), itemId, e.status, e.quote ?? null, e.subject ?? null, e.emailDate ?? null, e.body ?? null, e.fromAddr ?? null, now()]);
}
export async function deleteTrackerItem(userId: string, id: string) {
  await q(`DELETE FROM carpa_tracker WHERE "userId" = $1 AND id = $2`, [userId, id]);
  await q(`DELETE FROM carpa_tracker_events WHERE "itemId" = $1`, [id]);
}

// ── analytics ───────────────────────────────────────────────────────────────
export async function logEvent(userId: string | null, name: string, meta?: unknown) {
  await q(`INSERT INTO carpa_events ("userId", name, meta, "createdAt") VALUES ($1,$2,$3,$4)`,
    [userId, name, meta ? JSON.stringify(meta).slice(0, 2000) : null, now()]);
}
/** Everything one person ever did here, oldest first, to the end. */
export async function userTrail(userId: string) {
  const [user, events, searches, tracker] = await Promise.all([
    q<{ id: string; email: string; name: string | null; createdAt: number }>(
      `SELECT id, email, name, "createdAt" FROM carpa_users WHERE id = $1`, [userId]),
    q<{ name: string; meta: string | null; createdAt: number }>(
      `SELECT name, meta, "createdAt" FROM carpa_events WHERE "userId" = $1 ORDER BY "createdAt" ASC LIMIT 5000`, [userId]),
q<{ id: string; title: string; createdAt: number }>(
  `SELECT id, title, "createdAt" FROM carpa_searches WHERE "userId" = $1 ORDER BY "createdAt" ASC`, [userId]),
    q<{ company: string; status: string; kind: string; "updatedAt": number }>(
      `SELECT company, status, kind, "updatedAt" FROM carpa_tracker WHERE "userId" = $1 ORDER BY "updatedAt" DESC`, [userId]),
  ]);
  return { user: user[0], events, searches, tracker };
}

/** Full search detail for admin — bypasses userId ownership check. */
export async function adminSearchDetail(userId: string, searchId: string) {
  const rows = await q<{ id: string; title: string; jd: string; snapshot: string; coursesPicked: number | null; partsAnswered: number | null; createdAt: number }>(
    `SELECT id, title, jd, snapshot, "coursesPicked", "partsAnswered", "createdAt" FROM carpa_searches WHERE "userId" = $1 AND id = $2`, [userId, searchId]);
  return rows[0] ?? null;
}

/** Every tracker item for a user — admin view. */
export async function adminTrackerItems(userId: string) {
  return q<{ id: string; company: string; role: string | null; kind: string; status: string; updatedAt: number; emailDate: number | null }>(
    `SELECT id, company, role, kind, status, "updatedAt", "emailDate" FROM carpa_tracker WHERE "userId" = $1 ORDER BY "updatedAt" DESC LIMIT 500`, [userId]);
}

/**
 * Admin event log with full metadata — shows every tracked interaction
 * including planner creates, tracker edits, and search executions.
 */
export async function adminEventDetail(userId: string, eventName: string) {
  return q<{ name: string; meta: string | null; createdAt: number }>(
    `SELECT name, meta, "createdAt" FROM carpa_events WHERE "userId" = $1 AND name = $2 ORDER BY "createdAt" DESC LIMIT 100`, [userId, eventName]);
}

export async function adminStats() {
  const users = await q<{ id: string; email: string; name: string | null; createdAt: number; events: number; searches: number; applications: number; lastSeen: number | null }>(
    `SELECT u.id, u.email, u.name, u."createdAt",
       (SELECT COUNT(*) FROM carpa_events e WHERE e."userId" = u.id) AS events,
       (SELECT COUNT(*) FROM carpa_searches s WHERE s."userId" = u.id) AS searches,
       (SELECT COUNT(*) FROM carpa_tracker t WHERE t."userId" = u.id) AS applications,
       (SELECT MAX("createdAt") FROM carpa_events e WHERE e."userId" = u.id) AS "lastSeen"
     FROM carpa_users u WHERE u.id <> 'judge-shared' ORDER BY "lastSeen" DESC NULLS LAST`);
  const byName = await q<{ name: string; n: number }>(
    `SELECT name, COUNT(*) AS n FROM carpa_events GROUP BY name ORDER BY n DESC LIMIT 30`);
  const recent = await q<{ name: string; meta: string | null; createdAt: number; email: string | null }>(
    `SELECT e.name, e.meta, e."createdAt", u.email FROM carpa_events e LEFT JOIN carpa_users u ON u.id = e."userId" ORDER BY e."createdAt" DESC LIMIT 80`);
  return { users, byName, recent };
}

// ── secrets and mail connections ────────────────────────────────────────────
/**
 * The judges' inbox credentials live here, not in env, so a redeploy or a new
 * machine picks them up from the database it already talks to.
 */
export async function getSecret(key: string): Promise<string | null> {
  const rows = await q<{ value: string }>(`SELECT value FROM carpa_secrets WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}
export async function setSecret(key: string, value: string) {
  await q(`INSERT INTO carpa_secrets (key, value, "updatedAt") VALUES ($1,$2,$3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = EXCLUDED."updatedAt"`,
    [key, value, now()]);
}

/** A person's own connection, remembered so "Scan again" never re-asks. */
export async function saveMailCreds(userId: string, c: { source: string; email: string; appPassword: string }) {
  await q(`INSERT INTO carpa_mail_creds ("userId", source, email, "appPassword", "updatedAt") VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT ("userId") DO UPDATE SET source=EXCLUDED.source, email=EXCLUDED.email, "appPassword"=EXCLUDED."appPassword", "updatedAt"=EXCLUDED."updatedAt"`,
    [userId, c.source, c.email, c.appPassword, now()]);
}
export async function getMailCreds(userId: string) {
  const rows = await q<{ source: string; email: string; appPassword: string }>(
    `SELECT source, email, "appPassword" FROM carpa_mail_creds WHERE "userId" = $1`, [userId]);
  return rows[0];
}

// ── incremental scan bookkeeping ────────────────────────────────────────────
/**
 * The optimisation the user asked for in as many words: once an email has
 * been read and its tracker consequences stored, no later scan reads it
 * again. State holds the newest message date per (user, source); seen holds
 * every processed message id, so the overlap window cannot double-count.
 */
export async function getMailState(userId: string, source: string) {
  const rows = await q<{ lastDate: number; lastScanAt: number }>(
    `SELECT "lastDate", "lastScanAt" FROM carpa_mail_state WHERE "userId" = $1 AND source = $2`, [userId, source]);
  return rows[0];
}
export async function setMailState(userId: string, source: string, lastDate: number) {
  await q(`INSERT INTO carpa_mail_state ("userId", source, "lastDate", "lastScanAt") VALUES ($1,$2,$3,$4)
           ON CONFLICT ("userId", source) DO UPDATE SET "lastDate" = GREATEST(carpa_mail_state."lastDate", EXCLUDED."lastDate"), "lastScanAt" = EXCLUDED."lastScanAt"`,
    [userId, source, lastDate, now()]);
}
export async function seenEmailIds(userId: string, source: string, ids: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 5000) {
    const rows = await q<{ emailId: string }>(
      `SELECT "emailId" FROM carpa_seen_emails WHERE "userId" = $1 AND source = $2 AND "emailId" = ANY($3)`,
      [userId, source, ids.slice(i, i + 5000)]);
    for (const r of rows) seen.add(r.emailId);
  }
  return seen;
}
export async function markEmailsSeen(userId: string, source: string, ids: string[]) {
  for (let i = 0; i < ids.length; i += 5000) {
    await q(`INSERT INTO carpa_seen_emails ("userId", source, "emailId")
             SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING`,
      [userId, source, ids.slice(i, i + 5000)]);
  }
}

// ── the emails a scan decided not to track ──────────────────────────────────
/**
 * Every header the scanner passed over is remembered, with the reason, so
 * the tracker page can show what did not make the cut and a person can
 * move any of it into the tracker by hand — the machine's "no" is reversible
 * because the machine is not the one answering for a missing row.
 */
export type SkippedEmail = {
  source: string; emailId: string; fromAddr: string | null; subject: string | null;
  emailDate: number | null; reason: string;
};
export async function insertSkippedEmails(userId: string, source: string, rows: SkippedEmail[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const vals: unknown[] = []; const tuples: string[] = [];
    chunk.forEach((r) => {
      const base = vals.length;
      vals.push(userId, source, r.emailId, r.fromAddr, r.subject, r.emailDate, r.reason);
      tuples.push(`(${Array.from({ length: 7 }, (_, k) => `$${base + k + 1}`).join(",")})`);
    });
    await q(`INSERT INTO carpa_skipped_emails ("userId", source, "emailId", "fromAddr", subject, "emailDate", reason)
             VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`, vals);
  }
}
export async function listSkippedEmails(userId: string, limit = 300): Promise<SkippedEmail[]> {
  return q<SkippedEmail>(
    `SELECT source, "emailId", "fromAddr", subject, "emailDate", reason FROM carpa_skipped_emails
     WHERE "userId" = $1 ORDER BY COALESCE("emailDate", 0) DESC LIMIT $2`, [userId, limit]);
}
export async function deleteSkippedEmail(userId: string, source: string, emailId: string) {
  await q(`DELETE FROM carpa_skipped_emails WHERE "userId" = $1 AND source = $2 AND "emailId" = $3`, [userId, source, emailId]);
}

// ── scan jobs: the background work a scan became ─────────────────────────────
export type ScanJob = {
  id: string; userId: string; mode: string; status: "running" | "done" | "error";
  phase: string; done: number; total: number; found: number; created: number;
  updated: number; alreadyKnown: number; costUsd: number; error: string | null;
  createdAt: number; updatedAt: number;
};
export async function createScanJob(userId: string, mode: string): Promise<string> {
  const id = uid();
  await q(`INSERT INTO carpa_scan_jobs (id, "userId", mode, status, phase, "createdAt", "updatedAt")
           VALUES ($1,$2,$3,'running','connecting',$4,$4)`, [id, userId, mode, now()]);
  return id;
}
export async function updateScanJob(id: string, patch: Partial<Omit<ScanJob, "id" | "userId" | "mode" | "createdAt">>) {
  const cols: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) { vals.push(v); cols.push(`"${k}" = $${vals.length}`); }
  vals.push(now()); cols.push(`"updatedAt" = $${vals.length}`);
  vals.push(id);
  await q(`UPDATE carpa_scan_jobs SET ${cols.join(", ")} WHERE id = $${vals.length}`, vals);
}
export async function getScanJob(userId: string, id: string): Promise<ScanJob | undefined> {
  return (await q<ScanJob>(`SELECT * FROM carpa_scan_jobs WHERE id = $1 AND "userId" = $2`, [id, userId]))[0];
}
export async function latestScanJob(userId: string): Promise<ScanJob | undefined> {
  return (await q<ScanJob>(`SELECT * FROM carpa_scan_jobs WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [userId]))[0];
}

// ── the shared judges' tracker ──────────────────────────────────────────────
/**
 * The owner's inbox is read in full exactly once, into this synthetic user.
 * A judge choosing "use the owner's inbox" gets these rows copied into their
 * own account in one round trip: no IMAP, no model calls, no waiting. Only
 * an admin's judge-mode scan re-reads the real mailbox, incrementally, to
 * refresh this copy.
 */
export const SHARED_JUDGE_USER = "judge-shared";

export async function cloneJudgeRows(toUserId: string): Promise<{ created: number; total: number }> {
  const src = await q<TrackerItem>(`SELECT * FROM carpa_tracker WHERE "userId" = $1`, [SHARED_JUDGE_USER]);
  // Shifting to the owner's view REPLACES the tracker; mixing two people's
  // seasons in one table answered nobody's question. The person's own scan
  // state is cleared too, so scanning their own inbox later rebuilds their
  // full tracker from scratch instead of "nothing new since last time".
  //
  // Rows entered BY HAND survive. Everything else here can be rebuilt by
  // scanning again; a row someone typed cannot be, and a demo that quietly
  // eats a student's own notes has done something unforgivable for a
  // convenience it did not need.
  await q(`DELETE FROM carpa_tracker_events WHERE "itemId" IN (SELECT id FROM carpa_tracker WHERE "userId" = $1 AND (origin IS NULL OR origin <> 'manual'))`, [toUserId]);
  await q(`DELETE FROM carpa_tracker WHERE "userId" = $1 AND (origin IS NULL OR origin <> 'manual')`, [toUserId]);
  await q(`DELETE FROM carpa_seen_emails WHERE "userId" = $1 AND source IN ('imap','gmail')`, [toUserId]);
  await q(`DELETE FROM carpa_mail_state WHERE "userId" = $1 AND source IN ('imap','gmail')`, [toUserId]);
  await q(`DELETE FROM carpa_skipped_emails WHERE "userId" = $1 AND source = 'judge'`, [toUserId]);
  await q(`INSERT INTO carpa_skipped_emails ("userId", source, "emailId", "fromAddr", subject, "emailDate", reason)
           SELECT $1, source, "emailId", "fromAddr", subject, "emailDate", reason
           FROM carpa_skipped_emails WHERE "userId" = $2 ON CONFLICT DO NOTHING`, [toUserId, SHARED_JUDGE_USER]);
  const fresh = src;
  if (!fresh.length) return { created: 0, total: src.length };

  const idMap = new Map(fresh.map((r) => [r.id, uid()]));
  const rowVals: unknown[] = []; const rowTuples: string[] = [];
  fresh.forEach((r) => {
    const base = rowVals.length;
    rowVals.push(idMap.get(r.id), toUserId, r.company, r.role, r.kind, r.status, r.quote, r.subject, r.emailDate, r.actionLink, r.deadline, r.notes, "judge", now(), now());
    rowTuples.push(`(${Array.from({ length: 15 }, (_, k) => `$${base + k + 1}`).join(",")})`);
  });
  await q(`INSERT INTO carpa_tracker (id, "userId", company, role, kind, status, quote, subject, "emailDate", "actionLink", deadline, notes, origin, "createdAt", "updatedAt") VALUES ${rowTuples.join(",")}`, rowVals);

  // The events carry whole stored emails, megabytes of them. They are
  // copied INSIDE Postgres with one INSERT..SELECT; pulling them across the
  // wire and pushing them back was most of a judge's wait.
  const mapVals: unknown[] = []; const mapTuples: string[] = [];
  for (const [oldId, newId] of idMap) {
    mapVals.push(oldId, newId);
    mapTuples.push(`($${mapVals.length - 1}, $${mapVals.length})`);
  }
  await q(
    `INSERT INTO carpa_tracker_events (id, "itemId", status, quote, subject, "emailDate", body, "fromAddr", "createdAt")
     SELECT gen_random_uuid()::text, m.new_id, e.status, e.quote, e.subject, e."emailDate", e.body, e."fromAddr", $${mapVals.length + 1}
     FROM carpa_tracker_events e
     JOIN (VALUES ${mapTuples.join(",")}) AS m(old_id, new_id) ON m.old_id = e."itemId"`,
    [...mapVals, now()]);
  return { created: fresh.length, total: src.length };
}

/** Remove the owner's cloned rows from a personal tracker. */
export async function purgeJudgeRows(userId: string) {
  await q(`DELETE FROM carpa_tracker_events WHERE "itemId" IN (SELECT id FROM carpa_tracker WHERE "userId" = $1 AND origin = 'judge')`, [userId]);
  await q(`DELETE FROM carpa_tracker WHERE "userId" = $1 AND origin = 'judge'`, [userId]);
}

// ── the AI spend ledger, per key fingerprint, durable across deploys ────────
export async function recordAiCall(fp: string, rec: { purpose?: string; model?: string; costUsd: number; at: number }) {
  await q(`INSERT INTO carpa_ai_calls (fp, purpose, model, "costUsd", "createdAt") VALUES ($1,$2,$3,$4,$5)`,
    [fp, rec.purpose ?? null, rec.model ?? null, rec.costUsd, rec.at]);
}
export async function aiLedger(fp: string, limit = 8) {
  return q<{ purpose: string | null; model: string | null; costUsd: number; createdAt: number }>(
    `SELECT purpose, model, "costUsd", "createdAt" FROM carpa_ai_calls WHERE fp = $1 ORDER BY "createdAt" DESC LIMIT $2`,
    [fp, limit]);
}
export async function aiTotal(fp: string): Promise<{ usd: number; calls: number }> {
  const rows = await q<{ usd: number | null; calls: number }>(
    `SELECT SUM("costUsd") AS usd, COUNT(*) AS calls FROM carpa_ai_calls WHERE fp = $1`, [fp]);
  return { usd: rows[0]?.usd ?? 0, calls: rows[0]?.calls ?? 0 };
}
/** Model dollars spent across the whole deployment since a moment. */
export async function spendSince(sinceMs: number): Promise<number> {
  const rows = await q<{ usd: number | null }>(
    `SELECT SUM("costUsd") AS usd FROM carpa_ai_calls WHERE "createdAt" >= $1`, [sinceMs]);
  return rows[0]?.usd ?? 0;
}
/** How many times this bucket fired since a moment. */
export async function countRecent(bucket: string, sinceMs: number): Promise<number> {
  const rows = await q<{ n: number }>(
    `SELECT COUNT(*) AS n FROM carpa_rate WHERE bucket = $1 AND "createdAt" >= $2`, [bucket, sinceMs]);
  return Number(rows[0]?.n ?? 0);
}
export async function recordHit(bucket: string) {
  await q(`INSERT INTO carpa_rate (bucket, "createdAt") VALUES ($1, $2)`, [bucket, now()]);
  // Keep the table from growing forever; anything older than a day is spent.
  if (Math.random() < 0.02) await q(`DELETE FROM carpa_rate WHERE "createdAt" < $1`, [now() - 86_400_000]);
}

export async function clearAiLedger(fp: string) {
  await q(`DELETE FROM carpa_ai_calls WHERE fp = $1`, [fp]);
}
