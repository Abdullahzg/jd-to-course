import { keyFingerprint } from "./keystore";
import {
  HAIKU_MODEL, type Provider, detectProvider, priceFromTokens,
} from "./provider";

// ─────────────────────────────────────────────────────────────────────────────
// Every model call in this product goes through here, and every one of them is
// Haiku 4.5. The key decides the provider; nothing above this file knows which.
// ─────────────────────────────────────────────────────────────────────────────

export type CallRecord = {
  purpose: string;
  provider: Provider;
  model: string;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  at: number;
};

/**
 * Running total per key. On globalThis rather than module scope because route
 * handlers do not share a module registry, and on Vercel each function is its
 * own instance. The durable figure is the cookie the budget route keeps; this
 * is the live read-out within one instance.
 */
const store = globalThis as unknown as {
  __slackLedgers?: Map<string, CallRecord[]>;
  __slackTotals?: Map<string, { usd: number; calls: number }>;
};
store.__slackLedgers ??= new Map<string, CallRecord[]>();
store.__slackTotals ??= new Map<string, { usd: number; calls: number }>();

const ledgers = store.__slackLedgers;
const totals = store.__slackTotals;

export function ledgerFor(key: string): CallRecord[] {
  return ledgers.get(keyFingerprint(key)) ?? [];
}

export function ledgerTotal(key: string): { usd: number; calls: number } {
  return totals.get(keyFingerprint(key)) ?? { usd: 0, calls: 0 };
}

export function clearLedger(key: string): void {
  const fp = keyFingerprint(key);
  ledgers.delete(fp);
  totals.delete(fp);
}

function record(key: string, rec: CallRecord): void {
  const fp = keyFingerprint(key);
  const list = ledgers.get(fp) ?? [];
  list.push(rec);
  if (list.length > 400) list.splice(0, list.length - 400);
  ledgers.set(fp, list);
  const t = totals.get(fp) ?? { usd: 0, calls: 0 };
  totals.set(fp, { usd: t.usd + rec.costUsd, calls: t.calls + 1 });
}

export class HaikuError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type ChatArgs = {
  key: string;
  purpose: string;
  system: string;
  user: string;
  /** JSON Schema. Present = the model must return matching JSON, nothing else. */
  schema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  temperature?: number;
};

export type ChatResult<T = string> = {
  content: T;
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  provider: Provider;
};

export async function haiku<T = string>(args: ChatArgs): Promise<ChatResult<T>> {
  const provider = detectProvider(args.key);
  if (!provider) {
    throw new HaikuError("That key is neither an OpenRouter nor an Anthropic key.");
  }

  const out = provider === "anthropic"
    ? await callAnthropic(args)
    : await callOpenRouter(args);

  record(args.key, {
    purpose: args.purpose,
    provider,
    model: out.model,
    costUsd: out.costUsd,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    at: Date.now(),
  });

  const content = args.schema ? (parseJson(out.text) as T) : (out.text as T);
  return {
    content,
    costUsd: out.costUsd,
    promptTokens: out.promptTokens,
    completionTokens: out.completionTokens,
    provider,
  };
}

// ─────────────────────────── Anthropic ──────────────────────────────────────

/**
 * Plain HTTPS against api.anthropic.com. No SDK: the Messages API is three
 * headers and a JSON body, the OpenRouter path next door is already raw fetch,
 * and one HTTP shape for both providers is less to keep straight than two
 * client libraries. A console key (`sk-ant-...`) is all it needs.
 */
async function callAnthropic(args: ChatArgs) {
  const body: Record<string, unknown> = {
    model: HAIKU_MODEL.anthropic,
    max_tokens: args.maxTokens ?? 900,
    temperature: args.temperature ?? 0,
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  };

  // Haiku 4.5 supports structured outputs, so the schema is enforced by the
  // API rather than asked for politely and hoped for.
  if (args.schema) {
    body.output_config = { format: { type: "json_schema", schema: args.schema.schema } };
  }

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": args.key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    throw new HaikuError(`Couldn't reach Anthropic: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) throw new HaikuError("Anthropic rejected the API key.", 401);
    if (res.status === 403) throw new HaikuError("This Anthropic key lacks access to Haiku 4.5.", 403);
    if (res.status === 429) throw new HaikuError("Anthropic is rate-limiting this key. Wait a moment.", 429);
    if (res.status === 400 && /credit|billing/i.test(text)) {
      throw new HaikuError("This Anthropic key has no credit left.", 400);
    }
    throw new HaikuError(`Anthropic returned ${res.status}. ${text.slice(0, 180)}`, res.status);
  }

  const json = await res.json();

  // A refusal comes back as a successful 200 with nothing usable in it, so it
  // has to be checked before reading the content blocks.
  if (json.stop_reason === "refusal") {
    throw new HaikuError("Claude declined this request.");
  }

  let text = "";
  for (const block of json.content ?? []) {
    if (block.type === "text") text += block.text;
  }

  const promptTokens = json.usage?.input_tokens ?? 0;
  const completionTokens = json.usage?.output_tokens ?? 0;

  return {
    text,
    model: json.model ?? HAIKU_MODEL.anthropic,
    // Anthropic reports tokens, not money, so the price comes from the rate card.
    costUsd: priceFromTokens(promptTokens, completionTokens),
    promptTokens,
    completionTokens,
  };
}

// ─────────────────────────── OpenRouter ─────────────────────────────────────

