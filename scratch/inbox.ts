import { demoInbox } from "@/lib/inbox/drivers";
import { classifyEmails } from "@/lib/inbox/classify";
import { reconcile } from "@/lib/inbox/reconcile";
import { upsertUser, listTracker, trackerEvents } from "@/lib/db";

const key = process.env.OPENROUTER_API_KEY!;
(async () => {
  const emails = demoInbox();
  const { signals, costUsd, dropped } = await classifyEmails(key, emails);
  console.log("emails:", emails.length, "| signals:", signals.length, "| quote-rejected:", dropped, "| cost: $" + costUsd.toFixed(3));
  const uid = upsertUser({ email: "pipeline-test@local", name: "Pipeline Test" });
  const res = reconcile(uid, signals, new Map(emails.map((e) => [e.id, e])));
  console.log("reconcile:", JSON.stringify(res));
  const rows = listTracker(uid);
  console.log("rows:", rows.length);
  for (const r of rows) {
    console.log(`  ${r.company.padEnd(14)} ${String(r.role ?? "").slice(0, 34).padEnd(36)} ${r.kind.padEnd(11)} ${r.status.padEnd(13)} ev:${trackerEvents(r.id).length}`);
  }
  // the mechanisms under test
  const figma = rows.find((r) => r.company.toLowerCase().includes("figma"));
  const databricks = rows.find((r) => r.company.toLowerCase().includes("databricks"));
  const stripe = rows.find((r) => r.company.toLowerCase().includes("stripe"));
  console.log("row created from update with no prior row (Figma):", figma?.status);
  console.log("row created from rejection with no prior row (Databricks):", databricks?.status);
  console.log("Stripe journeyed applied->assessment->interview:", stripe?.status === "interview", "events:", stripe ? trackerEvents(stripe.id).map((e) => e.status).join(">") : "-");
})();
