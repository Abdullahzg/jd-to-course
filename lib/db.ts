import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join } from "path";

/**
 * One file on disk, five tables, no ceremony.
 *
 * Everything the app remembers about a person lives here: who they are, the
 * course searches they ran, the applications their inbox revealed, and what
 * they clicked. SQLite because the competition demo runs on one machine and a
 * hosted deployment swaps this file for Postgres behind the same functions,
 * not because anyone believes a laptop is a data centre.
 */
const DIR = join(process.cwd(), ".data");
mkdirSync(DIR, { recursive: true });

const db = new Database(join(DIR, "app.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  image TEXT,
  createdAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  title TEXT NOT NULL,
  jd TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  coursesPicked INTEGER,
  partsAnswered INTEGER,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS searches_user ON searches(userId, createdAt DESC);
CREATE TABLE IF NOT EXISTS tracker (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  company TEXT NOT NULL,
  role TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  quote TEXT,
  subject TEXT,
  emailDate INTEGER,
  actionLink TEXT,
  deadline TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tracker_user ON tracker(userId, updatedAt DESC);
CREATE TABLE IF NOT EXISTS tracker_events (
  id TEXT PRIMARY KEY,
  itemId TEXT NOT NULL,
  status TEXT NOT NULL,
  quote TEXT,
  subject TEXT,
  emailDate INTEGER,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ev_item ON tracker_events(itemId, emailDate);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT,
  name TEXT NOT NULL,
  meta TEXT,
  createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_user ON events(userId, createdAt DESC);
`);

export const uid = () => crypto.randomUUID();
const now = () => Date.now();

// ── users ────────────────────────────────────────────────────────────────────
export function upsertUser(u: { email: string; name?: string | null; image?: string | null }) {
  const found = db.prepare("SELECT id FROM users WHERE email = ?").get(u.email) as { id: string } | undefined;
  if (found) {
    db.prepare("UPDATE users SET name = COALESCE(?, name), image = COALESCE(?, image) WHERE id = ?")
      .run(u.name ?? null, u.image ?? null, found.id);
    return found.id;
  }
  const id = uid();
  db.prepare("INSERT INTO users (id, email, name, image, createdAt) VALUES (?, ?, ?, ?, ?)")
    .run(id, u.email, u.name ?? null, u.image ?? null, now());
  return id;
}

// ── searches ────────────────────────────────────────────────────────────────
export function saveSearch(userId: string, s: {
  title: string; jd: string; snapshot: string; coursesPicked?: number; partsAnswered?: number;
}) {
  // Re-running the same posting updates the saved copy rather than piling up
  // near duplicates a student then has to tell apart by timestamp.
  const dupe = db.prepare("SELECT id FROM searches WHERE userId = ? AND jd = ?").get(userId, s.jd) as { id: string } | undefined;
  if (dupe) {
    db.prepare("UPDATE searches SET title=?, snapshot=?, coursesPicked=?, partsAnswered=?, createdAt=? WHERE id=?")
      .run(s.title, s.snapshot, s.coursesPicked ?? null, s.partsAnswered ?? null, now(), dupe.id);
    return dupe.id;
  }
  const id = uid();
  db.prepare("INSERT INTO searches (id, userId, title, jd, snapshot, coursesPicked, partsAnswered, createdAt) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, userId, s.title, s.jd, s.snapshot, s.coursesPicked ?? null, s.partsAnswered ?? null, now());
  return id;
}
export function listSearches(userId: string) {
  return db.prepare("SELECT id, title, jd, coursesPicked, partsAnswered, createdAt FROM searches WHERE userId = ? ORDER BY createdAt DESC LIMIT 50")
    .all(userId) as { id: string; title: string; jd: string; coursesPicked: number | null; partsAnswered: number | null; createdAt: number }[];
}
export function getSearch(userId: string, id: string) {
  return db.prepare("SELECT * FROM searches WHERE userId = ? AND id = ?").get(userId, id) as
    | { id: string; title: string; jd: string; snapshot: string; createdAt: number } | undefined;
}

// ── tracker ─────────────────────────────────────────────────────────────────
export type TrackerItem = {
  id: string; userId: string; company: string; role: string | null; kind: string;
  status: string; quote: string | null; subject: string | null; emailDate: number | null;
  actionLink: string | null; deadline: string | null; createdAt: number; updatedAt: number;
};
export function listTracker(userId: string): TrackerItem[] {
  return db.prepare("SELECT * FROM tracker WHERE userId = ? ORDER BY updatedAt DESC LIMIT 500").all(userId) as TrackerItem[];
}
export function trackerEvents(itemId: string) {
  return db.prepare("SELECT * FROM tracker_events WHERE itemId = ? ORDER BY COALESCE(emailDate, createdAt) ASC").all(itemId) as
    { id: string; status: string; quote: string | null; subject: string | null; emailDate: number | null }[];
}
export function insertTrackerItem(t: Omit<TrackerItem, "id" | "createdAt" | "updatedAt">) {
  const id = uid();
  db.prepare(`INSERT INTO tracker (id, userId, company, role, kind, status, quote, subject, emailDate, actionLink, deadline, createdAt, updatedAt)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, t.userId, t.company, t.role, t.kind, t.status, t.quote, t.subject, t.emailDate, t.actionLink, t.deadline, now(), now());
  addTrackerEvent(id, { status: t.status, quote: t.quote, subject: t.subject, emailDate: t.emailDate });
  return id;
}
export function updateTrackerItem(id: string, patch: Partial<Pick<TrackerItem, "status" | "quote" | "subject" | "emailDate" | "actionLink" | "deadline" | "role" | "kind">>) {
  const cur = db.prepare("SELECT * FROM tracker WHERE id = ?").get(id) as TrackerItem | undefined;
  if (!cur) return;
  db.prepare(`UPDATE tracker SET status=?, quote=?, subject=?, emailDate=?, actionLink=?, deadline=?, role=?, kind=?, updatedAt=? WHERE id=?`)
    .run(
      patch.status ?? cur.status, patch.quote ?? cur.quote, patch.subject ?? cur.subject,
      patch.emailDate ?? cur.emailDate, patch.actionLink ?? cur.actionLink, patch.deadline ?? cur.deadline,
      patch.role ?? cur.role, patch.kind ?? cur.kind, now(), id,
    );
  if (patch.status && patch.status !== cur.status) {
    addTrackerEvent(id, { status: patch.status, quote: patch.quote ?? null, subject: patch.subject ?? null, emailDate: patch.emailDate ?? null });
  }
}
export function addTrackerEvent(itemId: string, e: { status: string; quote?: string | null; subject?: string | null; emailDate?: number | null }) {
  db.prepare("INSERT INTO tracker_events (id, itemId, status, quote, subject, emailDate, createdAt) VALUES (?,?,?,?,?,?,?)")
    .run(uid(), itemId, e.status, e.quote ?? null, e.subject ?? null, e.emailDate ?? null, now());
}
export function deleteTrackerItem(userId: string, id: string) {
  db.prepare("DELETE FROM tracker WHERE userId = ? AND id = ?").run(userId, id);
  db.prepare("DELETE FROM tracker_events WHERE itemId = ?").run(id);
}

// ── analytics ───────────────────────────────────────────────────────────────
export function logEvent(userId: string | null, name: string, meta?: unknown) {
  db.prepare("INSERT INTO events (userId, name, meta, createdAt) VALUES (?,?,?,?)")
    .run(userId, name, meta ? JSON.stringify(meta).slice(0, 2000) : null, now());
}
export function adminStats() {
  const users = db.prepare("SELECT u.id, u.email, u.name, u.createdAt, (SELECT COUNT(*) FROM events e WHERE e.userId = u.id) AS events, (SELECT COUNT(*) FROM searches s WHERE s.userId = u.id) AS searches, (SELECT COUNT(*) FROM tracker t WHERE t.userId = u.id) AS applications, (SELECT MAX(createdAt) FROM events e WHERE e.userId = u.id) AS lastSeen FROM users u ORDER BY lastSeen DESC")
    .all() as { id: string; email: string; name: string | null; createdAt: number; events: number; searches: number; applications: number; lastSeen: number | null }[];
  const byName = db.prepare("SELECT name, COUNT(*) AS n FROM events GROUP BY name ORDER BY n DESC LIMIT 30")
    .all() as { name: string; n: number }[];
  const recent = db.prepare("SELECT e.name, e.meta, e.createdAt, u.email FROM events e LEFT JOIN users u ON u.id = e.userId ORDER BY e.createdAt DESC LIMIT 80")
    .all() as { name: string; meta: string | null; createdAt: number; email: string | null }[];
  return { users, byName, recent };
}

export default db;
