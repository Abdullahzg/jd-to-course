import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { adminStats, userTrail, adminSearchDetail, adminTrackerItems } from "@/lib/db";

export const dynamic = "force-dynamic";

function isAdmin(email: string) {
  const allowed = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !allowed.length || allowed.includes(email.toLowerCase());
}

export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  if (!email || !isAdmin(email)) {
    return NextResponse.json({ ok: false, error: "Not yours to see." }, { status: 403 });
  }
  const url = new URL(req.url);
  const userId = url.searchParams.get("user");

  if (!userId) {
    return NextResponse.json({ ok: true, ...(await adminStats()) });
  }

  // ?user=<id>&search=<searchId>  —  full search detail
  const searchId = url.searchParams.get("search");
  if (searchId) {
    const detail = await adminSearchDetail(userId, searchId);
    if (!detail) return NextResponse.json({ ok: false, error: "Search not found." }, { status: 404 });
    return NextResponse.json({ ok: true, search: detail });
  }

  // ?user=<id>&tracker=1  —  all tracker items for this user
  if (url.searchParams.has("tracker")) {
    const items = await adminTrackerItems(userId);
    return NextResponse.json({ ok: true, items });
  }

  // ?user=<id>  —  full trail
  return NextResponse.json({ ok: true, ...(await userTrail(userId)) });
}