async function callOpenRouter(args: ChatArgs) {
  const body: Record<string, unknown> = {
    model: HAIKU_MODEL.openrouter,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    max_tokens: args.maxTokens ?? 900,
    temperature: args.temperature ?? 0,
    usage: { include: true },
    // One provider, first in line. OpenRouter load balances the same model
    // across Anthropic, Bedrock and Vertex, whose numerics differ, so two
    // identical temperature zero requests could come back meaningfully
    // different depending on who served them. Measured on the fixture suite
    // as a security run returning eleven matches and then six. Fallbacks stay
    // on, an outage should degrade to variance rather than to nothing.
    provider: { order: ["Anthropic"], allow_fallbacks: true },
  };

  if (args.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: args.schema.name, strict: true, schema: args.schema.schema },
    };
  }

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://course-path.vercel.app",
        // ASCII only. Header values are Latin-1, and a stray em dash here makes
        // fetch throw before it opens a socket, which looks exactly like a
        // network outage and is nothing of the kind.
        "X-Title": "Course Path",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    throw new HaikuError(`Couldn't reach OpenRouter: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) throw new HaikuError("OpenRouter rejected the API key.", 401);
    if (res.status === 402) throw new HaikuError("This OpenRouter key is out of credit.", 402);
    if (res.status === 429) throw new HaikuError("OpenRouter is rate-limiting this key. Wait a moment.", 429);
    throw new HaikuError(`OpenRouter returned ${res.status}. ${text.slice(0, 180)}`, res.status);
  }

  const json = await res.json();
  const usage = json.usage ?? {};
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;

  return {
    text: (json.choices?.[0]?.message?.content ?? "") as string,
    model: json.model ?? HAIKU_MODEL.openrouter,
    // OpenRouter prices the call for us, so use their number when it is there
    // and fall back to the rate card when it is not.
    costUsd: typeof usage.cost === "number" ? usage.cost : priceFromTokens(promptTokens, completionTokens),
    promptTokens,
    completionTokens,
  };
}

// ─────────────────────────── shared ─────────────────────────────────────────

function parseJson(raw: string): unknown {
  const t = raw.trim();
  const cleaned = t.startsWith("```")
    ? t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
    : t;
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new HaikuError("The model returned something that wasn't valid JSON.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming, for the one place a person is watching words arrive.
//
// Everything else in this app returns structured JSON that only becomes useful
// once it is complete, so streaming it would be pointless. The chat is the
// exception: it is prose, a person is reading it as it lands, and eight seconds
// of a blinking cursor feels much longer than eight seconds of text appearing.
//
// Both providers speak server-sent events; only the field names differ. Cost is
// reported at the end, when the usage totals arrive, so the money bar stays
// correct.
// ─────────────────────────────────────────────────────────────────────────────

export interface StreamArgs extends ChatArgs {
  onDelta: (text: string) => void;
}

export async function haikuStream(args: StreamArgs): Promise<{ text: string; costUsd: number }> {
  const provider = detectProvider(args.key);
  if (!provider) throw new HaikuError("That key is neither an OpenRouter nor an Anthropic key.");

  const anthropic = provider === "anthropic";
  const url = anthropic
    ? "https://api.anthropic.com/v1/messages"
    : "https://openrouter.ai/api/v1/chat/completions";

  const body: Record<string, unknown> = anthropic
    ? {
        model: HAIKU_MODEL.anthropic,
        max_tokens: args.maxTokens ?? 900,
        temperature: args.temperature ?? 0,
        system: args.system,
        messages: [{ role: "user", content: args.user }],
        stream: true,
      }
    : {
        model: HAIKU_MODEL.openrouter,
        max_tokens: args.maxTokens ?? 900,
        temperature: args.temperature ?? 0,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
        stream: true,
        usage: { include: true },
      };

  const headers: Record<string, string> = anthropic
    ? { "x-api-key": args.key, "anthropic-version": "2023-06-01", "content-type": "application/json" }
    : { Authorization: `Bearer ${args.key}`, "content-type": "application/json" };

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
  } catch (e) {
    throw new HaikuError(`Couldn't reach the model: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok || !res.body) {
    throw new HaikuError(`The model refused that request (${res.status}).`, res.status);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let inTok = 0;
  let outTok = 0;
  let reportedCost: number | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev: Record<string, never>;
      try { ev = JSON.parse(payload); } catch { continue; }
      const e = ev as Record<string, unknown>;

      if (anthropic) {
        if (e.type === "content_block_delta") {
          const d = e.delta as { text?: string } | undefined;
          if (d?.text) { text += d.text; args.onDelta(d.text); }
        } else if (e.type === "message_start") {
          const u = (e.message as { usage?: { input_tokens?: number } })?.usage;
          inTok = u?.input_tokens ?? 0;
        } else if (e.type === "message_delta") {
          outTok = (e.usage as { output_tokens?: number })?.output_tokens ?? outTok;
        }
      } else {
        const choice = (e.choices as { delta?: { content?: string } }[] | undefined)?.[0];
        if (choice?.delta?.content) { text += choice.delta.content; args.onDelta(choice.delta.content); }
        const usage = e.usage as { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
        if (usage) {
          inTok = usage.prompt_tokens ?? inTok;
          outTok = usage.completion_tokens ?? outTok;
          if (typeof usage.cost === "number") reportedCost = usage.cost;
        }
      }
    }
  }

  const costUsd = reportedCost ?? priceFromTokens(inTok, outTok);
  record(args.key, {
    purpose: args.purpose,
    provider,
    model: anthropic ? HAIKU_MODEL.anthropic : HAIKU_MODEL.openrouter,
    promptTokens: inTok,
    completionTokens: outTok,
    costUsd,
    at: Date.now(),
  });
  return { text, costUsd };
}
