import { NextResponse } from "next/server";
import { solve } from "@/lib/solver";
import type { SolveRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// No model is imported into this file, and that is the point. Courses are
// chosen here, by the solver, and nowhere else in the product.

export async function POST(req: Request) {
  let body: SolveRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON solve request." }, { status: 400 });
  }

  if (!body?.schoolId || !body?.programId || !body?.student) {
    return NextResponse.json(
      { ok: false, error: "A solve needs a school, a program and a student." },
      { status: 400 },
    );
  }

  // Guard the inputs the UI can drift on, so a bad client never becomes a
  // hung solve.
  const student = {
    ...body.student,
    horizonTerms: clamp(body.student.horizonTerms ?? 4, 1, 8),
    completed: (body.student.completed ?? []).slice(0, 200),
    excluded: (body.student.excluded ?? []).slice(0, 200),
    locked: (body.student.locked ?? []).slice(0, 60),
    completedCredits: clamp(body.student.completedCredits ?? 0, 0, 400),
  };

  try {
    const request = { ...body, student, targetSkills: (body.targetSkills ?? []).slice(0, 40) };
    const budget = clamp(Number((body as { budgetMs?: number }).budgetMs) || 8000, 4000, 22000);
    let result = solve(request, budget);
    // The retry button was being handed to the student. "Took too long, try
    // again" is an instruction software can follow by itself, so it does: one
    // escalation, much larger budget, node cap raised to match, and the
    // student only ever sees a failure both attempts earned.
    if (!result.ok && result.infeasibility?.timedOut && budget < 20000) {
      result = solve(request, 20000, 2_000_000);
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        plans: [],
        coverage: null,
        counterfactuals: [],
        infeasibility: {
          message: "The solver hit an error on this input. Nothing was lost. Adjust a constraint and run it again.",
          blockingBuckets: [],
          suggestions: [],
        },
        stats: { nodesExplored: 0, ms: 0, provedOptimal: false, candidateCourses: 0, symmetryClasses: 0 },
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
