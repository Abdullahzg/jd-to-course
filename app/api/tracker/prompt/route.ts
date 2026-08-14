import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { haiku } from "@/lib/ai/haiku";
import { getActiveKey } from "@/lib/ai/keystore";
import { callerIp, guardExpensive } from "@/lib/rate";
import { listTracker, insertTrackerItem, updateTrackerItem, deleteTrackerItem, logEvent } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Say what is wrong with the table, in a sentence, and have it fixed.
 *
 * The tracker is built by machine and a machine will always miss something:
 * a company named three ways, a status that moved in a phone call, ten rows
 * from a programme the student abandoned. Fixing that by hand is fourteen
 * clicks per row, which is exactly the drudgery this product exists to end.
 *
 * Two phases, and the split is the point. PLAN reads the rows and the request
 * and returns a list of operations with a reason for each; it changes nothing.
 * APPLY executes operations the person has actually seen. No edit to a
 * student's own record happens because a model felt like it: it happens
 * because they read the list and pressed the button.
 */

const KINDS = ["internship", "job", "research", "grad school", "scholarship", "hackathon", "program", "other"];
const STATUSES = ["applied", "assessment", "interview", "offer", "accepted", "rejected", "waitlisted", "action needed", "update"];

const SYSTEM = `You edit a student's job application tracker on their instruction.

You are given the rows, numbered, and a request in plain English. Return the operations that carry out the request, and nothing else.

Each operation is one of:
- "edit": change fields on an existing row. Give its "n" (the row number) and only the fields that change.
- "add": create a row that does not exist. Give at least a company.
- "delete": remove a row entirely. Give its "n".

Rules that matter:
- Operate on EVERY row the request covers. "mark all the Google ones rejected" means one edit per matching row, not one edit.
- Never invent a status change the person did not ask for. If they say "rename X to Y", change the company and nothing else.
- If a request is ambiguous or you cannot find the rows it names, return no operation for it and say so in "unclear". Guessing at someone's record is worse than asking.
- "reason" is one short sentence, in plain language, addressed to the student, saying what this operation does and why you believe it was asked for. It is shown to them before anything happens.
- kind must be one of: ${KINDS.join(", ")}.
- status must be one of: ${STATUSES.join(", ")}.
- Dates: "deadline" is free text as the student would write it ("by 20 September", "within 5 days").
- Deleting is destructive and permanent. Only delete when the request plainly asks to remove, drop, or get rid of something.`;

const SCHEMA = {
  name: "tracker_ops",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ops: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["edit", "add", "delete"] },
            n: { type: "integer" },
            company: { type: "string" },
            role: { type: "string" },
            kind: { type: "string", enum: KINDS },
            status: { type: "string", enum: STATUSES },
            deadline: { type: "string" },
            notes: { type: "string" },
            reason: { type: "string" },
          },
          required: ["action", "reason"],
        },
      },
      unclear: { type: "string" },
    },
    required: ["ops"],
  },
} as const;

type Op = {
  action: "edit" | "add" | "delete";
  n?: number;
  company?: string; role?: string; kind?: string; status?: string;
  deadline?: string; notes?: string; reason: string;
};

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rows = await listTracker(userId);

  // ── phase two: carry out what they approved ───────────────────────────
  if (Array.isArray(body.apply)) {
    const byN = new Map(rows.map((r, i) => [i + 1, r]));
    let edited = 0, added = 0, deleted = 0;
    for (const op of body.apply as Op[]) {
      if (op.action === "add") {
        if (!op.company?.trim()) continue;
        await insertTrackerItem({
          userId, company: op.company.trim().slice(0, 120), role: op.role?.slice(0, 160) ?? null,
          kind: KINDS.includes(op.kind ?? "") ? op.kind! : "other",
          status: STATUSES.includes(op.status ?? "") ? op.status! : "applied",
          quote: null, subject: "Added by a prompt", emailDate: Date.now(),
          actionLink: null, deadline: op.deadline?.slice(0, 120) ?? null,
          notes: op.notes?.slice(0, 400) ?? null, origin: "manual",
        });
        added++;
        continue;
      }
      const row = byN.get(Number(op.n));
      if (!row) continue; // a row number this user does not own simply does not exist
      if (op.action === "delete") { await deleteTrackerItem(userId, row.id); deleted++; continue; }
      const patch: Record<string, string> = {};
      if (op.company?.trim()) patch.company = op.company.trim().slice(0, 120);
      if (op.role !== undefined) patch.role = String(op.role).slice(0, 160);
      if (op.kind && KINDS.includes(op.kind)) patch.kind = op.kind;
      if (op.status && STATUSES.includes(op.status)) patch.status = op.status;
      if (op.deadline !== undefined) patch.deadline = String(op.deadline).slice(0, 120);
      if (op.notes !== undefined) patch.notes = String(op.notes).slice(0, 400);
      if (Object.keys(patch).length) { await updateTrackerItem(row.id, patch); edited++; }
    }
    await logEvent(userId, "tracker_prompt_apply", { edited, added, deleted });
    return NextResponse.json({ ok: true, edited, added, deleted });
  }

  // ── phase one: work out what they mean, change nothing ────────────────
  const instruction = String(body.instruction ?? "").trim();
  if (instruction.length < 4) return NextResponse.json({ ok: false, error: "Tell it what to fix." }, { status: 400 });

  const gate = await guardExpensive("prompt", callerIp(req));
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 429 });

  const { key } = await getActiveKey();
  if (!key) return NextResponse.json({ ok: false, error: "Connect an API key first, the bar at the top of the page takes one." }, { status: 400 });

  const listing = rows.map((r, i) =>
    `${i + 1}. company: ${r.company} | role: ${r.role ?? ""} | kind: ${r.kind} | status: ${r.status}` +
    `${r.deadline ? ` | deadline: ${r.deadline}` : ""}${r.notes ? ` | notes: ${r.notes.slice(0, 80)}` : ""}`,
  ).join("\n");

  try {
    const { content, costUsd } = await haiku<{ ops: Op[]; unclear?: string }>({
      key, purpose: `tracker prompt over ${rows.length} rows`,
      system: SYSTEM,
      user: `THE ROWS\n${listing || "(the tracker is empty)"}\n\nTHE REQUEST\n${instruction.slice(0, 2000)}`,
      schema: SCHEMA as never, maxTokens: 3000, temperature: 0,
    });
    // Everything the person will be shown, resolved to real row identities.
    const ops = (content.ops ?? []).map((op) => ({
      ...op,
      current: op.n && rows[op.n - 1]
        ? { company: rows[op.n - 1].company, role: rows[op.n - 1].role, kind: rows[op.n - 1].kind, status: rows[op.n - 1].status }
        : null,
    })).filter((op) => op.action === "add" || op.current);
    await logEvent(userId, "tracker_prompt_plan", { rows: rows.length, ops: ops.length });
    return NextResponse.json({ ok: true, ops, unclear: content.unclear ?? "", costUsd });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "That did not go through." }, { status: 502 });
  }
}
