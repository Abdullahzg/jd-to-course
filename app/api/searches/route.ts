import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveSearch, listSearches, getSearch, logEvent } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  // Signed out is not an error: the planner works without an account, it
  // just cannot remember you. The client fires and forgets.
  if (!userId) return NextResponse.json({ ok: false, reason: "signed out" });
  const b = await req.json();
  if (!b?.jd || !b?.snapshot) return NextResponse.json({ ok: false }, { status: 400 });
  const id = saveSearch(userId, {
    title: String(b.title ?? "Untitled search").slice(0, 160),
    jd: String(b.jd).slice(0, 20000),
    snapshot: JSON.stringify(b.snapshot).slice(0, 900000),
    coursesPicked: Number(b.coursesPicked) || 0,
    partsAnswered: Number(b.partsAnswered) || 0,
  });
  logEvent(userId, "search_saved", { id });
  return NextResponse.json({ ok: true, id });
}

export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const s = getSearch(userId, id);
    if (!s) return NextResponse.json({ ok: false }, { status: 404 });
    return NextResponse.json({ ok: true, search: { ...s, snapshot: JSON.parse(s.snapshot) } });
  }
  return NextResponse.json({ ok: true, searches: listSearches(userId) });
}
