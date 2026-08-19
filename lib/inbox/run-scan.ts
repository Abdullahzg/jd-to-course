import { triageHeaders, extractSignals, refuteSignals, prefilterBulk } from "./classify";
import { reconcile } from "./reconcile";
import {
  demoInbox, fetchGmailHeaders, fetchGmailBodies, fetchImapHeaders, fetchImapBodies,
} from "./drivers";
import {
  logEvent, getSecret, getMailCreds, saveMailCreds,
  getMailState, setMailState, seenEmailIds, markEmailsSeen, updateScanJob,
  insertSkippedEmails, purgeJudgeRows,
} from "@/lib/db";
import type { EmailHeader, RawEmail } from "./types";

const DAY = 24 * 3600 * 1000;
/** One pass through the pipeline, checkpointed, so giant mailboxes are chewed oldest-first. */
const CHUNK = 3000;
/** Stop starting new chunks after this long; the rest is picked up by the next scan. */
const TIME_BUDGET = 240_000;

/**
 * A whole scan, run behind a job row instead of behind an open HTTP request.
 *
 * A first connection covers the ENTIRE mailbox, not a year of it. Because
 * whole mailboxes can be huge (the owner's holds 38,000 messages), the scan
 * walks history in chunks, oldest first: each chunk is listed, triaged,
 * body-fetched, extracted and reconciled, then its progress is checkpointed
 * (seen ids + state cursor) BEFORE the next chunk starts. A platform that
 * kills a long job therefore loses nothing: the next scan resumes exactly
 * where the cursor left off, and the UI's sync button does that for free.
 */
