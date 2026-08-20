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
const YEAR = 365 * DAY;
/** How many emails flow through the pipeline in one go. */
const CHUNK = 3000;
/** Stop starting new chunks after this long; the rest is picked up by the next scan. */
const TIME_BUDGET = Number(process.env.SCAN_TIME_BUDGET ?? 240_000);
/** Older than this, the walk stops asking. */
const FLOOR = Date.UTC(2000, 0, 1);

/**
 * A whole scan, run behind a job row instead of behind an open HTTP request.
 *
 * The walk is yearly, newest year first: the current year answers in the
 * first scan, older years in the scans after it, so a fresh connect shows
 * this season's applications rather than a museum. Two passes:
 *
 *   1. sync — anything newer than the frontier (new mail since last time)
 *   2. backfill — the next year below the frontier, oldest-first inside the
 *      year, checkpointed per chunk (seen ids) so an interrupted walk loses
 *      nothing and the next scan resumes exactly where it stopped.
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
    const startedAt = Date.now();
    let totHeaders = 0, totFresh = 0, totRead = 0, totSignals = 0, totSkipped = 0;
    let totCreated = 0, totUpdated = 0, totCost = 0;
    let base = 0; // cumulative progress within this scan, across chunks

    // One connection-maker per mode, closed over the credentials.
    let listHeaders: (sinceMs: number, beforeMs?: number) => Promise<EmailHeader[]>;
    let getBodies: (ids: string[], onChunk?: (done: number) => void) => Promise<RawEmail[]>;
    let totalBox: number | null = null;
    let isDemo = false;

    if (mode === "gmail") {
      if (!opts.gmailToken) throw new Error("Google is not connected on this session. Sign in with Google, approving the Gmail permission.");
      const token = opts.gmailToken;
      listHeaders = (sinceMs, beforeMs) => fetchGmailHeaders(token, { sinceMs, beforeMs });
      getBodies = (ids, onChunk) => fetchGmailBodies(token, ids, onChunk);
    } else if (mode === "imap") {
      let creds = opts.email && opts.appPassword
        ? { email: opts.email, appPassword: opts.appPassword }
        : await getMailCreds(userId);
      if (!creds) throw new Error("The app password route needs your address and a 16 character Google app password.");
      const { email, appPassword } = creds;
      listHeaders = (sinceMs, beforeMs) => fetchImapHeaders(email, appPassword, { sinceMs, beforeMs });
      getBodies = (ids, onChunk) => fetchImapBodies(email, appPassword, ids, onChunk);
      totalBox = await fetchImapTotal(email, appPassword);
      if (opts.email && opts.appPassword) {
        await saveMailCreds(userId, { source: "imap", email: opts.email, appPassword: opts.appPassword });
      }
    } else if (mode === "judge") {
      const jEmail = (await getSecret("judge_inbox_email")) ?? process.env.JUDGE_INBOX_EMAIL;
      const jPass = (await getSecret("judge_inbox_app_password")) ?? process.env.JUDGE_INBOX_APP_PASSWORD;
      if (!jEmail || !jPass) throw new Error("The judges' inbox is not connected yet. The owner adds an app password to enable it; meanwhile the demo inbox shows the same flow.");
      listHeaders = (sinceMs, beforeMs) => fetchImapHeaders(jEmail, jPass, { sinceMs, beforeMs });
      getBodies = (ids, onChunk) => fetchImapBodies(jEmail, jPass, ids, onChunk);
      totalBox = await fetchImapTotal(jEmail, jPass);
    } else {
      isDemo = true;
      const demo = demoInbox();
      listHeaders = async () => demo;
      getBodies = async (ids) => demo.filter((e) => ids.includes(e.id));
    }

    // Owner rows do not belong in a personal scan's result. Shifting back
    // to your own inbox is also a replacement, not a merge.
    if (mode === "imap" || mode === "gmail") {
      await purgeJudgeRows(userId);
    }

    // Re-read after the credentials step: an updated app password resets
    // state, and the walk must start from the beginning of time.
    state = await getMailState(userId, mode);
    const backfill = !state;
    let lastDate = state?.lastDate ?? 0;
    let frontier = state?.backfillBefore ?? (backfill ? Date.now() : state?.lastDate ?? Date.now());

    /** The per-chunk pipeline: triage → bodies → extract → refute → reconcile. */
    const processChunk = async (chunk: EmailHeader[]) => {
      totHeaders += chunk.length;
      const seen = await seenEmailIds(userId, mode, chunk.map((h) => h.id));
      const fresh = chunk.filter((h) => !seen.has(h.id));
      totFresh += fresh.length;
      if (!fresh.length) return;

      const { kept: nonBulk, bulk } = prefilterBulk(fresh);
      const overallTotal = totalBox ?? Math.max(base + CHUNK * 2, 1);
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

      await prog("reading", nonBulk.length, { costUsd: triageCost });
      const bodies = await getBodies([...keep], (done) => void prog("reading", nonBulk.length + done, {}));
      totRead += bodies.length;

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

      // Checkpoint: seen before the next chunk, so a killed scan loses nothing.
      await markEmailsSeen(userId, mode, fresh.map((h) => h.id));
      base += fresh.length;
    };

    // ── demo: one pass, done ─────────────────────────────────────────────
    if (isDemo) {
      const demo = await listHeaders(0);
      await processChunk([...demo].sort((a, b) => a.date - b.date));
      const newest = demo.reduce((m, h) => Math.max(m, h.date || 0), 0) || Date.now();
      await setMailState(userId, mode, newest, FLOOR);
    } else {
      // ── pass 1: sync — anything newer than the frontier ────────────────
      const syncSince = Math.max(lastDate, frontier) - 2 * DAY;
      const syncHeaders = await listHeaders(syncSince);
      if (syncHeaders.length) {
        await up({ phase: "connecting" });
        await processChunk([...syncHeaders].sort((a, b) => a.date - b.date));
        lastDate = Math.max(lastDate, ...syncHeaders.map((h) => h.date || 0));
        await setMailState(userId, mode, lastDate, frontier);
      }

      // ── pass 2: backfill — the next year below the frontier ────────────
      for (;;) {
        if (Date.now() - startedAt > TIME_BUDGET) break;
        const windowTop = frontier + 2 * DAY;
        const windowBottom = frontier - YEAR;
        if (windowBottom < FLOOR) { frontier = FLOOR; await setMailState(userId, mode, lastDate, frontier); break; }

        await up({ phase: "connecting" });
        const headers = await listHeaders(windowBottom - 2 * DAY, windowTop);
        if (!headers.length) {
          frontier = windowBottom;
          await setMailState(userId, mode, lastDate, frontier);
          continue;
        }
        const seenAll = await seenEmailIds(userId, mode, headers.map((h) => h.id));
        const freshAll = headers.filter((h) => !seenAll.has(h.id));
        if (!freshAll.length) {
          // The year is fully read: step down to the year below it.
          frontier = windowBottom;
          await setMailState(userId, mode, lastDate, frontier);
          continue;
        }
        // Oldest first inside the year, chunked, checkpointed per chunk.
        const ordered = [...freshAll].sort((a, b) => a.date - b.date);
        let processed = 0;
        for (let i = 0; i < ordered.length; i += CHUNK) {
          if (i > 0 && Date.now() - startedAt > TIME_BUDGET) break;
          await processChunk(ordered.slice(i, i + CHUNK));
          processed = i + Math.min(CHUNK, ordered.length - i);
        }
        if (processed >= ordered.length) {
          frontier = windowBottom;
        }
        await setMailState(userId, mode, lastDate, frontier);
        if (processed < ordered.length) break; // budget ran out; next scan resumes
      }
    }

    state = await getMailState(userId, mode);
    await up({
      status: "done", phase: "done",
      done: base, total: base || 1,
      found: totSignals, created: totCreated, updated: totUpdated,
      costUsd: totCost,
    });
    await logEvent(userId, "inbox_scan", {
      mode, backfill, headers: totHeaders, fresh: totFresh,
      read: totRead, signals: totSignals, skipped: totSkipped,
      created: totCreated, updated: totUpdated, frontier: state?.backfillBefore, lastDate: state?.lastDate,
    });
  } catch (e) {
    await up({ status: "error", phase: "error", error: e instanceof Error ? e.message : String(e) });
  }
}