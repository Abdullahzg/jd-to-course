import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { adminStats, userTrail } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const allowed = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // With no allow list configured, any signed in user may look. A competition
  // demo box has one owner; a real deployment sets ADMIN_EMAILS and this
  // sentence stops being true.
  if (!email || (allowed.length && !allowed.includes(email.toLowerCase()))) {
    return NextResponse.json({ ok: false, error: "Not yours to see." }, { status: 403 });
  }
  const userId = new URL(req.url).searchParams.get("user");
  if (userId) return NextResponse.json({ ok: true, ...(await userTrail(userId)) });
  return NextResponse.json({ ok: true, ...(await adminStats()) });
}
