import { cookies } from "next/headers";
import { createHash } from "crypto";
import { type Provider, detectProvider, providerLabel } from "./provider";

// ─────────────────────────────────────────────────────────────────────────────
// The active API key, from either provider.
//
// Held in an httpOnly cookie, not in module memory, so it survives across
// serverless instances on Vercel and stays per-browser. Replacing it is a
// single write: the new key goes in, the old one is gone, and because balance
// is read from whichever key is live, the bar recomputes on the swap with no
// extra bookkeeping.
//
// The key never reaches the client. The bar shows money, never the secret.
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE = "slack_or_key";

export type KeySource = "user" | "env" | "none";

export async function getActiveKey(): Promise<{ key: string | null; source: KeySource }> {
  const jar = await cookies();
  const fromCookie = jar.get(COOKIE)?.value;
  if (fromCookie) return { key: fromCookie, source: "user" };
  const fromEnv = process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (fromEnv) return { key: fromEnv, source: "env" };
  return { key: null, source: "none" };
}

export async function setActiveKey(key: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

/** Discard the user's key and fall back to whatever the deployment provides. */
export async function clearActiveKey(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Stable, non-reversible id for a key, so the ledger can be scoped per key. */
export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Never render a key. This is the only form allowed on screen. */
export function maskKey(key: string): string {
  if (key.length <= 12) return "••••";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export type KeyStatus = {
  valid: boolean;
  provider: Provider | null;
  label?: string;
  /** dollars spent against a limit, when the provider publishes one */
  used: number | null;
  /** dollars left before the limit, or null when the provider has no such idea */
  left: number | null;
  limit: number | null;
  /** true when the provider simply does not expose a balance for this key */
  balanceUnavailable: boolean;
  error?: string;
};

const UNKNOWN: KeyStatus = {
  valid: false, provider: null, used: null, left: null, limit: null,
  balanceUnavailable: true,
};

/**
 * Ask the provider what this key has spent and what it has left.
 *
 * OpenRouter publishes both. Anthropic publishes neither for an ordinary
 * console key, so there is nothing honest to print as "left" and the caller is
 * told so rather than shown a made-up number. The key is still verified, just
 * by asking whether it can see the model it is about to be billed for.
 */
export async function fetchKeyStatus(key: string): Promise<KeyStatus> {
  const provider = detectProvider(key);
  if (!provider) {
    return { ...UNKNOWN, error: "Keys start with `sk-or-` (OpenRouter) or `sk-ant-` (Anthropic)." };
  }
  return provider === "anthropic" ? anthropicStatus(key) : openRouterStatus(key);
}

async function anthropicStatus(key: string): Promise<KeyStatus> {
  try {
    // Cheapest possible proof the key works: ask whether it can see the model.
    const res = await fetch("https://api.anthropic.com/v1/models/claude-haiku-4-5", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ...UNKNOWN,
        provider: "anthropic",
        error: res.status === 401 ? "Anthropic rejected this key."
          : res.status === 403 ? "This key cannot use Haiku 4.5."
          : `Anthropic returned ${res.status}.`,
      };
    }
    return {
      valid: true,
      provider: "anthropic",
      label: providerLabel("anthropic"),
      // Anthropic has no public balance endpoint for a console key. Say so.
      used: null, left: null, limit: null,
      balanceUnavailable: true,
    };
  } catch {
    return { ...UNKNOWN, provider: "anthropic", error: "Couldn't reach Anthropic." };
  }
}

async function openRouterStatus(key: string): Promise<KeyStatus> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ...UNKNOWN,
        provider: "openrouter",
        error: res.status === 401 ? "OpenRouter rejected this key." : `OpenRouter returned ${res.status}.`,
      };
    }
    const { data } = await res.json();
    const limit: number | null = typeof data.limit === "number" ? data.limit : null;
    const left: number | null = typeof data.limit_remaining === "number" ? data.limit_remaining : null;
    return {
      valid: true,
      provider: "openrouter",
      label: data.label ?? providerLabel("openrouter"),
      used: limit != null && left != null ? limit - left : (data.usage ?? null),
      left,
      limit,
      balanceUnavailable: limit == null || left == null,
    };
  } catch {
    return { ...UNKNOWN, provider: "openrouter", error: "Couldn't reach OpenRouter." };
  }
}
