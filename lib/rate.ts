import { countRecent, recordHit, spendSince } from "@/lib/db";

/**
 * The money guard.
 *
 * Reading a posting against the whole catalog costs about ten cents of model
 * time, and the route that does it has to stay open: a judge should be able to
 * try the product without an account. Open and expensive is a combination that
 * a loop, a scraper or one bored person can turn into an empty balance, and an
 * empty balance during judging means every judge after them sees a dead
 * product. So: a per-visitor ceiling that no honest visitor will reach, and a
 * daily total that stops the bleeding whatever the source.
 *
 * Both refusals are friendly and specific. Nobody gets a 500 for being curious.
 */

/** A visitor may start this many expensive reads per hour. */
const PER_IP_PER_HOUR = 8;
/** Whole-deployment ceiling on model spend per rolling day, in dollars. */
const DAILY_USD = Number(process.env.DAILY_SPEND_CAP_USD ?? 20);

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function callerIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function guardExpensive(kind: string, ip: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const spent = await spendSince(Date.now() - DAY);
    if (spent >= DAILY_USD) {
      return {
        ok: false,
        error: "Carpa has hit its daily model budget, which is a cap the owner sets so a runaway loop cannot empty it. It resets within the day. Everything already planned or tracked is still here.",
      };
    }
    const hits = await countRecent(`${kind}:${ip}`, Date.now() - HOUR);
    if (hits >= PER_IP_PER_HOUR) {
      return {
        ok: false,
        error: `That is ${PER_IP_PER_HOUR} full catalog reads in an hour from this connection, which is the limit. Each one reads all 139 courses against your posting, so it costs real model time. Try again in a little while.`,
      };
    }
    await recordHit(`${kind}:${ip}`);
    return { ok: true };
  } catch {
    // A guard that cannot reach its bookkeeping must not become the outage.
    return { ok: true };
  }
}
