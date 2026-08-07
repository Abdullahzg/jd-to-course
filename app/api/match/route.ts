import { NextResponse } from "next/server";
import { getActiveKey } from "@/lib/ai/keystore";
import { HaikuError, haiku } from "@/lib/ai/haiku";
import { getSchool } from "@/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// BUILD_SPEC §5, allowed live use: reading text.
//
// A job posting says "multimodal foundation model". A syllabus says "neural
// sequence-to-sequence models and transformers". A hand-written alias table
// will never cover that, and every miss lands the skill in "coursework cannot
// give you", which is the one bucket that has to stay honest. So a model does
// the vocabulary alignment.
//
// It stays inside the boundary because of what it is NOT given: no courses, no
// requirements, no student, no plan. It sees two lists of words and says which
// words mean the same thing. It cannot pick a course because it has never been
// shown one, and the evidence sentence a student reads still comes verbatim
// from the catalog.

const SYSTEM = `You align two vocabularies of technical skills.

You get TARGET skills (from a job posting) and CATALOG skills (the vocabulary a
university's course descriptions use). For each target skill, list the catalog
skills that genuinely teach it.

Rules:
- Use ONLY strings that appear verbatim in the CATALOG list. Never invent one.
- Match on meaning, not spelling. "Docker" is taught by "Containers".
  "GPU computing" by "GPU programming". "Multimodal foundation model" by
  "Deep learning" and "Transformers" if those are in the catalog list.
- A target skill may map to several catalog skills, or to none.
- Map to none when no catalog skill really teaches it. This is the correct and
  expected answer for anything that is experience rather than knowledge:
  "3 years in production", "shipped at scale", "on-call", "led a team".
  Do NOT stretch to find a match for those. An empty list is the honest answer.
- Do not map a target skill to a catalog skill that is merely adjacent.
  "Computer vision" is not taught by "Computer networks". If in doubt, leave it out.
- Return every target skill exactly once, in the order given.`;

const SCHEMA = {
  name: "skill_alignment",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            target: { type: "string" },
            catalog: { type: "array", items: { type: "string" } },
          },
          required: ["target", "catalog"],
        },
      },
    },
    required: ["matches"],
  },
} as const;

export async function POST(req: Request) {
  let skills: string[] = [];
  let schoolId = "";
  try {
    ({ skills, schoolId } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Send `skills` and `schoolId`." }, { status: 400 });
  }

  const school = getSchool(schoolId);
  if (!school) {
    return NextResponse.json({ ok: false, error: "Unknown school." }, { status: 400 });
  }
  skills = (skills ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 40);
  if (!skills.length) {
    return NextResponse.json({ ok: false, error: "No skills to align." }, { status: 400 });
  }

  // The catalog's own words, straight from the committed course descriptions.
  const vocabulary = [...new Set(school.courses.flatMap((c) => c.skills.map((s) => s.skill)))].sort();
  const valid = new Set(vocabulary.map((v) => v.toLowerCase()));

  const { key } = await getActiveKey();
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "No API key connected, so skills are matched on exact wording only." },
      { status: 400 },
    );
  }

  try {
    const { content, costUsd } = await haiku<{ matches: { target: string; catalog: string[] }[] }>({
      key,
      purpose: "align job skills to catalog skills",
      system: SYSTEM,
      user: `TARGET skills:\n${skills.map((s) => `- ${s}`).join("\n")}\n\nCATALOG skills:\n${vocabulary.map((s) => `- ${s}`).join("\n")}`,
      schema: SCHEMA as never,
      maxTokens: 1600,
    });

    // Anything the model returned that is not literally in the catalog
    // vocabulary is dropped. It cannot widen the vocabulary, only align to it.
    const out: Record<string, string[]> = {};
    for (const m of content.matches ?? []) {
      const target = skills.find((s) => s.toLowerCase() === String(m.target).trim().toLowerCase());
      if (!target) continue;
      const kept = [...new Set((m.catalog ?? [])
        .map((c) => String(c).trim())
        .filter((c) => valid.has(c.toLowerCase()))
        .map((c) => vocabulary.find((v) => v.toLowerCase() === c.toLowerCase())!))];
      out[target] = kept;
    }
    for (const s of skills) if (!(s in out)) out[s] = [];

    const matched = Object.values(out).filter((v) => v.length).length;
    return NextResponse.json({
      ok: true,
      matches: out,
      matchedCount: matched,
      vocabularySize: vocabulary.length,
      costUsd,
    });
  } catch (e) {
    const err = e as HaikuError;
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status ?? 502 });
  }
}
