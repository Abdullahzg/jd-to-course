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
  return q<{ id: string; status: string; quote: string | null; subject: string | null; emailDate: number | null }>(
    `SELECT * FROM carpa_tracker_events WHERE "itemId" = $1 ORDER BY COALESCE("emailDate", "createdAt") ASC`, [itemId]);
}
export async function insertTrackerItem(t: Omit<TrackerItem, "id" | "createdAt" | "updatedAt" | "notes"> & { notes?: string | null }): Promise<string> {
  const id = uid();
  await q(`INSERT INTO carpa_tracker (id, "userId", company, role, kind, status, quote, subject, "emailDate", "actionLink", deadline, notes, "createdAt", "updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, t.userId, t.company, t.role, t.kind, t.status, t.quote, t.subject, t.emailDate, t.actionLink, t.deadline, t.notes ?? null, now(), now()]);
  await addTrackerEvent(id, { status: t.status, quote: t.quote, subject: t.subject, emailDate: t.emailDate });
  return id;
}
export async function updateTrackerItem(id: string, patch: Partial<Pick<TrackerItem, "status" | "quote" | "subject" | "emailDate" | "actionLink" | "deadline" | "role" | "kind" | "notes" | "company">>) {
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
    await addTrackerEvent(id, { status: patch.status, quote: patch.quote ?? null, subject: patch.subject ?? null, emailDate: patch.emailDate ?? null });
  }
}
export async function addTrackerEvent(itemId: string, e: { status: string; quote?: string | null; subject?: string | null; emailDate?: number | null }) {
  await q(`INSERT INTO carpa_tracker_events (id, "itemId", status, quote, subject, "emailDate", "createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uid(), itemId, e.status, e.quote ?? null, e.subject ?? null, e.emailDate ?? null, now()]);
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
export async function adminStats() {
  const users = await q<{ id: string; email: string; name: string | null; createdAt: number; events: number; searches: number; applications: number; lastSeen: number | null }>(
    `SELECT u.id, u.email, u.name, u."createdAt",
       (SELECT COUNT(*) FROM carpa_events e WHERE e."userId" = u.id) AS events,
       (SELECT COUNT(*) FROM carpa_searches s WHERE s."userId" = u.id) AS searches,
       (SELECT COUNT(*) FROM carpa_tracker t WHERE t."userId" = u.id) AS applications,
       (SELECT MAX("createdAt") FROM carpa_events e WHERE e."userId" = u.id) AS "lastSeen"
     FROM carpa_users u ORDER BY "lastSeen" DESC NULLS LAST`);
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
  if (!ids.length) return new Set();
  const rows = await q<{ emailId: string }>(
    `SELECT "emailId" FROM carpa_seen_emails WHERE "userId" = $1 AND source = $2 AND "emailId" = ANY($3)`,
    [userId, source, ids]);
  return new Set(rows.map((r) => r.emailId));
}
export async function markEmailsSeen(userId: string, source: string, ids: string[]) {
  if (!ids.length) return;
  await q(`INSERT INTO carpa_seen_emails ("userId", source, "emailId")
           SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING`,
    [userId, source, ids]);
}
