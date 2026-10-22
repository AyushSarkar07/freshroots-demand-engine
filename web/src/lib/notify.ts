import "server-only";
import { getConfig } from "./config";
import type { RunRecord } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The approval queue message procurement receives when a run lands. */
export function runMessage(run: RunRecord): string {
  const k = run.result.summary.operational_kpis;
  const lines = [
    `<b>Freshroots reorder run</b> · evaluated ${run.evaluation_date} · sales to ${run.result.sales_cutoff_week}`,
    run.brief ? esc(run.brief.headline) : "",
    `${k.immediate_reorder_skus} to reorder (${k.total_recommended_order_units.toLocaleString("en-IN")} units) · ${k.pause_order_skus} to pause · ${k.skus_requiring_manual_review} for planner review`,
    "Nothing is ordered until someone approves it in the app.",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Sends to the procurement Telegram group when configured; otherwise records what would have been sent. */
export async function notifyRun(run: RunRecord): Promise<{ channel: string; live: boolean; error?: string; text: string }> {
  const cfg = getConfig();
  const text = runMessage(run);
  const url = `${cfg.appUrl}/?run=${run.id}`;
  if (cfg.telegram !== "live") return { channel: "telegram", live: false, text };
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(url.startsWith("https://") ? { reply_markup: { inline_keyboard: [[{ text: "Review and approve", url }]] } } : {}),
      }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    return json.ok ? { channel: "telegram", live: true, text } : { channel: "telegram", live: false, error: json.description, text };
  } catch (e) {
    return { channel: "telegram", live: false, error: (e as Error).message, text };
  }
}
