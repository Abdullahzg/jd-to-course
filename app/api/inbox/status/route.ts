import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMailCreds, latestScanJob } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * What the dashboard needs to draw the right buttons: is an inbox already
 * connected here, and which route did the last scan use. Three identical
 * buttons for three different situations was the complaint; this is the
 * data that lets each situation get its own furniture.
 */
export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const [creds, job] = await Promise.all([getMailCreds(userId), latestScanJob(userId)]);
  const gmailConnected = Boolean((session as { gmailConnected?: boolean }).gmailConnected);
  return NextResponse.json({
    ok: true,
    savedImap: creds ? creds.email.replace(/^(.{2})[^@]*@/, "$1***@") : null,
    savedImapFull: creds ? creds.email : null,
    gmailConnected,
    lastMode: job?.mode ?? null,
  });
}
