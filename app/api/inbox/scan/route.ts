import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { auth } from "@/auth";
import { getActiveKey } from "@/lib/ai/keystore";
import { classifyEmails } from "@/lib/inbox/classify";
import { reconcile } from "@/lib/inbox/reconcile";
import { demoInbox, fetchGmail, fetchImap } from "@/lib/inbox/drivers";
import { listTracker, logEvent } from "@/lib/db";
import type { RawEmail } from "@/lib/inbox/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * One scan: fetch mail, classify with receipts, reconcile into the tracker.
 *
 * The first scan on a fresh connection backfills a year, so a judge who
 * connects sees their own real applications appear, grouped, with quotes,
 * not an empty table asking them to type. Later scans read a fortnight.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  let body: { mode?: string; email?: string; appPassword?: string; backfill?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const mode = body.mode ?? "demo";
  const backfill = body.backfill ?? listTracker(userId).length === 0;

  const { key } = await getActiveKey();
  if (!key) return NextResponse.json({ ok: false, error: "Connect an API key first, the bar at the top of the page takes one." }, { status: 400 });

  let emails: RawEmail[];
  try {
    if (mode === "gmail") {
      const token = await getToken({ req: req as never, secret: process.env.AUTH_SECRET ?? "dev-only-secret-set-AUTH_SECRET-in-production" });
      const access = (token as { gmail?: string } | null)?.gmail;
      if (!access) return NextResponse.json({ ok: false, error: "Google is not connected on this session. Sign in with Google, approving the Gmail permission." }, { status: 400 });
      emails = await fetchGmail(access, { backfill });
    } else if (mode === "imap") {
      if (!body.email || !body.appPassword) {
        return NextResponse.json({ ok: false, error: "The app password route needs your address and a 16 character Google app password." }, { status: 400 });
      }
      emails = await fetchImap(body.email, body.appPassword, { backfill });
    } else if (mode === "judge") {
      // The judges' shared inbox: the owner's real Gmail, read through an app
      // password held server side. A judge sees the tracker work on real mail
      // without connecting anything of their own.
      const jEmail = process.env.JUDGE_INBOX_EMAIL;
      const jPass = process.env.JUDGE_INBOX_APP_PASSWORD;
      if (!jEmail || !jPass) {
        return NextResponse.json({ ok: false, error: "The judges' inbox is not connected yet. The owner adds an app password to enable it; meanwhile the demo inbox shows the same flow." }, { status: 400 });
      }
      emails = await fetchImap(jEmail, jPass, { backfill: true });
    } else {
      emails = demoInbox();
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const { signals, costUsd, triaged, dropped } = await classifyEmails(key, emails);
  const byId = new Map(emails.map((e) => [e.id, e]));
  const result = reconcile(userId, signals, byId);

  logEvent(userId, "inbox_scan", { mode, backfill, emails: emails.length, signals: signals.length, ...result });

  return NextResponse.json({
    ok: true,
    mode,
    emailsRead: emails.length,
    lookedRelevant: triaged,
    signals: signals.length,
    quotesRejected: dropped,
    ...result,
    costUsd,
  });
}
