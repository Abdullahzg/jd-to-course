import { NextResponse } from "next/server";
import {
  clearActiveKey, fetchKeyStatus, getActiveKey, keyFingerprint, maskKey, setActiveKey,
} from "@/lib/ai/keystore";
import { clearLedger } from "@/lib/ai/haiku";
import { aiLedger, aiTotal, clearAiLedger } from "@/lib/db";
import { detectProvider, providerLabel } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function snapshot() {
  const { key, source } = await getActiveKey();
  if (!key) {
    return {
      connected: false,
      source: "none" as const,
      message: "No API key yet. Add an OpenRouter or Anthropic key to run the AI steps.",
    };
  }
  const status = await fetchKeyStatus(key);
  const fp = keyFingerprint(key);
  const [spent, recentRows] = await Promise.all([aiTotal(fp), aiLedger(fp, 8)]);
  return {
    connected: status.valid,
    source,
    provider: status.provider,
    providerName: status.provider ? providerLabel(status.provider) : null,
    masked: maskKey(key),
    // Non-reversible, so the client can keep a durable running total per key
    // without ever holding the key itself.
    fingerprint: keyFingerprint(key),
    label: status.label,
    used: status.used,
    left: status.left,
    limit: status.limit,
    balanceUnavailable: status.balanceUnavailable,
    spentHere: spent.usd,
    callsHere: spent.calls,
    recent: recentRows.map((r) => ({ purpose: r.purpose ?? "", model: r.model ?? "", costUsd: r.costUsd, at: r.createdAt })),
    error: status.error,
  };
}

export async function GET() {
  return NextResponse.json(await snapshot());
}

/** Replace the key. Validated before it is stored, so a bad paste never lands. */
export async function POST(req: Request) {
  let key = "";
  try {
    ({ key } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Send a JSON body with a `key`." }, { status: 400 });
  }

  key = (key ?? "").trim();
  if (!key) {
    return NextResponse.json({ ok: false, error: "Paste a key first." }, { status: 400 });
  }
  if (!detectProvider(key)) {
    return NextResponse.json(
      {
        ok: false,
        error: "That doesn't look like a key. OpenRouter keys start with `sk-or-`, Anthropic keys with `sk-ant-`.",
      },
      { status: 400 },
    );
  }

  // Verify with the provider before storing. A key that can't answer for itself
  // can't run the product, and finding that out at solve time is worse than
  // finding it out here.
  const status = await fetchKeyStatus(key);
  if (!status.valid) {
    return NextResponse.json(
      { ok: false, error: status.error ?? "That key wasn't accepted." },
      { status: 400 },
    );
  }

  const previous = await getActiveKey();
  if (previous.key && previous.key !== key) clearLedger(previous.key);

  await setActiveKey(key);
  return NextResponse.json({ ok: true, ...(await snapshot()) });
}

/** Drop the pasted key and fall back to the deployment's own, if it has one. */
export async function DELETE() {
  const previous = await getActiveKey();
  if (previous.key && previous.source === "user") clearLedger(previous.key);
  await clearActiveKey();
  return NextResponse.json({ ok: true, ...(await snapshot()) });
}
