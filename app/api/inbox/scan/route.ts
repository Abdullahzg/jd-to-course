import { NextResponse, after } from "next/server";
import { getToken } from "next-auth/jwt";
import { auth } from "@/auth";
import { getActiveKey } from "@/lib/ai/keystore";
import { runScan } from "@/lib/inbox/run-scan";
import { createScanJob, getScanJob, latestScanJob, updateScanJob, cloneJudgeRows, resetMailScan, SHARED_JUDGE_USER } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Scans are background jobs now. POST starts one and returns its id inside a
 * second; the reading happens behind the job row, however long the mailbox
 * takes, and nobody sits watching a spinner they cannot leave. GET reports a
 * job's progress; without a job id it reports the caller's newest job, which
 * is how the site-wide notifier finds work it did not start.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  let body: { mode?: string; email?: string; appPassword?: string; full?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const mode = body.mode ?? "demo";

  const { key } = await getActiveKey();
  if (!key) return NextResponse.json({ ok: false, error: "Connect an API key first, the bar at the top of the page takes one." }, { status: 400 });

  // Full re-scan: forget the cursor and every seen id, so the walk starts at
  // the beginning of the mailbox again and rebuilds both the tracker and the
  // reject pile. An incremental sync that reports "nothing new" on a mailbox
  // whose rows look wrong is answered by this, not by waiting.
  if (body.full && (mode === "imap" || mode === "gmail")) {
    await resetMailScan(userId, mode);
  }

  // The Gmail token lives in the request's JWT, so it must be read here,
  // while there still is a request, and handed to the detached runner.
  let gmailToken: string | undefined;
  if (mode === "gmail") {
    const token = await getToken({ req: req as never, secret: process.env.AUTH_SECRET ?? "dev-only-secret-set-AUTH_SECRET-in-production" });
    gmailToken = (token as { gmail?: string } | null)?.gmail;
    if (!gmailToken) return NextResponse.json({ ok: false, error: "Google is not connected on this session. Sign in with Google, approving the Gmail permission." }, { status: 400 });
  }

  const jobId = await createScanJob(userId, mode);

  if (mode === "judge") {
    // The owner's inbox was read in full once, into the shared judge user.
    // The clone happens HERE, inside the request, because it is a few
    // database writes: the judge's "connect" answers in the time a page
    // takes to load, with no polling theatre around a copy operation. An
    // admin's click additionally refreshes the shared copy from the real
    // mailbox, but in the background, after their own copy has answered.
    try {
      const res = await cloneJudgeRows(userId);
      await updateScanJob(jobId, { status: "done", phase: "done", done: res.total, total: res.total, created: res.created, found: res.total });
      const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (admins.includes((session?.user?.email ?? "").toLowerCase())) {
        after(async () => {
          const refreshJob = await createScanJob(SHARED_JUDGE_USER, "judge");
          await runScan(refreshJob, SHARED_JUDGE_USER, "judge", key, {});
          await cloneJudgeRows(userId);
        });
      }
      return NextResponse.json({ ok: true, jobId, done: true, created: res.created, total: res.total });
    } catch (e) {
      await updateScanJob(jobId, { status: "error", phase: "error", error: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }

  // after() keeps the runner alive once the response has gone out, which is
  // the difference between "background job" and "job the platform killed at
  // the end of the request" on a serverless deploy.
  after(() => runScan(jobId, userId, mode, key, {
    email: body.email, appPassword: body.appPassword, gmailToken,
  }));
  return NextResponse.json({ ok: true, jobId });
}

export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const id = new URL(req.url).searchParams.get("job");
  const job = id ? await getScanJob(userId, id) : await latestScanJob(userId);
  if (!job) return NextResponse.json({ ok: true, job: null });
  return NextResponse.json({ ok: true, job });
}
