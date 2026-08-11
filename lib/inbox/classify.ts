import { haiku } from "@/lib/ai/haiku";
import type { RawEmail, EmailHeader, AppSignal } from "./types";

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
Also drop the mail that dresses up as an application: agencies and startup
programs SOLICITING an application ("apply by September 1 to be considered",
"applications are now open for cohort 4"), services selling themselves with
an "offer" or "program", and recommendation emails ("we thought this job
could be a match for you"). An application the owner never made cannot have
a status.

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

  Body: "We have another program called the LaunchUp program, where we offer
  the same services" from a capital firm -> marketing. The word "offer" in a
  sales sentence is not a job offer. Skip it entirely.

  Body: "We thought this job for a React Native Intern could be a match for
  your background. Please submit a quick application if you have any
  interest." -> a job ALERT about an application that does not exist. Skip.

  Body: "Applications are now open for Cohort 4. Apply by September 1 to be
  considered." -> an invitation to apply, not a status of an application the
  owner made. Skip.

The rule under all of these: a signal exists only when the OWNER'S OWN
application, candidacy or enrollment moved. Mail asking, inviting or
tempting them to apply moves nothing.

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

/** Run thunks in waves of `width`, so ten thousand emails do not serialize. */
async function waves<T>(thunks: (() => Promise<T>)[], width: number): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < thunks.length; i += width) {
    out.push(...await Promise.all(thunks.slice(i, i + width).map((t) => t())));
  }
  return out;
}

/** Stage 1 over headers alone: which of these are plausibly about applications. */
export async function triageHeaders(
  key: string,
  headers: EmailHeader[],
  onProgress?: (done: number) => void,
): Promise<{ keep: Set<string>; costUsd: number }> {
  const keep = new Set<string>();
  let costUsd = 0;
  let done = 0;
  const batches: EmailHeader[][] = [];
  for (let i = 0; i < headers.length; i += 60) batches.push(headers.slice(i, i + 60));
  await waves(batches.map((batch) => async () => {
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
    done += batch.length;
    onProgress?.(done);
  }), 6);
  return { keep, costUsd };
}

/** Stage 2 over full bodies: what does each relevant email establish, with proof. */
export async function extractSignals(
  key: string,
  relevant: RawEmail[],
  onProgress?: (done: number) => void,
): Promise<{ signals: AppSignal[]; costUsd: number; dropped: number }> {
  const signals: AppSignal[] = [];
  let costUsd = 0;
  let dropped = 0;
  let done = 0;
  const batches: RawEmail[][] = [];
  for (let i = 0; i < relevant.length; i += 8) batches.push(relevant.slice(i, i + 8));
  await waves(batches.map((batch) => async () => {
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
      for (const sg of content.signals ?? []) {
        const e = batch[sg.n - 1];
        if (!e || !sg.company?.trim()) continue;
        if (!quoted(e.body, sg.quote)) { dropped++; continue; }
        signals.push({
          company: sg.company.trim().slice(0, 80),
          role: (sg.role ?? "").trim().slice(0, 120),
          kind: sg.kind,
          status: sg.status,
          quote: sg.quote.trim().slice(0, 300),
          actionLink: sg.actionLink?.startsWith("http") ? sg.actionLink.slice(0, 500) : undefined,
          deadline: sg.deadline?.slice(0, 80),
          emailId: e.id,
        });
      }
    } catch { /* a lost batch surfaces as fewer rows, never as wrong rows */ }
    done += batch.length;
    onProgress?.(done);
  }), 4);
  return { signals, costUsd, dropped };
}

/** The composed pair, for inboxes whose bodies are already in hand (the demo). */
export async function classifyEmails(
  key: string,
  emails: RawEmail[],
): Promise<{ signals: AppSignal[]; costUsd: number; triaged: number; dropped: number }> {
  const t = await triageHeaders(key, emails);
  const relevant = emails.filter((e) => t.keep.has(e.id));
  const x = await extractSignals(key, relevant);
  return { signals: x.signals, costUsd: t.costUsd + x.costUsd, triaged: relevant.length, dropped: x.dropped };
}


const REFUTE_SIGNALS_SYSTEM = `You are the skeptic in a student's application tracker. Each candidate row below was extracted from one email. Decide for each: did the OWNER'S OWN application, candidacy or enrollment produce this email, or did marketing?

DROP when the email is: a job alert or recommendation ("we thought this job", "your background could be a match", "please submit a quick application"), a firm or program SOLICITING applications ("apply by...", "applications are now open", "cohort", "limited slots"), a service selling itself (an "offer" in a sales sentence is not a job offer), a newsletter, an event promo, or admissions marketing from a program the owner merely browsed ("we invite you to learn more").

KEEP when the email is: a confirmation of something the owner submitted, an assessment, interview, offer, rejection or waitlist for their own candidacy, enrollment or onboarding steps for something they accepted, a reference-received notice for their application, a deadline notice for an application they demonstrably started.

The test is always: did the owner's own action start this thread. When the quote alone cannot settle it, the sender and subject usually can.`;

const REFUTE_SIGNALS_SCHEMA = {
  name: "verdicts",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { n: { type: "integer" }, keep: { type: "boolean" } },
          required: ["n", "keep"],
        },
      },
    },
    required: ["verdicts"],
  },
} as const;

/**
 * Stage 3: refute. Extraction with worked examples still lets the occasional
 * solicitation through, because marketing is written to pass exactly this
 * kind of reading. A second model call asked only "did the owner's own
 * action start this thread" is cheap, and it is the difference between a
 * tracker of applications and a tracker of ambition-themed spam.
 */
export async function refuteSignals(
  key: string,
  signals: AppSignal[],
  emailsById: Map<string, RawEmail>,
): Promise<{ kept: AppSignal[]; refuted: number; costUsd: number }> {
  if (!signals.length) return { kept: [], refuted: 0, costUsd: 0 };
  const kept: AppSignal[] = [];
  let costUsd = 0;
  const batches: AppSignal[][] = [];
  for (let i = 0; i < signals.length; i += 12) batches.push(signals.slice(i, i + 12));
  await waves(batches.map((batch) => async () => {
    const listing = batch.map((sg, n) => {
      const e = emailsById.get(sg.emailId);
      return `${n + 1}. company: ${sg.company} | role: ${sg.role || "(none)"} | claimed status: ${sg.status}\n   FROM: ${e?.from ?? "?"}\n   SUBJECT: ${e?.subject ?? "?"}\n   QUOTE: "${sg.quote}"`;
    }).join("\n");
    try {
      const { content, costUsd: c } = await haiku<{ verdicts: { n: number; keep: boolean }[] }>({
        key, purpose: `refute ${batch.length} signals`,
        system: REFUTE_SIGNALS_SYSTEM, user: listing,
        schema: REFUTE_SIGNALS_SCHEMA as never, maxTokens: 700, temperature: 0,
      });
      costUsd += c;
      const keepSet = new Set((content.verdicts ?? []).filter((v) => v.keep).map((v) => v.n));
      batch.forEach((sg, n) => { if (keepSet.has(n + 1)) kept.push(sg); });
    } catch {
      // The skeptic failing open keeps the batch: a lost refute pass must
      // not silently delete real rejections.
      kept.push(...batch);
    }
  }), 4);
  return { kept, refuted: signals.length - kept.length, costUsd };
}
