import "server-only";
import { GoogleGenAI } from "@google/genai";
import { getConfig } from "./config";
import type { EngineResult, Recommendation } from "./engine/engine";
import { reviewText } from "./issues";
import type { PlannerBrief } from "./types";

/**
 * The AI step. Gemini turns the engine's decisions into a short brief for the planner and
 * procurement. It never decides anything: quantities and actions come from the rules, and a
 * draft that mentions any number the engine did not produce is discarded for the template.
 */

const one = (n: number | null) => (n == null ? "n/a" : n.toFixed(1));
const int = (n: number) => n.toLocaleString("en-IN");
const byCover = (a: Recommendation, b: Recommendation) => (a.weeks_of_stock ?? 1e9) - (b.weeks_of_stock ?? 1e9);

export function briefFacts(r: EngineResult) {
  const recs = r.recommendations;
  const k = r.summary.operational_kpis;
  const c = r.config;
  const name = (x: Recommendation) => x.SKU_Name.replace(/^Freshroots\s+/i, "");
  const line = (x: Recommendation) => ({
    sku: x.SKU_ID, name: name(x), perishability: x.Perishability, weeks_of_stock: one(x.weeks_of_stock),
    units_on_hand: x.Units_On_Hand, recommended_qty: x.Recommended_Order_Qty,
    surge_pct_4w_vs_12w: x.demand_spurt_flag && x.demand_ratio != null ? Math.round((x.demand_ratio - 1) * 100) : null,
  });
  // SKUs whose decision would flip with a small change in sales: cover within 0.25 weeks of a
  // range limit, or demand ratio within 0.03 of the surge line.
  const near = recs.filter((x) => !x.Review_Required && x.weeks_of_stock != null).flatMap((x) => {
    const [lo, hi] = x.Perishability === "High" ? [c.high_perish_stockout_weeks, c.high_perish_overstock_weeks] : [c.low_perish_stockout_weeks, c.low_perish_overstock_weeks];
    const w = x.weeks_of_stock!;
    const why: string[] = [];
    if (Math.abs(w - lo) < 0.25) why.push(`${one(w)} weeks of stock vs the ${lo}-week minimum`);
    if (Math.abs(w - hi) < 0.25) why.push(`${one(w)} weeks of stock vs the ${hi}-week maximum`);
    if (x.demand_ratio != null && Math.abs(x.demand_ratio - c.surge_ratio_threshold) < 0.03) {
      why.push(`demand ratio ${x.demand_ratio.toFixed(2)} vs the ${c.surge_ratio_threshold.toFixed(2)} surge line`);
    }
    return why.length ? [{ x, why: why.join(" and ") }] : [];
  });
  return {
    evaluation_date: r.evaluation_date,
    sales_through_week: r.sales_cutoff_week,
    stock_snapshot: r.inventory_snapshot_dates.join(", "),
    festival_uplift_pct: recs[0]?.seasonal_uplift_pct ?? 0,
    bands_weeks: { low_perishability: [c.low_perish_stockout_weeks, c.low_perish_overstock_weeks], high_perishability: [c.high_perish_stockout_weeks, c.high_perish_overstock_weeks] },
    counts: {
      skus: k.total_skus_in_master, reorder: k.immediate_reorder_skus, pause: k.pause_order_skus, review: k.skus_requiring_manual_review,
      in_band: k.optimal_level_skus, surge: k.high_demand_spurt_skus, total_reorder_units: k.total_recommended_order_units,
    },
    reorder: recs.filter((x) => x.Action === "IMMEDIATE_REORDER").sort(byCover).map(line),
    pause: recs.filter((x) => x.Action === "PAUSE_ORDER").map(line),
    review: recs.filter((x) => x.Action === "MANUAL_REVIEW").map((x) => ({ sku: x.SKU_ID, name: name(x), reason: reviewText(x) })),
    near_threshold: near.map(({ x, why }) => ({ sku: x.SKU_ID, name: name(x), why, action: x.Action })),
    data_quality: { errors: r.summary.data_quality.errors, warnings: r.summary.data_quality.warnings, run_level: r.summary.data_quality.global_issues },
  };
}

