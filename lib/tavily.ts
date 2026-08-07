/**
 * Tavily, for finding people who have already walked the path.
 *
 * A plan tells a student which courses to take. It cannot tell them what that
 * degree felt like, which of those courses actually mattered once they were in
 * the job, or whether the whole route was a good idea. People who did it can.
 *
 * The rule here is the same one the rest of this product runs on: nothing is
 * shown that did not come back from a real source, and every row carries the
 * link it came from. A model is never asked to name a person. Inventing a
 * plausible graduate would be the single worst thing this feature could do,
 * because a student would email them.
 */

const BASE = "https://api.tavily.com";

export class TavilyError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export function tavilyKey(): string | null {
  return process.env.TAVILY_API_KEY?.trim() || null;
}

export interface TavilyUsage {
  used: number;
  limit: number | null;
  left: number | null;
}

/** What the account has spent. Tavily counts credits, not money. */
export async function tavilyUsage(key: string): Promise<TavilyUsage> {
  const res = await fetch(`${BASE}/usage`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new TavilyError(`Tavily refused the usage request (${res.status}).`, res.status);
  const j = (await res.json()) as {
    account?: { plan_usage?: number; plan_limit?: number | null };
  };
  const used = j.account?.plan_usage ?? 0;
  const limit = j.account?.plan_limit ?? null;
  return { used, limit, left: limit == null ? null : Math.max(0, limit - used) };
}

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export async function tavilySearch(args: {
  key: string;
  query: string;
  maxResults?: number;
  includeDomains?: string[];
}): Promise<TavilyResult[]> {
  const res = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: args.query,
      max_results: args.maxResults ?? 10,
      ...(args.includeDomains?.length ? { include_domains: args.includeDomains } : {}),
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new TavilyError(`Tavily refused that search (${res.status}).`, res.status);
  }
  const j = (await res.json()) as { results?: TavilyResult[] };
  return j.results ?? [];
}
