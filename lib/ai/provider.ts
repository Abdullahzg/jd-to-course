/**
 * Two providers, one Haiku.
 *
 * A key is either an OpenRouter key (`sk-or-…`) or an Anthropic Console key
 * (`sk-ant-…`), and everything downstream is written against this file rather
 * than against either vendor. Nothing in the product knows which one is live.
 *
 * They differ in three ways that matter, and each is handled here so no caller
 * has to care:
 *
 *   1. Auth. OpenRouter takes `Authorization: Bearer`; Anthropic takes
 *      `x-api-key` plus `anthropic-version`.
 *   2. Cost. OpenRouter prices each call and returns it. Anthropic returns only
 *      token counts, so the price is computed here from Haiku 4.5's published
 *      rates.
 *   3. Balance. OpenRouter publishes remaining limit per key. Anthropic has no
 *      public balance endpoint for a normal API key, so there is nothing
 *      truthful to show as "left" and the bar says so instead of guessing.
 */

export type Provider = "openrouter" | "anthropic";

/** Haiku 4.5, per million tokens. Used only for the Anthropic path. */
export const HAIKU_PRICING = { inputPerMTok: 1.0, outputPerMTok: 5.0 };

/** The model id differs per provider even though it is the same model. */
export const HAIKU_MODEL: Record<Provider, string> = {
  openrouter: "anthropic/claude-haiku-4.5",
  anthropic: "claude-haiku-4-5",
};

export function detectProvider(key: string): Provider | null {
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("sk-or-")) return "openrouter";
  return null;
}

export function providerLabel(p: Provider): string {
  return p === "anthropic" ? "Anthropic" : "OpenRouter";
}

/** What a call cost, when the provider makes us work it out ourselves. */
export function priceFromTokens(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * HAIKU_PRICING.inputPerMTok +
    (outputTokens / 1_000_000) * HAIKU_PRICING.outputPerMTok
  );
}
