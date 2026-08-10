import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { logEvent } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The click beacon. Small on purpose: a name, a little meta, a timestamp. */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  try {
    const { name, meta } = await req.json();
    if (typeof name === "string" && name.length <= 80) logEvent(userId, name.slice(0, 80), meta);
  } catch { /* a lost beacon is a lost beacon */ }
  return NextResponse.json({ ok: true });
}
