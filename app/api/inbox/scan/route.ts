import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { auth } from "@/auth";
import { getActiveKey } from "@/lib/ai/keystore";
import { classifyEmails } from "@/lib/inbox/classify";
import { reconcile } from "@/lib/inbox/reconcile";
import { demoInbox, fetchGmail, fetchImap } from "@/lib/inbox/drivers";
import {
  logEvent, getSecret, getMailCreds, saveMailCreds,
  getMailState, setMailState, seenEmailIds, markEmailsSeen,
} from "@/lib/db";
import type { RawEmail } from "@/lib/inbox/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const DAY = 24 * 3600 * 1000;

/**
 * One scan: fetch mail, classify with receipts, reconcile into the tracker.
 *
 * Scans are incremental. The first one on a connection backfills a year, so a
 * judge who connects sees their real applications appear grouped with quotes.
 * Every later scan starts from the newest message already processed, minus a
 * two day overlap for stragglers, and message ids that were processed once
 * are never classified again. Reading forty thousand emails happens at most
 * once per mailbox; after that a scan costs what the new mail costs.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  let body: { mode?: string; email?: string; appPassword?: string } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const mode = body.mode ?? "demo";

  const { key } = await getActiveKey();
  if (!key) return NextResponse.json({ ok: false, error: "Connect an API key first, the bar at the top of the page takes one." }, { status: 400 });

  const state = await getMailState(userId, mode);
  const backfill = !state;
  const sinceMs = state ? state.lastDate - 2 * DAY : Date.now() - 365 * DAY;
  const cap = backfill ? 400 : 200;

  let emails: RawEmail[];
  try {
    if (mode === "gmail") {
      const token = await getToken({ req: req as never, secret: process.env.AUTH_SECRET ?? "dev-only-secret-set-AUTH_SECRET-in-production" });
      const access = (token as { gmail?: string } | null)?.gmail;
      if (!access) return NextResponse.json({ ok: false, error: "Google is not connected on this session. Sign in with Google, approving the Gmail permission." }, { status: 400 });
      emails = await fetchGmail(access, { sinceMs, cap });
    } else if (mode === "imap") {
      // Fresh credentials are saved; a scan without them falls back to the
      // saved pair, so "Scan again" tomorrow is one click, not a re-type.
      let creds = body.email && body.appPassword
        ? { email: body.email, appPassword: body.appPassword }
        : await getMailCreds(userId);
      if (!creds) {
        return NextResponse.json({ ok: false, error: "The app password route needs your address and a 16 character Google app password." }, { status: 400 });
      }
      emails = await fetchImap(creds.email, creds.appPassword, { sinceMs, cap });
      if (body.email && body.appPassword) {
        await saveMailCreds(userId, { source: "imap", email: body.email, appPassword: body.appPassword });
      }
    } else if (mode === "judge") {
      // The judges' shared inbox: the owner's real Gmail, read through an app
      // password held in the database, not in anyone's env file. A judge sees
      // the tracker work on real mail without connecting anything of their own.
      const jEmail = (await getSecret("judge_inbox_email")) ?? process.env.JUDGE_INBOX_EMAIL;
      const jPass = (await getSecret("judge_inbox_app_password")) ?? process.env.JUDGE_INBOX_APP_PASSWORD;
      if (!jEmail || !jPass) {
        return NextResponse.json({ ok: false, error: "The judges' inbox is not connected yet. The owner adds an app password to enable it; meanwhile the demo inbox shows the same flow." }, { status: 400 });
      }
      emails = await fetchImap(jEmail, jPass, { sinceMs, cap });
    } else {
      emails = demoInbox();
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // Never pay twice for the same message: ids processed by any earlier scan
  // are dropped before a single model call happens.
  const seen = await seenEmailIds(userId, mode, emails.map((e) => e.id));
  const fresh = emails.filter((e) => !seen.has(e.id));

  const { signals, costUsd, triaged, dropped } = await classifyEmails(key, fresh);
  const byId = new Map(fresh.map((e) => [e.id, e]));
  const result = await reconcile(userId, signals, byId);

  await markEmailsSeen(userId, mode, fresh.map((e) => e.id));
  const newest = emails.reduce((m, e) => Math.max(m, e.date || 0), state?.lastDate ?? 0);
  await setMailState(userId, mode, newest || Date.now());

  await logEvent(userId, "inbox_scan", { mode, backfill, fetched: emails.length, fresh: fresh.length, signals: signals.length, ...result });

  return NextResponse.json({
    ok: true,
    mode,
    backfill,
    emailsRead: fresh.length,
    alreadyKnown: emails.length - fresh.length,
    lookedRelevant: triaged,
    signals: signals.length,
    quotesRejected: dropped,
    ...result,
    costUsd,
  });
}
