import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTracker, trackerEventsFor, trackerEventBody, updateTrackerItem, deleteTrackerItem, logEvent } from "@/lib/db";

export const dynamic = "force-dynamic";

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
