import "server-only";
import type { Alert } from "./compare";
import { getConfig } from "./config";
import type { RunRecord } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The message procurement receives when a run lands, with any early warnings first. */
export function runMessage(run: RunRecord, alerts: Alert[] = []): { html: string; text: string } {
  const k = run.result.summary.operational_kpis;
  const high = alerts.filter((a) => a.severity === "high");
  const head = `Freshroots reorder run · evaluated ${run.evaluation_date} · sales to ${run.result.sales_cutoff_week}`;
  const counts = `${k.immediate_reorder_skus} to reorder (${k.total_recommended_order_units.toLocaleString("en-IN")} units) · ${k.pause_order_skus} to pause · ${k.skus_requiring_manual_review} for planner review`;
  const warn = alerts.length ? `${alerts.length} early warning${alerts.length > 1 ? "s" : ""}${high.length ? ` (${high.length} high)` : ""}:\n${alerts.slice(0, 5).map((a) => `• ${a.name}: ${a.detail}`).join("\n")}` : "";
  const tail = "Nothing is ordered until someone approves it in the app.";
  const text = [head, run.brief?.headline ?? "", counts, warn, tail].filter(Boolean).join("\n");
  const html = [`<b>${esc(head)}</b>`, run.brief ? esc(run.brief.headline) : "", esc(counts), warn ? `<b>⚠ ${esc(warn)}</b>` : "", esc(tail)].filter(Boolean).join("\n");
  return { html, text };
}

export interface Delivery { channel: string; live: boolean; error?: string }

/**
 * Sends to every configured channel (Telegram group, Slack incoming webhook). Channels
 * without keys are recorded as simulated, never reported as sent.
 */
export async function notifyRun(run: RunRecord, alerts: Alert[] = []): Promise<{ deliveries: Delivery[]; text: string }> {
  const cfg = getConfig();
  const { html, text } = runMessage(run, alerts);
  const url = `${cfg.appUrl}/?run=${run.id}`;
  const deliveries: Delivery[] = [];

  if (cfg.telegram === "live") {
    try {
      const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true },
          ...(url.startsWith("https://") ? { reply_markup: { inline_keyboard: [[{ text: "Review and approve", url }]] } } : {}),
        }),
      });
      const json = (await res.json()) as { ok: boolean; description?: string };
      deliveries.push({ channel: "telegram", live: json.ok, error: json.ok ? undefined : json.description });
    } catch (e) {
      deliveries.push({ channel: "telegram", live: false, error: (e as Error).message });
    }
  } else deliveries.push({ channel: "telegram", live: false });

  if (cfg.slack === "live") {
    try {
      const res = await fetch(process.env.SLACK_WEBHOOK_URL!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `${text}\n<${url}|Review and approve>` }) });
      deliveries.push({ channel: "slack", live: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` });
    } catch (e) {
      deliveries.push({ channel: "slack", live: false, error: (e as Error).message });
    }
  } else deliveries.push({ channel: "slack", live: false });

  return { deliveries, text };
}
