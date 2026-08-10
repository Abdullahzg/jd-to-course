import type { RawEmail } from "./types";

/**
 * Three ways into a mailbox, one output shape.
 *
 * Gmail OAuth is the door we want everyone through: the connect step is one
 * authorize tab, the same consent that signs them in. The app password path
 * exists for anyone whose Google Cloud consent screen is not set up yet,
 * which during a competition is most people. The demo inbox exists so the
 * feature can be seen working in thirty seconds by someone who will not
 * connect anything, and so the pipeline can be tested without a human's mail.
 */

const strip = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

// ── Gmail over REST, bearer token from the OAuth session ────────────────────
export async function fetchGmail(accessToken: string, opts: { backfill: boolean }): Promise<RawEmail[]> {
  // Application mail, not the whole life. The query trims the obvious
  // non-candidates server side; triage does the honest filtering after.
  const q = [
    opts.backfill ? "newer_than:365d" : "newer_than:14d",
    "-category:promotions",
    "-category:social",
  ].join(" ");
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const headers = { Authorization: `Bearer ${accessToken}` };

  const ids: string[] = [];
  let pageToken = "";
  while (ids.length < (opts.backfill ? 400 : 120)) {
    const url = `${base}/messages?q=${encodeURIComponent(q)}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url, { headers, cache: "no-store" });
    if (!r.ok) throw new Error(`Gmail said ${r.status}. ${r.status === 401 ? "Reconnect Google to renew access." : await r.text().then((t) => t.slice(0, 120))}`);
    const j = (await r.json()) as { messages?: { id: string }[]; nextPageToken?: string };
    for (const m of j.messages ?? []) ids.push(m.id);
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }

  const out: RawEmail[] = [];
  // Sequential-ish batches: Gmail rate limits bursts, and a backfill that 429s
  // half way is worse than one that takes forty seconds.
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = await Promise.all(ids.slice(i, i + 20).map(async (id) => {
      const r = await fetch(`${base}/messages/${id}?format=full`, { headers, cache: "no-store" });
      if (!r.ok) return null;
      const m = (await r.json()) as {
        id: string; internalDate?: string;
        payload?: { headers?: { name: string; value: string }[]; parts?: unknown[]; body?: { data?: string }; mimeType?: string };
      };
      const h = (name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? "";
      const body = extractGmailBody(m.payload);
      return {
        id: m.id,
        from: h("from"),
        subject: h("subject"),
        date: Number(m.internalDate ?? Date.now()),
        body: body.slice(0, 6000),
      } as RawEmail;
    }));
    out.push(...chunk.filter((x): x is RawEmail => Boolean(x)));
  }
  return out;
}

function extractGmailBody(payload?: { parts?: unknown[]; body?: { data?: string }; mimeType?: string }): string {
  if (!payload) return "";
  const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");
  type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
  const walk = (p: Part, want: string): string => {
    if (p.mimeType === want && p.body?.data) return decode(p.body.data);
    for (const c of p.parts ?? []) { const r = walk(c, want); if (r) return r; }
    return "";
  };
  const root = payload as Part;
  const plain = walk(root, "text/plain");
  if (plain) return plain.replace(/\s+/g, " ").trim();
  const html = walk(root, "text/html") || decode(payload.body?.data);
  return strip(html);
}

// ── IMAP with a Gmail app password ──────────────────────────────────────────
export async function fetchImap(email: string, appPassword: string, opts: { backfill: boolean }): Promise<RawEmail[]> {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    auth: { user: email, pass: appPassword },
    logger: false,
  });
  await client.connect();
  const out: RawEmail[] = [];
  try {
    await client.mailboxOpen("[Gmail]/All Mail").catch(() => client.mailboxOpen("INBOX"));
    const since = new Date(Date.now() - (opts.backfill ? 365 : 14) * 24 * 3600 * 1000);
    const uids = await client.search({ since }, { uid: true });
    const take = (uids || []).slice(-1 * (opts.backfill ? 400 : 120));
    for await (const msg of client.fetch(take, { uid: true, envelope: true, source: true })) {
      const parsed = await simpleParser(msg.source as Buffer);
      out.push({
        id: String(msg.uid),
        from: parsed.from?.text ?? "",
        subject: parsed.subject ?? "",
        date: parsed.date?.getTime() ?? Date.now(),
        body: (parsed.text ?? strip(String(parsed.html || ""))).replace(/\s+/g, " ").slice(0, 6000),
      });
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return out;
}

// ── the demo inbox ───────────────────────────────────────────────────────────
/**
 * Twenty two realistic emails covering the whole state machine: internships,
 * a new grad role, research, a scholarship, a hackathon, a campus program,
 * confirmations, an assessment with an expiry, interviews, an offer, three
 * rejections, and, deliberately, updates for applications that have no
 * confirmation email at all, because that is the "no row yet, create it"
 * mechanism under test.
 */
export function demoInbox(): RawEmail[] {
  const d = (daysAgo: number) => Date.now() - daysAgo * 24 * 3600 * 1000;
  let n = 0;
  const mk = (daysAgo: number, from: string, subject: string, body: string): RawEmail =>
    ({ id: `demo-${++n}`, from, subject, date: d(daysAgo), body });

  return [
    mk(94, "Stripe Recruiting <no-reply@stripe.com>", "Thank you for applying to Stripe",
      "Hi, Thank you for applying to the Software Engineering Intern position at Stripe. We have received your application and will review it shortly. The Stripe Recruiting Team"),
    mk(88, "Stripe Recruiting <no-reply@stripe.com>", "Next step: HackerRank assessment",
      "Hi, We would like to invite you to complete an online assessment for the Software Engineering Intern role. Please complete the HackerRank challenge at https://hackerrank.com/stripe-oa-2027. The link expires in 7 days. Good luck!"),
    mk(80, "Stripe Recruiting <no-reply@stripe.com>", "Interview scheduling: Stripe SWE Intern",
      "Congratulations, you passed the online assessment. We would like to schedule a virtual interview for the Software Engineering Intern position. Please pick a slot at https://stripe.com/schedule by Friday."),
    mk(90, "Workday <tiktok@myworkday.com>", "Your application was received",
      "Thank you for your interest in TikTok. Your application for Product Manager Intern, Content Ecosystem has been received. You can check your status in Workday at any time."),
    mk(41, "TikTok Talent <talent@tiktok.com>", "Update on your TikTok application",
      "Thank you for your patience. After careful review, we regret to inform you that we will not be moving forward with your application for Product Manager Intern, Content Ecosystem. We encourage you to apply to future openings."),
    mk(75, "Jane Street <recruiting@janestreet.com>", "Application confirmation",
      "Thanks for applying to the Quantitative Trading Intern role at Jane Street. We have received your application. Our team reviews applications on a rolling basis."),
    mk(52, "Jane Street <recruiting@janestreet.com>", "Jane Street: decision",
      "Thank you for taking the time to apply. Unfortunately, we have decided not to move forward with your candidacy for the Quantitative Trading Intern position this year."),
    // No confirmation was ever received for these two: the update must create the row.
    mk(33, "Greenhouse <no-reply@greenhouse.io>", "Figma Early Career: online assessment",
      "Hello, As the next step of your application to the Product Engineer, Early Career role at Figma, please complete a take home exercise at https://figma.com/exercise. Submit it within 5 days."),
    mk(12, "Anthropic Recruiting <recruiting@anthropic.com>", "Interview confirmed: Applied AI Intern",
      "Your interview for the Applied AI Intern position at Anthropic is confirmed for Tuesday at 2pm PT. You will meet two engineers for a technical discussion. A calendar invitation follows."),
    mk(70, "NSF REU Program <reu@cs.university.edu>", "REU application received",
      "Dear student, This confirms we received your application to the Summer Research Experience for Undergraduates in Machine Learning. Decisions are released in early March."),
    mk(29, "NSF REU Program <reu@cs.university.edu>", "REU decision: waitlist",
      "Thank you for applying to the Summer REU in Machine Learning. Competition was unusually strong this year and we have placed your application on our waitlist. We will contact you if a position opens."),
    mk(66, "Palantir <recruiting@palantir.com>", "Thanks for applying",
      "Thank you for applying to the Forward Deployed Software Engineer, New Grad position at Palantir. We have received your application and are reviewing it."),
    mk(9, "Palantir <recruiting@palantir.com>", "Palantir: offer letter",
      "Congratulations! We are delighted to extend you an offer for the Forward Deployed Software Engineer, New Grad position. Your offer letter and compensation details are attached. Please respond within two weeks."),
    mk(61, "HackMIT Team <team@hackmit.org>", "You applied to HackMIT",
      "Thanks for applying to HackMIT 2027! Admissions decisions go out in three waves starting late August. Keep an eye on this inbox."),
    mk(20, "HackMIT Team <team@hackmit.org>", "HackMIT decision inside",
      "We are excited to let you know you have been accepted to HackMIT 2027! RSVP at https://hackmit.org/rsvp by September 1 to confirm your spot."),
    mk(58, "Scholarship Office <awards@university.edu>", "Merit Scholarship application received",
      "This confirms your application for the Dean's Merit Scholarship has been received. Award decisions are announced at the end of the semester."),
    mk(6, "Scholarship Office <awards@university.edu>", "Dean's Merit Scholarship: decision",
      "Congratulations, you have been selected to receive the Dean's Merit Scholarship for the upcoming academic year. Details on disbursement follow in a separate message."),
    // Row-less rejection: nothing earlier mentions Databricks anywhere.
    mk(15, "Databricks Recruiting <no-reply@databricks.com>", "Your Databricks application",
      "Thank you for your interest in the Software Engineering Intern position at Databricks. After reviewing your application, we will not be proceeding to the next stage at this time."),
    mk(47, "Google STEP <step-program@google.com>", "STEP Intern application update",
      "Thank you for applying to the Student Training in Engineering Program (STEP) Intern role. Your application is under review. No action is needed from you at this time."),
    mk(3, "Google STEP <step-program@google.com>", "Action required: STEP availability form",
      "Please complete the availability form at https://goo.gle/step-form so we can match you with a host team. Submit it by next Wednesday."),
    mk(84, "MLT <applications@mlt.org>", "Career Prep application received",
      "Thank you for submitting your application to the MLT Career Prep program. Our admissions team will review it and reach out with next steps."),
    mk(2, "Notion Campus <campus@makenotion.com>", "Welcome to Notion Campus Leaders",
      "Congratulations, you have been accepted as a Notion Campus Leader for the coming year. Join the onboarding call on Monday to get started."),
  ];
}
