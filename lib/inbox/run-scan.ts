import { triageHeaders, extractSignals } from "./classify";
import { reconcile } from "./reconcile";
import {
  demoInbox, fetchGmailHeaders, fetchGmailBodies, fetchImapHeaders, fetchImapBodies,
} from "./drivers";
import {
  logEvent, getSecret, getMailCreds, saveMailCreds,
  getMailState, setMailState, seenEmailIds, markEmailsSeen, updateScanJob,
} from "@/lib/db";
import type { EmailHeader, RawEmail } from "./types";

const DAY = 24 * 3600 * 1000;

/**
 * A whole scan, run behind a job row instead of behind an open HTTP request.
 *
 * The request that starts a scan returns immediately with a job id; this
 * function then reports every stage into carpa_scan_jobs, which the setup
 * page, the dashboard and the site-wide notifier all poll. The stages:
 * list every header in the window, drop the ones already processed, triage
 * headers in parallel, download bodies for the survivors only, extract
 * statuses with proof, reconcile. A first connection covers a full year of
 * the ENTIRE mailbox; there is no arbitrary message cap any more, because
 * headers cost nothing and bodies are only fetched for what matters.
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
    const state = await getMailState(userId, mode);
    const backfill = !state;
    const sinceMs = state ? state.lastDate - 2 * DAY : Date.now() - 365 * DAY;

    // ── list ────────────────────────────────────────────────────────────
    await up({ phase: "connecting" });
    let headers: EmailHeader[];
    let getBodies: (ids: string[], onChunk?: (done: number) => void) => Promise<RawEmail[]>;

    // A person's own connection reads their newest 400; that is plenty to
    // build a season and keeps a first scan under a minute. The owner's
    // shared inbox is built once, in full, and cloned to judges after.
    const personalCap = 400;
    if (mode === "gmail") {
      if (!opts.gmailToken) throw new Error("Google is not connected on this session. Sign in with Google, approving the Gmail permission.");
      const token = opts.gmailToken;
      headers = await fetchGmailHeaders(token, { sinceMs, cap: personalCap });
      getBodies = (ids, onChunk) => fetchGmailBodies(token, ids, onChunk);
    } else if (mode === "imap") {
      let creds = opts.email && opts.appPassword
        ? { email: opts.email, appPassword: opts.appPassword }
        : await getMailCreds(userId);
      if (!creds) throw new Error("The app password route needs your address and a 16 character Google app password.");
      const { email, appPassword } = creds;
      headers = await fetchImapHeaders(email, appPassword, { sinceMs, cap: personalCap });
      getBodies = (ids, onChunk) => fetchImapBodies(email, appPassword, ids, onChunk);
      if (opts.email && opts.appPassword) {
        await saveMailCreds(userId, { source: "imap", email: opts.email, appPassword: opts.appPassword });
      }
    } else if (mode === "judge") {
      const jEmail = (await getSecret("judge_inbox_email")) ?? process.env.JUDGE_INBOX_EMAIL;
      const jPass = (await getSecret("judge_inbox_app_password")) ?? process.env.JUDGE_INBOX_APP_PASSWORD;
      if (!jEmail || !jPass) throw new Error("The judges' inbox is not connected yet. The owner adds an app password to enable it; meanwhile the demo inbox shows the same flow.");
      headers = await fetchImapHeaders(jEmail, jPass, { sinceMs });
      getBodies = (ids, onChunk) => fetchImapBodies(jEmail, jPass, ids, onChunk);
    } else {
      const demo = demoInbox();
      headers = demo;
      getBodies = async (ids) => demo.filter((e) => ids.includes(e.id));
    }

    // ── skip what earlier scans already paid for ─────────────────────────
    const seen = await seenEmailIds(userId, mode, headers.map((h) => h.id));
    const fresh = headers.filter((h) => !seen.has(h.id));
    await up({ phase: "triage", total: fresh.length, done: 0, alreadyKnown: seen.size });

    // ── triage headers, in parallel waves ────────────────────────────────
    let lastTick = 0;
    const { keep, costUsd: triageCost } = await triageHeaders(key, fresh, (done) => {
      if (done - lastTick >= 180 || done === fresh.length) { lastTick = done; void up({ done }); }
    });

    // ── bodies for the survivors only ────────────────────────────────────
    await up({ phase: "reading", total: keep.size, done: 0, costUsd: triageCost });
    const bodies = await getBodies([...keep], (done) => void up({ done }));

    // ── extract, verify quotes, reconcile ────────────────────────────────
    await up({ phase: "extracting", total: bodies.length, done: 0 });
    const { signals, costUsd: extractCost, dropped } = await extractSignals(key, bodies, (done) => void up({ done }));
    const byId = new Map(bodies.map((e) => [e.id, e]));
    const result = await reconcile(userId, signals, byId);

    await markEmailsSeen(userId, mode, fresh.map((h) => h.id));
    const newest = headers.reduce((m, h) => Math.max(m, h.date || 0), state?.lastDate ?? 0);
    await setMailState(userId, mode, newest || Date.now());

    await up({
      status: "done", phase: "done",
      done: fresh.length, total: fresh.length,
      found: signals.length, created: result.created, updated: result.updated,
      costUsd: triageCost + extractCost,
    });
    await logEvent(userId, "inbox_scan", {
      mode, backfill, headers: headers.length, fresh: fresh.length,
      read: bodies.length, signals: signals.length, dropped, ...result,
    });
  } catch (e) {
    await up({ status: "error", phase: "error", error: e instanceof Error ? e.message : String(e) });
  }
}
