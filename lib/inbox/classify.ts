import { haiku } from "@/lib/ai/haiku";
import type { RawEmail, AppSignal } from "./types";

/**
 * Inbox to application signals, with the same discipline as the course
 * matcher: nothing is asserted without a verbatim quote, and the quote is
 * checked against the email it claims to come from. An email that cannot
 * prove its status update does not get to make one.
 *
 * Two stages for the same reason the course pipeline has two: triage is an
 * easy high volume judgement (is this email about something the person
 * applied to at all), extraction is a careful low volume one.
 */

const TRIAGE_SYSTEM = `You are sorting a student's inbox. For each email, decide from the sender and subject alone: is this plausibly about something the OWNER applied to? Applications include internships, jobs, research positions, graduate programs, scholarships, hackathons, clubs, campus programs, volunteer positions.

Keep: confirmations ("thank you for applying"), assessments and online tests,
interview scheduling, offers, rejections, waitlists, status updates, and
recruiter replies about a specific application.

Drop: newsletters, marketing, job ALERTS and digests (postings they did not
apply to), course announcements, receipts, social notifications, spam.

The subject "Your application to X" is a keep. "10 new jobs matching your
profile" is a drop. When genuinely unsure, keep: the next pass reads bodies
and can still say no.`;

const TRIAGE_SCHEMA = {
  name: "triage",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { keep: { type: "array", items: { type: "integer" } } },
    required: ["keep"],
  },
} as const;

const EXTRACT_SYSTEM = `You read emails about a student's applications and return what each one establishes, with proof.

For each email that carries a real signal, return:
- company: the organisation, as a person would name it ("Stripe", not
  "stripe-no-reply@"). For a scholarship or program, the awarding body.
- role: the specific position or program name if stated, otherwise "".
- kind: internship | job | research | grad school | scholarship | hackathon |
  program | other. "job" covers new grad and full time. "program" covers
  campus and fellowship programs. Guess sensibly from context; a student
  audience means ambiguous engineering roles are usually internships in
  autumn.
- status:
    applied        confirmation that an application was received
    assessment     an online assessment, coding test, or take home was sent
    interview      an interview is offered, scheduled, or completed
    offer          an offer was extended
    accepted       the student accepted, enrolled, or was onboarded
    rejected       a clear no
    waitlisted     explicitly waitlisted or deferred
    action needed  the email asks the student to do something with a deadline
    update         a real status change that fits none of the above
- quote: ONE sentence copied VERBATIM from the email body that proves the
  status. It will be checked by machine against the body; a paraphrase kills
  the signal.
- actionLink: the main URL the email asks them to open, when there is one.
- deadline: a date or duration stated for any action ("within 5 days",
  "by January 12"), verbatim, else omit.

Worked examples:
  Body: "Thank you for applying to the Software Engineering Internship at
  Stripe. We have received your application."
  -> company Stripe, role Software Engineering Internship, kind internship,
     status applied, quote "We have received your application."

  Body: "Unfortunately, we have decided to move forward with other candidates
  for the Data Analyst position."
  -> status rejected, quote the whole sentence. The word "unfortunately" is
     not proof by itself; the decision sentence is.

  Body: "You are invited to complete a HackerRank assessment. The link below
  expires in 7 days."
  -> status assessment, deadline "expires in 7 days", quote the invitation
     sentence, actionLink the HackerRank URL.

  Body: "Your OPT workshop registration is confirmed" from an international
  office -> NOT an application signal. Skip it entirely.

One email can be skipped; skipping needs no entry at all. Never invent a
company. Plain words, and never an em dash or en dash in any field.`;

const EXTRACT_SCHEMA = {
  name: "signals",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      signals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            n: { type: "integer" },
            company: { type: "string" },
            role: { type: "string" },
            kind: { type: "string", enum: ["internship", "job", "research", "grad school", "scholarship", "hackathon", "program", "other"] },
            status: { type: "string", enum: ["applied", "assessment", "interview", "offer", "accepted", "rejected", "waitlisted", "action needed", "update"] },
            quote: { type: "string" },
            actionLink: { type: "string" },
            deadline: { type: "string" },
          },
          required: ["n", "company", "role", "kind", "status", "quote"],
        },
      },
    },
    required: ["signals"],
  },
} as const;

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** The quote must actually be in the email, same rule as catalog quotes. */
const quoted = (body: string, q: string) => q.length >= 8 && flat(body).includes(flat(q).slice(0, 120));

export async function classifyEmails(
  key: string,
  emails: RawEmail[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ signals: AppSignal[]; costUsd: number; triaged: number; dropped: number }> {
  let costUsd = 0;
  let dropped = 0;

  // ── stage 1: headers only, 60 at a time ─────────────────────────────
  const keep = new Set<string>();
  for (let i = 0; i < emails.length; i += 60) {
    const batch = emails.slice(i, i + 60);
    const listing = batch.map((e, n) => `${n + 1}. FROM: ${e.from.slice(0, 60)} | SUBJECT: ${e.subject.slice(0, 110)}`).join("\n");
    try {
      const { content, costUsd: c } = await haiku<{ keep: number[] }>({
        key, purpose: `triage ${batch.length} emails`,
        system: TRIAGE_SYSTEM, user: listing,
        schema: TRIAGE_SCHEMA as never, maxTokens: 500, temperature: 0,
      });
      costUsd += c;
      for (const n of content.keep ?? []) if (batch[n - 1]) keep.add(batch[n - 1].id);
    } catch {
      // A failed triage keeps its whole batch: over-reading costs cents,
      // silently skipping a rejection costs trust.
      for (const e of batch) keep.add(e.id);
    }
    onProgress?.(Math.min(i + 60, emails.length), emails.length);
  }

  const relevant = emails.filter((e) => keep.has(e.id));

  // ── stage 2: full bodies, 8 at a time ────────────────────────────────
  const signals: AppSignal[] = [];
  for (let i = 0; i < relevant.length; i += 8) {
    const batch = relevant.slice(i, i + 8);
    const listing = batch.map((e, n) =>
      `### EMAIL ${n + 1}\nFROM: ${e.from}\nSUBJECT: ${e.subject}\nDATE: ${new Date(e.date).toISOString().slice(0, 10)}\nBODY:\n${e.body.slice(0, 2400)}`,
    ).join("\n\n");
    try {
      const { content, costUsd: c } = await haiku<{ signals: (Omit<AppSignal, "emailId"> & { n: number })[] }>({
        key, purpose: `extract signals from ${batch.length} emails`,
        system: EXTRACT_SYSTEM, user: listing,
        schema: EXTRACT_SCHEMA as never, maxTokens: 1600, temperature: 0,
      });
      costUsd += c;
      for (const s of content.signals ?? []) {
        const e = batch[s.n - 1];
        if (!e || !s.company?.trim()) continue;
        if (!quoted(e.body, s.quote)) { dropped++; continue; }
        signals.push({
          company: s.company.trim().slice(0, 80),
          role: (s.role ?? "").trim().slice(0, 120),
          kind: s.kind,
          status: s.status,
          quote: s.quote.trim().slice(0, 300),
          actionLink: s.actionLink?.startsWith("http") ? s.actionLink.slice(0, 500) : undefined,
          deadline: s.deadline?.slice(0, 80),
          emailId: e.id,
        });
      }
    } catch { /* a lost batch surfaces as fewer rows, never as wrong rows */ }
    onProgress?.(emails.length, emails.length);
  }

  return { signals, costUsd, triaged: relevant.length, dropped };
}
