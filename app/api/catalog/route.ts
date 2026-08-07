import { NextResponse } from "next/server";
import { SCHOOLS } from "@/data";

export const dynamic = "force-static";

// The committed catalog, served whole. Nothing scrapes at request time (§3.3):
// this is the same data the solver runs on, so what the board renders and what
// the solver decided can never disagree.

export async function GET() {
  return NextResponse.json({
    schools: SCHOOLS.map((s) => ({
      id: s.id,
      name: s.name,
      shortName: s.shortName,
      structureNote: s.structureNote,
      catalogUrl: s.catalogUrl,
      programs: s.programs,
      courses: s.courses,
    })),
  });
}
