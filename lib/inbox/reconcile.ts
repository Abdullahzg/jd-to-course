import { listTracker, insertTrackerItem, updateTrackerItem, addTrackerEvent } from "@/lib/db";
import type { AppSignal, RawEmail } from "./types";

/**
 * Signals into rows.
 *
 * The rule the user set, verbatim: if an update arrives for something with no
 * row, the row is created. A rejection from a company you never logged is
 * still a rejection; the tracker's job is to reflect the inbox, not to punish
 * the student for skipping data entry on the way in.
 */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Do two role strings plausibly name the same position. */
function sameRole(a: string | null, b: string) {
  const x = norm(a ?? ""), y = norm(b);
  if (!x || !y) return true; // an update without a role attaches to the company's row
  if (x === y) return true;
  const xs = new Set(x.split(" ")), ys = y.split(" ");
  const hit = ys.filter((w) => w.length > 3 && xs.has(w)).length;
  return hit >= Math.min(2, ys.filter((w) => w.length > 3).length);
}

/**
 * Later news wins; an earlier email arriving late must not un-reject anyone.
 * "applied" never overwrites a further-along status regardless of date order,
 * because confirmation emails routinely arrive after the assessment invite.
 */
const DEPTH: Record<string, number> = {
  applied: 1, update: 2, "action needed": 3, assessment: 4, waitlisted: 4,
  interview: 5, offer: 6, rejected: 6, accepted: 7,
};

export function reconcile(
  userId: string,
  signals: AppSignal[],
  emailsById: Map<string, RawEmail>,
): { created: number; updated: number; unchanged: number } {
  const rows = listTracker(userId);
  let created = 0, updated = 0, unchanged = 0;

  // Oldest first, so a backfill replays history in order and the final status
  // is the latest, with the whole journey kept as events.
  const ordered = [...signals].sort((a, b) =>
    (emailsById.get(a.emailId)?.date ?? 0) - (emailsById.get(b.emailId)?.date ?? 0));

  for (const s of ordered) {
    const email = emailsById.get(s.emailId);
    const when = email?.date ?? Date.now();
    const match = rows.find((r) => norm(r.company) === norm(s.company) && sameRole(r.role, s.role));

    if (!match) {
      const id = insertTrackerItem({
        userId,
        company: s.company,
        role: s.role || null,
        kind: s.kind,
        status: s.status,
        quote: s.quote,
        subject: email?.subject ?? null,
        emailDate: when,
        actionLink: s.actionLink ?? null,
        deadline: s.deadline ?? null,
      });
      rows.push({
        id, userId, company: s.company, role: s.role || null, kind: s.kind,
        status: s.status, quote: s.quote, subject: email?.subject ?? null,
        emailDate: when, actionLink: s.actionLink ?? null, deadline: s.deadline ?? null,
        notes: null, createdAt: when, updatedAt: when,
      });
      created++;
      continue;
    }

    const curDepth = DEPTH[match.status] ?? 0;
    const newDepth = DEPTH[s.status] ?? 0;
    const progresses = newDepth > curDepth || (newDepth === curDepth && (match.emailDate ?? 0) < when);
    if (progresses) {
      updateTrackerItem(match.id, {
        status: s.status, quote: s.quote, subject: email?.subject ?? null,
        emailDate: when,
        actionLink: s.actionLink ?? match.actionLink,
        deadline: s.deadline ?? match.deadline,
        role: match.role || s.role || null,
      });
      match.status = s.status; match.emailDate = when;
      updated++;
    } else {
      // Old news still belongs in the timeline, just not on the headline.
      addTrackerEvent(match.id, { status: s.status, quote: s.quote, subject: email?.subject, emailDate: when });
      unchanged++;
    }
  }

  return { created, updated, unchanged };
}
