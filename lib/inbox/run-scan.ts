import { triageHeaders, extractSignals, refuteSignals, prefilterBulk } from "./classify";
import { reconcile } from "./reconcile";
import {
  demoInbox, fetchGmailHeaders, fetchGmailBodies, fetchImapHeaders, fetchImapBodies, fetchImapTotal,
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
    // Read once for early errors; re-read after credentials are saved, because
    // a changed address or app password resets the scan state (new mailbox,
    // clean rebuild) and the cursor must start from the beginning.
    let state = await getMailState(userId, mode);
    const startedAt = Date.now();
    let totHeaders = 0, totFresh = 0, totRead = 0, totSignals = 0, totSkipped = 0;
    let totCreated = 0, totUpdated = 0, totCost = 0;

    // One connection-maker per mode, closed over the credentials.
    let listHeaders: (sinceMs: number) => Promise<EmailHeader[]>;
    let getBodies: (ids: string[], onChunk?: (done: number) => void) => Promise<RawEmail[]>;
    // The whole-mailbox size when the driver can say it, so the progress bar
    // has a real denominator instead of resetting per chunk.
    let totalBox: number | null = null;

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
      totalBox = await fetchImapTotal(email, appPassword);
      if (opts.email && opts.appPassword) {
        await saveMailCreds(userId, { source: "imap", email: opts.email, appPassword: opts.appPassword });
      }
    } else if (mode === "judge") {
      const jEmail = (await getSecret("judge_inbox_email")) ?? process.env.JUDGE_INBOX_EMAIL;
      const jPass = (await getSecret("judge_inbox_app_password")) ?? process.env.JUDGE_INBOX_APP_PASSWORD;
      if (!jEmail || !jPass) throw new Error("The judges' inbox is not connected yet. The owner adds an app password to enable it; meanwhile the demo inbox shows the same flow.");
      listHeaders = (sinceMs) => fetchImapHeaders(jEmail, jPass, { sinceMs, cap: CHUNK });
      getBodies = (ids, onChunk) => fetchImapBodies(jEmail, jPass, ids, onChunk);
      totalBox = await fetchImapTotal(jEmail, jPass);
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

    // The cursor points at where history was last fully processed. A first
    // scan starts at the beginning of time; later scans start two days
    // before the newest processed message, and seen-ids remove the overlap.
    // Read AFTER the credentials step: an updated app password resets state.
    state = await getMailState(userId, mode);
    const backfill = !state;
    let cursor = state ? state.lastDate - 2 * DAY : 0;

    // ── the walk, oldest first, checkpointed per chunk ───────────────────
    let pass = 0;
    // Progress is cumulative across chunks so the bar fills once, end to
    // end, instead of completing and restarting for every chunk.
    let base = 0; // emails fully processed in finished chunks
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
      // The bar's denominator: the whole mailbox when the driver knows it,
      // otherwise what we have walked plus one more chunk's worth of hope.
      const overallTotal = backfill
        ? totalBox ?? Math.max(base + (headers.length >= CHUNK ? CHUNK * 2 : headers.length), 1)
        : Math.max(base + headers.length, 1);
      const prog = (phase: string, done: number, extra: Record<string, unknown> = {}) =>
        up({ phase, done: base + done, total: overallTotal, ...extra });

      let lastTick = 0;
      const { keep, costUsd: triageCost } = await triageHeaders(key, nonBulk, (done) => {
        if (done - lastTick >= 180 || done === nonBulk.length) { lastTick = done; void prog("triage", done, { alreadyKnown: seen.size }); }
      });
      totCost += triageCost;

      const keepSet = new Set(keep);
      await insertSkippedEmails(userId, mode, [
        ...bulk.map((h) => ({ source: mode, emailId: h.id, fromAddr: h.from, subject: h.subject, emailDate: h.date, reason: "bulk" })),
        ...nonBulk.filter((h) => !keepSet.has(h.id)).map((h) => ({ source: mode, emailId: h.id, fromAddr: h.from, subject: h.subject, emailDate: h.date, reason: "triage" })),
      ]);
      totSkipped += bulk.length + (nonBulk.length - keepSet.size);

      // ── bodies for the survivors only ──────────────────────────────────
      await prog("reading", nonBulk.length, { costUsd: triageCost });
      const bodies = await getBodies([...keep], (done) => void prog("reading", nonBulk.length + done, {}));

      // ── extract, verify quotes, reconcile ──────────────────────────────
      const extractBase = nonBulk.length + keep.size;
      await prog("extracting", extractBase, {});
      const { signals: rawSignals, costUsd: extractCost } = await extractSignals(key, bodies, (done) => void prog("extracting", extractBase + done, {}));
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
      base += fresh.length;
      pass++;

      // A full chunk means more history probably waits behind it; a short one
      // means the mailbox is exhausted down to the cursor.
      if (headers.length < CHUNK) break;
    }

    state = await getMailState(userId, mode);
    const finished = totalBox && backfill ? Math.min(base, totalBox) : base;
    await up({
      status: "done", phase: "done",
      done: finished, total: finished,
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