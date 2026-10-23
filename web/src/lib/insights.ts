/**
 * Presentation helpers. Every value here is read from the engine's output; nothing is
 * recalculated, so the UI cannot contradict the authoritative decision.
 */
import type { EngineConfig } from "./engine/config";
import type { EngineResult, Recommendation } from "./engine/engine";
import { parseIsoDate } from "./engine/dates";

export interface CoverRange {
  lo: number; // below this: reorder
  hi: number; // above this: overstock
}

export function coverRange(perishability: string, c: EngineConfig): CoverRange {
  return perishability === "High"
    ? { lo: c.high_perish_stockout_weeks, hi: c.high_perish_overstock_weeks }
    : { lo: c.low_perish_stockout_weeks, hi: c.low_perish_overstock_weeks };
}

export type CoverState = "below" | "within" | "above" | "unknown";

/** Mirrors the engine's band test (strictly below / strictly above; both bounds are in range). */
export function coverState(weeks: number | null, r: CoverRange): CoverState {
  if (weeks == null) return "unknown";
  const w = Math.round(weeks * 1e9) / 1e9;
  return w < r.lo ? "below" : w > r.hi ? "above" : "within";
}

/** Scale for the stock-cover instrument: room past the upper bound, and for the marker. */
export function gaugeScale(weeks: number | null, r: CoverRange) {
  const max = Math.max(r.hi * 1.5, (weeks ?? 0) * 1.08, r.hi + 1);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));
  return { max, pct, marker: weeks == null ? null : pct(weeks), lo: pct(r.lo), hi: pct(r.hi) };
}

export type Trend = "surge" | "rising" | "stable" | "falling" | "unavailable";

/**
 * 4-week vs 12-week demand. "surge" is the engine's rule (ratio > threshold). The other words
 * describe direction only (±5%) and never change a decision.
 */
export function demandTrend(rec: Pick<Recommendation, "demand_ratio" | "demand_spurt_flag">): Trend {
  if (rec.demand_ratio == null) return "unavailable";
  if (rec.demand_spurt_flag) return "surge";
  if (rec.demand_ratio >= 1.05) return "rising";
  if (rec.demand_ratio <= 0.95) return "falling";
  return "stable";
}
export const TREND_LABEL: Record<Trend, string> = {
  surge: "Surge", rising: "Rising", stable: "Stable", falling: "Falling", unavailable: "No comparison",
};

export interface Freshness {
  snapshot: string | null;
  snapshotAgeDays: number | null;
  salesWeek: string;
  stale: boolean;
  status: "ok" | "warn" | "crit";
  statusText: string;
}

/** How current the inputs were on the evaluation date, and whether the data checks passed. */
export function freshness(r: EngineResult): Freshness {
  const evalDay = parseIsoDate(r.evaluation_date);
  const snaps = r.inventory_snapshot_dates;
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  const latestDay = latest ? parseIsoDate(latest) : null;
  const age = evalDay != null && latestDay != null ? evalDay - latestDay : null;
  const dq = r.summary.data_quality;
  const stale = (age != null && age > r.config.stale_inventory_days) || dq.global_issues.some((g) => /out of date|before evaluation week/.test(g));
  const status = dq.skus_blocked ? "crit" : dq.warnings || stale ? "warn" : "ok";
  const statusText = dq.skus_blocked
    ? `${dq.skus_blocked} SKU${dq.skus_blocked > 1 ? "s" : ""} held by data checks`
    : dq.warnings ? `${dq.warnings} data warning${dq.warnings > 1 ? "s" : ""}` : stale ? "Inputs are stale" : "All data checks passed";
  return { snapshot: latest, snapshotAgeDays: age, salesWeek: r.sales_cutoff_week, stale, status, statusText };
}

/** SKUs grouped by what the engine decided: drives the hero orbit and bento counts. */
export function groups(recs: Recommendation[]) {
  const by = (a: string) => recs.filter((r) => r.Action === a);
  return { reorder: by("IMMEDIATE_REORDER"), pause: by("PAUSE_ORDER"), within: by("MAINTAIN"), review: by("MANUAL_REVIEW") };
}

export const shortName = (name: string) => name.replace(/^Freshroots\s+/i, "");