export async function runScan(
  jobId: string,
  userId: string,
  mode: string,
  key: string,
  opts: { email?: string; appPassword?: string; gmailToken?: string },
): Promise<void> {
  const up = (patch: Parameters<typeof updateScanJob>[1]) => updateScanJob(jobId, patch).catch(() => undefined);
  try {
    let state = await getMailState(userId, mode);
    const backfill = !state;
    // The cursor points at where history was last fully processed. A first
    // scan starts at the beginning of time; later scans start two days
    // before the newest processed message, and seen-ids remove the overlap.
    let cursor = state ? state.lastDate - 2 * DAY : 0;

    const startedAt = Date.now();
    let totHeaders = 0, totFresh = 0, totRead = 0, totSignals = 0, totSkipped = 0;
    let totCreated = 0, totUpdated = 0, totCost = 0;

    // One connection-maker per mode, closed over the credentials.
    let listHeaders: (sinceMs: number) => Promise<EmailHeader[]>;
    let getBodies: (ids: string[], onChunk?: (done: number) => void) => Promise<RawEmail[]>;

    if (mode === "gmail") {
      if (!opts.gmailToken) throw new Error("Google is not connected on this session. Sign in with Google, approving the Gmail permission.");
      const token = opts.gmailToken;
      listHeaders = (sinceMs) => fetchGmailHeaders(token, { sinceMs, cap: CHUNK });
      getBodies = (ids, onChunk) => fetchGmailBodies(token, ids, onChunk);
    } else if (mode === "imap") {
      let creds = opts.email && opts.appPassword
        ? { email: opts.email, appPassword: opts.appPassword }
        : await getMailCreds(userId);
      if (!creds) throw new Error("The app password route needs your address and a 16 character Google app password.");
      const { email, appPassword } = creds;
      listHeaders = (sinceMs) => fetchImapHeaders(email, appPassword, { sinceMs, cap: CHUNK });
      getBodies = (ids, onChunk) => fetchImapBodies(email, appPassword, ids, onChunk);
      if (opts.email && opts.appPassword) {
        await saveMailCreds(userId, { source: "imap", email: opts.email, appPassword: opts.appPassword });
      }
    } else if (mode === "judge") {
      const jEmail = (await getSecret("judge_inbox_email")) ?? process.env.JUDGE_INBOX_EMAIL;
      const jPass = (await getSecret("judge_inbox_app_password")) ?? process.env.JUDGE_INBOX_APP_PASSWORD;
      if (!jEmail || !jPass) throw new Error("The judges' inbox is not connected yet. The owner adds an app password to enable it; meanwhile the demo inbox shows the same flow.");
      listHeaders = (sinceMs) => fetchImapHeaders(jEmail, jPass, { sinceMs, cap: CHUNK });
      getBodies = (ids, onChunk) => fetchImapBodies(jEmail, jPass, ids, onChunk);
    } else {
      const demo = demoInbox();
      listHeaders = async () => demo;
      getBodies = async (ids) => demo.filter((e) => ids.includes(e.id));
    }

    // Owner rows do not belong in a personal scan's result. Shifting back
    // to your own inbox is also a replacement, not a merge.
    if (mode === "imap" || mode === "gmail") {
      await purgeJudgeRows(userId);
    }

    // ── the walk, oldest first, checkpointed per chunk ───────────────────
    let pass = 0;
    for (;;) {
      if (pass > 0 && Date.now() - startedAt > TIME_BUDGET) break; // the next scan keeps walking
      const headers = await listHeaders(cursor);
      if (!headers.length) break;
      totHeaders += headers.length;

      const seen = await seenEmailIds(userId, mode, headers.map((h) => h.id));
      let fresh = headers.filter((h) => !seen.has(h.id));
      totFresh += fresh.length;

      // Bulk mail dies here, for free, before a single model call. What the
      // triage says no to stays recorded too, so a person can overrule it.
      const { kept: nonBulk, bulk } = prefilterBulk(fresh);
      await up({ phase: "triage", total: nonBulk.length, done: 0, alreadyKnown: seen.size });

      let lastTick = 0;
      const { keep, costUsd: triageCost } = await triageHeaders(key, nonBulk, (done) => {
        if (done - lastTick >= 180 || done === nonBulk.length) { lastTick = done; void up({ done }); }
      });
      totCost += triageCost;

      const keepSet = new Set(keep);
      await insertSkippedEmails(userId, mode, [
        ...bulk.map((h) => ({ source: mode, emailId: h.id, fromAddr: h.from, subject: h.subject, emailDate: h.date, reason: "bulk" })),
        ...nonBulk.filter((h) => !keepSet.has(h.id)).map((h) => ({ source: mode, emailId: h.id, fromAddr: h.from, subject: h.subject, emailDate: h.date, reason: "triage" })),
      ]);
      totSkipped += bulk.length + (nonBulk.length - keepSet.size);

      // ── bodies for the survivors only ──────────────────────────────────
      await up({ phase: "reading", total: keep.size, done: 0, costUsd: triageCost });
      const bodies = await getBodies([...keep], (done) => void up({ done }));
      totRead += bodies.length;

      // ── extract, verify quotes, reconcile ──────────────────────────────
      await up({ phase: "extracting", total: bodies.length, done: 0 });
      const { signals: rawSignals, costUsd: extractCost } = await extractSignals(key, bodies, (done) => void up({ done }));
      const byId = new Map(bodies.map((e) => [e.id, e]));
      const { kept: signals, costUsd: refuteCost } = await refuteSignals(key, rawSignals, byId);
      const result = await reconcile(userId, signals, byId);
      totCost += extractCost + refuteCost;
      totSignals += signals.length;
      totCreated += result.created;
      totUpdated += result.updated;

      // ── checkpoint BEFORE the next chunk: nothing here can be lost ─────
      await markEmailsSeen(userId, mode, fresh.map((h) => h.id));
      const chunkNewest = headers.reduce((m, h) => Math.max(m, h.date || 0), 0) || Date.now();
      await setMailState(userId, mode, chunkNewest);
      cursor = chunkNewest - 2 * DAY;
      pass++;

      // A full chunk means more history probably waits behind it; a short one
      // means the mailbox is exhausted down to the cursor.
      if (headers.length < CHUNK) break;
    }

    state = await getMailState(userId, mode);
    await up({
      status: "done", phase: "done",
      done: totFresh, total: totFresh,
      found: totSignals, created: totCreated, updated: totUpdated,
      costUsd: totCost,
    });
    await logEvent(userId, "inbox_scan", {
      mode, backfill, headers: totHeaders, fresh: totFresh,
      read: totRead, signals: totSignals, skipped: totSkipped,
      created: totCreated, updated: totUpdated, cursor: state?.lastDate,
    });
  } catch (e) {
    await up({ status: "error", phase: "error", error: e instanceof Error ? e.message : String(e) });
  }
}