export function templateBrief(r: EngineResult, fallbackReason: string | null = null): PlannerBrief {
  const f = briefFacts(r);
  const n = f.counts;
  const headline = n.reorder
    ? `${n.reorder} SKU${n.reorder > 1 ? "s" : ""} to reorder now (${int(n.total_reorder_units)} units)${n.pause ? `, ${n.pause} to pause` : ""}${n.review ? `, ${n.review} for planner review` : ""}.`
    : `No reorders needed${n.pause ? `; ${n.pause} SKU${n.pause > 1 ? "s" : ""} to pause` : ""}${n.review ? `; ${n.review} for planner review` : ""}.`;
  const bullets: string[] = [];
  if (f.reorder.length) bullets.push(`Reorder, lowest cover first: ${f.reorder.map((x) => `${x.name} ${x.weeks_of_stock} wks → ${int(x.recommended_qty)}`).join("; ")}.`);
  const surges = f.reorder.concat(f.pause).filter((x) => x.surge_pct_4w_vs_12w != null);
  if (surges.length) bullets.push(`Demand surge: ${surges.map((x) => `${x.name} +${x.surge_pct_4w_vs_12w}% (4-wk vs 12-wk)`).join("; ")}; reorder sized ×1.5.`);
  if (f.pause.length) bullets.push(`Pause: ${f.pause.map((x) => `${x.name} ${x.weeks_of_stock} wks`).join("; ")}.`);
  if (f.review.length) {
    const shown = f.review.slice(0, 4).map((x) => `${x.name} (${x.reason})`).join("; ");
    bullets.push(`For planner review: ${shown}${f.review.length > 4 ? `; and ${f.review.length - 4} more` : ""}.`);
  }
  bullets.push(f.festival_uplift_pct ? `Festival-month uplift of +${f.festival_uplift_pct}% is applied to demand.` : "No festival uplift this month.");
  if (!f.data_quality.errors && !f.data_quality.warnings) bullets.push("The SAP export passed every data check.");
  const watch = f.near_threshold.map((x) => `${x.name}: ${x.why}.`);
  return { headline, bullets: bullets.slice(0, 6), watch, source: "template", model: null, fallback_reason: fallbackReason };
}

const NUM_RE = /(?<![A-Za-z\d])\d[\d,]*(?:\.\d+)?/g;
const numbersIn = (text: string) => new Set((text.match(NUM_RE) ?? []).map((s) => String(Number(s.replace(/,/g, "")))));

/** Every number in the draft must already be in the facts (or the template built from them). */
export function unsupportedNumbers(draft: PlannerBrief, allowedText: string): string[] {
  const allowed = numbersIn(allowedText);
  const used = numbersIn([draft.headline, ...draft.bullets, ...draft.watch].join(" "));
  return [...used].filter((x) => !allowed.has(x));
}

const SYSTEM = `You write the twice-weekly reorder brief for Freshroots' demand planner (Raghav) and the procurement approver.
They read it in 20 seconds before approving orders. Write like a sharp colleague: specific, plain, no filler.

Hard rules:
- Use only the JSON facts. Never invent SKUs, quantities, causes, regions or forecasts.
- Every number you write must already appear in the facts. Do not add, subtract or compute anything new. Write 1,820 not 1820.
- Never suggest a quantity other than recommended_qty, and never suggest skipping approval.
- Use product names (without SKU codes). No markdown, no emojis, no exclamation marks.

Shape:
- headline: one sentence, at most 18 words, giving the counts of reorders (with total_reorder_units), pauses and reviews that are non-zero.
- bullets: 3 to 5 items, most urgent first, each at most 28 words:
  1. Most urgent reorders: perishables and lowest weeks_of_stock first, as "name (weeks_of_stock wks): recommended_qty".
  2. If any surge_pct_4w_vs_12w is set: "name: demand up +N% (4-week vs 12-week average), so the order is 1.5x standard."
  3. Pauses, with weeks_of_stock.
  4. Planner reviews with their reason, if any.
  5. Data quality or festival uplift, only if notable.
- watch: one item per near_threshold entry, written as "name: why" using the why text as given. Empty if none.`;

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    bullets: { type: "array", items: { type: "string" } },
    watch: { type: "array", items: { type: "string" } },
  },
  required: ["headline", "bullets", "watch"],
};

let client: GoogleGenAI | null = null;

export async function generateBrief(r: EngineResult): Promise<PlannerBrief> {
  const cfg = getConfig();
  if (cfg.ai !== "gemini") return templateBrief(r);
  const facts = briefFacts(r);
  const template = templateBrief(r);
  const allowed = JSON.stringify(facts) + " " + [template.headline, ...template.bullets, ...template.watch].join(" ");
  try {
    client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const call = client.interactions.create({
      model: cfg.geminiModel,
      system_instruction: SYSTEM,
      input: JSON.stringify(facts),
      response_format: { type: "text", mime_type: "application/json", schema: SCHEMA as Record<string, unknown> },
      generation_config: { thinking_level: "low" },
      store: false,
    });
    const res = await Promise.race([call, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Gemini timed out after 25s")), 25_000))]);
    const parsed = JSON.parse(res.output_text ?? "") as { headline?: unknown; bullets?: unknown; watch?: unknown };
    if (typeof parsed.headline !== "string" || !Array.isArray(parsed.bullets) || !Array.isArray(parsed.watch)) throw new Error("Gemini reply did not match the schema");
    const draft: PlannerBrief = {
      headline: parsed.headline.trim(),
      bullets: parsed.bullets.map(String).filter(Boolean).slice(0, 5),
      watch: parsed.watch.map(String).filter(Boolean).slice(0, 3),
      source: "gemini",
      model: cfg.geminiModel,
      fallback_reason: null,
    };
    const bad = unsupportedNumbers(draft, allowed);
    if (bad.length) return templateBrief(r, `Gemini draft used numbers not produced by the engine (${bad.join(", ")}); template used instead.`);
    return draft;
  } catch (e) {
    return templateBrief(r, `Gemini unavailable: ${(e as Error).message.slice(0, 160)}`);
  }
}
