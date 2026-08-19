import type { EmailHeader, RawEmail } from "./types";

/**
 * Three ways into a mailbox, one output shape, and two passes everywhere.
 *
 * The old single pass downloaded full message sources for everything it
 * would later triage away, which is why it had to cap itself at 400 emails
 * and why the owner's inbox looked half read. Now the header pass lists the
 * ENTIRE window cheaply (envelopes only), triage decides what matters, and
 * the body pass downloads just those. Reading a whole year of a 38,000
 * message mailbox costs one envelope sweep plus bodies for the few hundred
 * that are actually about applications.
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

/** Everything the scan will consider in one pass, whatever the mailbox holds. */
const HARD_CAP = 60000;

// ── Gmail over REST, bearer token from the OAuth session ────────────────────
export async function fetchGmailHeaders(accessToken: string, opts: { sinceMs: number; cap?: number }): Promise<EmailHeader[]> {
  const q = [`after:${Math.floor(opts.sinceMs / 1000)}`, "-category:promotions", "-category:social"].join(" ");
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const headers = { Authorization: `Bearer ${accessToken}` };

  // List the whole window (newest first), then keep the OLDEST chunk. A
  // first scan must not skip history just because the newest page filled the
  // cap; later incremental scans fetch tiny windows anyway.
  const ids: string[] = [];
  const cap = opts.cap ?? HARD_CAP;
  let pageToken = "";
  for (;;) {
    const url = `${base}/messages?q=${encodeURIComponent(q)}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url, { headers, cache: "no-store" });
    if (!r.ok) throw new Error(`Gmail said ${r.status}. ${r.status === 401 ? "Reconnect Google to renew access." : await r.text().then((t) => t.slice(0, 120))}`);
    const j = (await r.json()) as { messages?: { id: string }[]; nextPageToken?: string };
    for (const m of j.messages ?? []) ids.push(m.id);
    pageToken = j.nextPageToken ?? "";
    if (!pageToken) break;
    if (ids.length > 200000) break; // safety valve, not a policy
  }
  const take = cap ? ids.slice(-cap) : ids;

  const out: EmailHeader[] = [];
  // metadata format: headers only, ~1KB per message instead of the full body.
  for (let i = 0; i < take.length; i += 25) {
    const chunk = await Promise.all(take.slice(i, i + 25).map(async (id) => {
      const r = await fetch(`${base}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers, cache: "no-store" });
      if (!r.ok) return null;
      const m = (await r.json()) as { id: string; internalDate?: string; payload?: { headers?: { name: string; value: string }[] } };
      const h = (name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? "";
      return { id: m.id, from: h("from"), subject: h("subject"), date: Number(m.internalDate ?? 0) } as EmailHeader;
    }));
    out.push(...chunk.filter((x): x is EmailHeader => Boolean(x)));
  }
  return out;
}

export async function fetchGmailBodies(accessToken: string, ids: string[], onChunk?: (done: number) => void): Promise<RawEmail[]> {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const headers = { Authorization: `Bearer ${accessToken}` };
  const out: RawEmail[] = [];
  for (let i = 0; i < ids.length; i += 15) {
    const chunk = await Promise.all(ids.slice(i, i + 15).map(async (id) => {
      const r = await fetch(`${base}/messages/${id}?format=full`, { headers, cache: "no-store" });
      if (!r.ok) return null;
      const m = (await r.json()) as {
        id: string; internalDate?: string;
        payload?: { headers?: { name: string; value: string }[]; parts?: unknown[]; body?: { data?: string }; mimeType?: string };
      };
      const h = (name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name)?.value ?? "";
      const { text, html } = extractGmailBody(m.payload);
      return {
        id: m.id, from: h("from"), subject: h("subject"),
        date: Number(m.internalDate ?? Date.now()),
        body: text.slice(0, 6000),
        html: html ? html.slice(0, 150000) : undefined,
      } as RawEmail;
    }));
    out.push(...chunk.filter((x): x is RawEmail => Boolean(x)));
    onChunk?.(out.length);
  }
  return out;
}

