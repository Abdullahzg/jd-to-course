import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { auth } from "@/auth";
import { getActiveKey } from "@/lib/ai/keystore";
import { getSecret, getMailCreds, listSkippedEmails, deleteSkippedEmail, markEmailsSeen } from "@/lib/db";
import { fetchGmailBodies, fetchImapBodies } from "@/lib/inbox/drivers";
import { extractSignals, refuteSignals } from "@/lib/inbox/classify";
import { reconcile } from "@/lib/inbox/reconcile";
import type { RawEmail } from "@/lib/inbox/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The scan's reject pile, with a door back in.
 *
 * GET lists the emails the last scans decided not to track (bulk-filtered,
 * triage-dropped). POST reads one such email in full, runs the same
 * extract-and-verify pass the scan uses, and moves whatever it proves into
 * the tracker. The machine's "no" is reversible by a person; a person's
 * override still must pass the receipts rule, so nothing is fabricated:
 * no signal in the body, no row.
 */

/** Deliver one email's body from wherever this account reads mail. */
async function fetchOne(userId: string, source: string, emailId: string, req: Request): Promise<RawEmail[]> {
  if (source === "gmail") {
    const token = await getToken({ req: req as never, secret: process.env.AUTH_SECRET ?? "dev-only-secret-set-AUTH_SECRET-in-production" });
    const gmail = (token as { gmail?: string } | null)?.gmail;
    if (!gmail) throw new Error("Google is not connected on this session anymore. Sign in with Google first.");
    return fetchGmailBodies(gmail, [emailId]);
  }
  if (source === "judge") {
    const email = (await getSecret("judge_inbox_email")) ?? process.env.JUDGE_INBOX_EMAIL;
    const pass = (await getSecret("judge_inbox_app_password")) ?? process.env.JUDGE_INBOX_APP_PASSWORD;
    if (!email || !pass) throw new Error("The owner's inbox is not connected right now.");
    return fetchImapBodies(email, pass, [emailId]);
  }
  const creds = await getMailCreds(userId);
  if (!creds) throw new Error("Your inbox is not connected. Scan it once, then try again.");
  return fetchImapBodies(creds.email, creds.appPassword, [emailId]);
}

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const rows = await listSkippedEmails(userId);
  return NextResponse.json({ ok: true, skipped: rows });
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const emailId = String(b.emailId ?? "").slice(0, 200);
  const source = String(b.source ?? "imap").slice(0, 20);
  if (!emailId) return NextResponse.json({ ok: false, error: "Which email?" }, { status: 400 });

  const { key } = await getActiveKey();
  if (!key) return NextResponse.json({ ok: false, error: "Connect an API key first, the bar at the top of the page takes one." }, { status: 400 });

  let emails: RawEmail[];
  try {
    emails = await fetchOne(userId, source, emailId, req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  if (!emails.length) return NextResponse.json({ ok: false, error: "That email is gone from the mailbox." }, { status: 404 });

  const { signals: raw } = await extractSignals(key, emails, undefined);
  const byId = new Map(emails.map((e) => [e.id, e]));
  const { kept: signals } = await refuteSignals(key, raw, byId);
  if (!signals.length) {
    return NextResponse.json({ ok: true, created: 0, updated: 0, moved: false, note: "Nothing in that email establishes an application status, so nothing was moved. The receipts rule is not up for negotiation." });
  }
  const result = await reconcile(userId, signals, byId);
  await deleteSkippedEmail(userId, source, emailId);
  await markEmailsSeen(userId, source, [emailId]);
  return NextResponse.json({ ok: true, ...result, moved: true });
}

/** Dismiss one: stop showing it, do not track it. */
export async function DELETE(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  await deleteSkippedEmail(userId, String(b.source ?? "").slice(0, 20), String(b.emailId ?? "").slice(0, 200));
  return NextResponse.json({ ok: true });
}