import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTracker, trackerEventsFor, trackerEventBody, updateTrackerItem, deleteTrackerItem, insertTrackerItem, logEvent } from "@/lib/db";

export const dynamic = "force-dynamic";

const KINDS = ["internship", "job", "research", "grad school", "scholarship", "hackathon", "program", "other"];
const STATUSES = ["applied", "assessment", "interview", "offer", "accepted", "rejected", "waitlisted", "action needed", "update"];

export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  // ?eventBody=<id>: the stored email for one receipt, fetched only when a
  // person opens it. Keeping bodies out of the list keeps the list light.
  const evId = new URL(req.url).searchParams.get("eventBody");
  if (evId) {
    const body = await trackerEventBody(userId, evId);
    return NextResponse.json({ ok: true, body });
  }
  const rows = await listTracker(userId);
  const evMap = await trackerEventsFor(rows.map((t) => t.id));
  const items = rows.map((t) => ({ ...t, events: evMap.get(t.id) ?? [] }));
  return NextResponse.json({ ok: true, items });
}

/**
 * A row the inbox never produced. Some applications arrive by phone, by portal,
 * by a friend forwarding a link, and a tracker that can only be filled by
 * machine is a tracker a student stops trusting the moment it misses one.
 * These rows say plainly that a person entered them, so nothing pretends to a
 * proof it does not have.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const company = String(b.company ?? "").trim();
  if (!company) return NextResponse.json({ ok: false, error: "An application needs a company or organisation." }, { status: 400 });
  const str = (v: unknown, n = 200) => { const x = String(v ?? "").trim(); return x ? x.slice(0, n) : null; };
  const when = Number(b.emailDate);
  const id = await insertTrackerItem({
    userId,
    company: company.slice(0, 120),
    role: str(b.role, 160),
    kind: KINDS.includes(String(b.kind)) ? String(b.kind) : "other",
    status: STATUSES.includes(String(b.status)) ? String(b.status) : "applied",
    quote: null,
    subject: "Added by hand",
    emailDate: Number.isFinite(when) && when > 0 ? when : Date.now(),
    actionLink: str(b.actionLink, 500),
    deadline: str(b.deadline, 120),
    notes: str(b.notes, 400),
    origin: "manual",
  });
  await logEvent(userId, "tracker_manual_add", { id, kind: b.kind });
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const { id, ...patch } = await req.json();
  const mine = (await listTracker(userId)).some((t) => t.id === id);
  if (!mine) return NextResponse.json({ ok: false }, { status: 404 });
  const allowed = ["status", "kind", "role", "company", "notes", "deadline"] as const;
  const clean: Record<string, string> = {};
  for (const k of allowed) if (typeof patch[k] === "string") clean[k] = patch[k].slice(0, 400);
  await updateTrackerItem(id, clean);
  await logEvent(userId, "tracker_manual_update", { id, fields: Object.keys(clean) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const { id } = await req.json();
  await deleteTrackerItem(userId, id);
  await logEvent(userId, "tracker_delete", { id });
  return NextResponse.json({ ok: true });
}
