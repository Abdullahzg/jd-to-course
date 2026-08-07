import { NextResponse } from "next/server";
import { getActiveKey } from "@/lib/ai/keystore";
import { HaikuError, haiku } from "@/lib/ai/haiku";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// BUILD_SPEC §5, allowed live use #5: explanation rendering.
// Input is the solver's own trace and nothing else. If a fact isn't in the
// trace, it cannot be said. The model is a renderer here, not a reasoner —
// which is why the route sends it a small typed object rather than the world.

const SYSTEM = `You put a constraint solver's trace into plain English for a student.

You are given a JSON trace. Every fact you state must come from that JSON.

Hard rules:
- Never state a fact that is not in the trace. No course you were not given, no
  prerequisite you were not given, no requirement you were not given.
- Never say whether a course is good, popular, easy, or worth taking. You do not
  know and it is not your job.
- Never suggest a different course. The solver already chose.
- If the trace does not explain something, say what the trace does say and stop.
- Write 2 to 4 short sentences. No preamble, no heading, no bullet points, no
  markdown. Address the student as "you".
- Never use an em dash or an en dash. Use a comma, a colon, or a full stop.
- Refer to courses by the exact code string in the trace.
- If needsAdvisorCheck is true, end with one sentence telling the student to
  check that prerequisite with their advisor, quoting the catalog wording.`;

export async function POST(req: Request) {
  const { key } = await getActiveKey();
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "No API key connected. The panel below shows the solver's own trace instead." },
      { status: 400 },
    );
  }

  let trace: unknown;
  try {
    ({ trace } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON body with a `trace`." }, { status: 400 });
  }

  if (!trace || typeof trace !== "object") {
    return NextResponse.json({ ok: false, error: "There is no trace to explain." }, { status: 400 });
  }

  try {
    const { content, costUsd } = await haiku<string>({
      key,
      purpose: "solver trace → explanation",
      system: SYSTEM,
      user: JSON.stringify(trace).slice(0, 8000),
      maxTokens: 260,
      temperature: 0.2,
    });
    return NextResponse.json({ ok: true, text: content.trim(), costUsd });
  } catch (e) {
    const err = e as HaikuError;
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status ?? 502 });
  }
}
