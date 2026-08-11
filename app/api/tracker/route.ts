import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listTracker, trackerEvents, updateTrackerItem, deleteTrackerItem, logEvent } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const items = listTracker(userId).map((t) => ({ ...t, events: trackerEvents(t.id) }));
  return NextResponse.json({ ok: true, items });
}

export async function PATCH(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const { id, ...patch } = await req.json();
  const mine = listTracker(userId).some((t) => t.id === id);
  if (!mine) return NextResponse.json({ ok: false }, { status: 404 });
  const allowed = ["status", "kind", "role", "company", "notes", "deadline"] as const;
  const clean: Record<string, string> = {};
  for (const k of allowed) if (typeof patch[k] === "string") clean[k] = patch[k].slice(0, 400);
  updateTrackerItem(id, clean);
  logEvent(userId, "tracker_manual_update", { id, fields: Object.keys(clean) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const { id } = await req.json();
  deleteTrackerItem(userId, id);
  logEvent(userId, "tracker_delete", { id });
  return NextResponse.json({ ok: true });
}
