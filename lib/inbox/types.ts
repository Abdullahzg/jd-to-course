/** One email, reduced to what the classifier needs. */
export type RawEmail = {
  id: string;
  from: string;
  subject: string;
  /** epoch ms */
  date: number;
  /** plain text body, already stripped of markup */
  body: string;
  /** the original HTML when the email had one, kept so a row can show its receipt rendered */
  html?: string;
};

/** The header pass: enough to triage, nothing more fetched than that. */
export type EmailHeader = {
  id: string;
  from: string;
  subject: string;
  date: number;
};

/**
 * What one email says about one application. The vocabulary is deliberately
 * small: a status a student can act on, never a taxonomy to admire.
 */
export type AppSignal = {
  company: string;
  role: string;
  kind: "internship" | "job" | "research" | "grad school" | "scholarship" | "hackathon" | "program" | "other";
  status: "applied" | "assessment" | "interview" | "offer" | "accepted" | "rejected" | "waitlisted" | "action needed" | "update";
  /** verbatim sentence from the email that proves the status */
  quote: string;
  emailId: string;
  actionLink?: string;
  deadline?: string;
};