function extractGmailBody(payload?: { parts?: unknown[]; body?: { data?: string }; mimeType?: string }): { text: string; html: string } {
  if (!payload) return { text: "", html: "" };
  const decode = (data?: string) => (data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");
  type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };
  const walk = (p: Part, want: string): string => {
    if (p.mimeType === want && p.body?.data) return decode(p.body.data);
    for (const c of p.parts ?? []) { const r = walk(c, want); if (r) return r; }
    return "";
  };
  const root = payload as Part;
  const plain = walk(root, "text/plain");
  const html = walk(root, "text/html") || (payload.mimeType === "text/html" ? decode(payload.body?.data) : "");
  const text = plain ? plain.replace(/\s+/g, " ").trim() : strip(html || decode(payload.body?.data));
  return { text, html };
}

// ── IMAP with a Gmail app password ──────────────────────────────────────────
async function imapClient(email: string, appPassword: string) {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: "imap.gmail.com", port: 993, secure: true,
    // Google displays app passwords in groups of four with spaces, and every
    // second person pastes them that way. The spaces are cosmetic.
    auth: { user: email.trim(), pass: appPassword.replace(/\s+/g, "") },
    logger: false,
  });
  try {
    await client.connect();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/auth|credential|invalid|application-specific/i.test(msg)) {
      throw new Error("Gmail rejected the sign in. Check the address, and that the app password is the 16 character one from Google's App passwords page, not the account password. Spaces do not matter.");
    }
    throw new Error("Could not reach Gmail's mail server. Check the connection and try again.");
  }
  // Open All Mail by its special-use flag, not by its English name: a mailbox
  // in another display language calls the same folder something else, and the
  // silent INBOX fallback once turned that into "Read 0 emails".
  const boxes = await client.list();
  const allMail = boxes.find((b) => b.specialUse === "\\All")?.path ?? "INBOX";
  await client.mailboxOpen(allMail).catch(() => client.mailboxOpen("INBOX"));
  return client;
}

export async function fetchImapHeaders(email: string, appPassword: string, opts: { sinceMs: number; cap?: number }): Promise<EmailHeader[]> {
  const client = await imapClient(email, appPassword);
  const out: EmailHeader[] = [];
  try {
    // IMAP SINCE is day granular; the caller overlaps by two days and dedupes
    // by message id, so the coarseness cannot lose or double-count anything.
    const uids = await client.search({ since: new Date(opts.sinceMs) }, { uid: true });
    if (uids === false) throw new Error("Gmail accepted the sign in but refused the mailbox search. Try again in a minute.");
    // UIDs come back oldest first; take the OLDEST chunk so a first scan
    // chews history from the beginning and a later scan picks up where the
    // state cursor left off.
    const take = (uids || []).slice(0, opts.cap ?? HARD_CAP);
    for await (const msg of client.fetch(take, { uid: true, envelope: true }, { uid: true })) {
      const env = msg.envelope;
      const from = env?.from?.[0] ? `${env.from[0].name ?? ""} <${env.from[0].address ?? ""}>`.trim() : "";
      out.push({
        id: String(msg.uid),
        from,
        subject: env?.subject ?? "",
        date: env?.date?.getTime() ?? 0,
      });
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return out;
}

export async function fetchImapBodies(email: string, appPassword: string, ids: string[], onChunk?: (done: number) => void): Promise<RawEmail[]> {
  if (!ids.length) return [];
  const { simpleParser } = await import("mailparser");
  const client = await imapClient(email, appPassword);
  const out: RawEmail[] = [];
  try {
    const uids = ids.map(Number).filter((n) => Number.isFinite(n));
    for (let i = 0; i < uids.length; i += 40) {
      const chunk = uids.slice(i, i + 40);
      for await (const msg of client.fetch(chunk, { uid: true, source: true }, { uid: true })) {
        const parsed = await simpleParser(msg.source as Buffer);
        const html = typeof parsed.html === "string" ? parsed.html : "";
        out.push({
          id: String(msg.uid),
          from: parsed.from?.text ?? "",
          subject: parsed.subject ?? "",
          date: parsed.date?.getTime() ?? Date.now(),
          body: (parsed.text ?? strip(html)).replace(/\s+/g, " ").slice(0, 6000),
          html: html ? html.slice(0, 150000) : undefined,
        });
      }
      onChunk?.(out.length);
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
