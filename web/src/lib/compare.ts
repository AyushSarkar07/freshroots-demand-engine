/**
 * Run-to-run comparison: what changed for each SKU, what drifted in the data itself, and
 * which shifts are unusual enough to warn a person before they approve on autopilot.
 * Thresholds are deliberately simple so a planner can predict when an alert will fire.
 */
import type { Recommendation } from "./engine/engine";
import { shortName } from "./insights";
import type { RunRecord } from "./types";

export const SHIFT_RULES = {
  qtyJumpPct: 0.5, // recommended order moves by 50% or more between runs
  demandShiftPct: 0.3, // baseline weekly demand moves by 30% or more
} as const;

export type Severity = "high" | "medium";

export interface Alert {
  code: "QTY_JUMP" | "PAUSE_TO_REORDER" | "REORDER_TO_PAUSE" | "DEMAND_SHIFT" | "HISTORY_LOST" | "NEWLY_HELD" | "DISTRIBUTOR_CHANGED";
  severity: Severity;
  sku: string;
  name: string;
  detail: string;
}

export interface DriftItem {
  code: "NEW_SKU" | "REMOVED_SKU" | "NEW_DISTRIBUTOR" | "REMOVED_DISTRIBUTOR" | "SCHEMA_CHANGE" | "NEW_CATEGORY";
  detail: string;
  sku?: string;
}

export interface SkuDiff {
  sku: string;
  name: string;
  before: Recommendation | null;
  after: Recommendation | null;
  changed: string[];
}

const pct = (a: number, b: number) => (a === 0 ? (b === 0 ? 0 : Infinity) : (b - a) / a);
const fmtPct = (x: number) => (Number.isFinite(x) ? `${x > 0 ? "+" : ""}${Math.round(x * 100)}%` : "from zero");
const n = (x: number | null) => (x == null ? "—" : Math.round(x).toLocaleString("en-IN"));

function headerOf(csv: string | null | undefined): string[] {
  const first = (csv ?? "").replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  return first.split(",").map((c) => c.trim().replace(/^"|"$/g, "")).filter(Boolean);
}

export function compareRuns(base: RunRecord, next: RunRecord) {
  const b = new Map(base.result.recommendations.map((r) => [r.SKU_ID, r]));
  const a = new Map(next.result.recommendations.map((r) => [r.SKU_ID, r]));
  const ids = [...new Set([...b.keys(), ...a.keys()])].sort();

  const diffs: SkuDiff[] = ids.map((sku) => {
    const x = b.get(sku) ?? null;
    const y = a.get(sku) ?? null;
    const changed: string[] = [];
    if (x && y) {
      if (x.Action !== y.Action) changed.push("action");
      if (x.Recommended_Order_Qty !== y.Recommended_Order_Qty) changed.push("quantity");
      if (x.Distributor_ID !== y.Distributor_ID) changed.push("distributor");
      if (x.Data_Quality_Status !== y.Data_Quality_Status) changed.push("data quality");
      if ((x.weeks_of_stock ?? -1).toFixed(1) !== (y.weeks_of_stock ?? -1).toFixed(1)) changed.push("weeks of stock");
      if ((x.baseline_demand ?? -1).toFixed(1) !== (y.baseline_demand ?? -1).toFixed(1)) changed.push("demand");
      if (x.demand_spurt_flag !== y.demand_spurt_flag) changed.push("surge");
    } else changed.push(x ? "removed" : "added");
    return { sku, name: shortName((y ?? x)!.SKU_Name), before: x, after: y, changed };
  });

  const alerts: Alert[] = [];
  for (const d of diffs) {
    const x = d.before, y = d.after;
    if (!x || !y) continue;
    if (x.Action === "IMMEDIATE_REORDER" && y.Action === "IMMEDIATE_REORDER") {
      const p = pct(x.Recommended_Order_Qty, y.Recommended_Order_Qty);
      if (Math.abs(p) >= SHIFT_RULES.qtyJumpPct) {
        alerts.push({ code: "QTY_JUMP", severity: "high", sku: d.sku, name: d.name, detail: `Recommended order moved ${n(x.Recommended_Order_Qty)} → ${n(y.Recommended_Order_Qty)} units (${fmtPct(p)}). Check before approving.` });
      }
    }
    if (x.Action === "PAUSE_ORDER" && y.Action === "IMMEDIATE_REORDER") {
      alerts.push({ code: "PAUSE_TO_REORDER", severity: "high", sku: d.sku, name: d.name, detail: `Was overstocked last run, now below its reorder point (${n(x.weeks_of_stock)} → ${y.weeks_of_stock?.toFixed(1)} weeks). A swing this fast usually means a data problem or a real demand shock.` });
    }
    if (x.Action === "IMMEDIATE_REORDER" && y.Action === "PAUSE_ORDER") {
      alerts.push({ code: "REORDER_TO_PAUSE", severity: "medium", sku: d.sku, name: d.name, detail: `Went from reorder to overstocked in one run (${x.weeks_of_stock?.toFixed(1)} → ${y.weeks_of_stock?.toFixed(1)} weeks). Was last run's order received twice?` });
    }
    if (x.baseline_demand != null && y.baseline_demand != null) {
      const p = pct(x.baseline_demand, y.baseline_demand);
      if (Math.abs(p) >= SHIFT_RULES.demandShiftPct) {
        alerts.push({ code: "DEMAND_SHIFT", severity: "medium", sku: d.sku, name: d.name, detail: `Weekly demand baseline moved ${x.baseline_demand.toFixed(1)} → ${y.baseline_demand.toFixed(1)} (${fmtPct(p)}).` });
      }
    }
    if (x.weeks_observed_12w >= 12 && y.weeks_observed_12w < 12) {
      alerts.push({ code: "HISTORY_LOST", severity: "high", sku: d.sku, name: d.name, detail: `Had ${x.weeks_observed_12w} weeks of sales history; now ${y.weeks_observed_12w}. The SKU is treated as having no reliable history and held for the planner.` });
    } else if (!x.Review_Required && y.Review_Required) {
      alerts.push({ code: "NEWLY_HELD", severity: "medium", sku: d.sku, name: d.name, detail: `Now held for planner review: ${y.Review_Reasons}.` });
    }
    if (x.Distributor_ID !== y.Distributor_ID) {
      alerts.push({ code: "DISTRIBUTOR_CHANGED", severity: "medium", sku: d.sku, name: d.name, detail: `Distributor changed ${x.Distributor_ID} → ${y.Distributor_ID}. Purchase orders will go to a different supplier.` });
    }
  }

  const drift: DriftItem[] = [];
  for (const d of diffs) {
    if (!d.before) drift.push({ code: "NEW_SKU", sku: d.sku, detail: `${d.name} (${d.sku}) is new in this export.` });
    if (!d.after) drift.push({ code: "REMOVED_SKU", sku: d.sku, detail: `${d.name} (${d.sku}) is no longer in the export.` });
  }
  const bd = base.result.distributors, ad = next.result.distributors;
  for (const id of Object.keys(ad)) if (!bd[id]) drift.push({ code: "NEW_DISTRIBUTOR", detail: `New distributor ${id}${ad[id].name ? ` (${ad[id].name})` : ""}.` });
  for (const id of Object.keys(bd)) if (!ad[id]) drift.push({ code: "REMOVED_DISTRIBUTOR", detail: `Distributor ${id}${bd[id].name ? ` (${bd[id].name})` : ""} is no longer listed.` });
  for (const key of ["sku_master", "current_inventory", "weekly_sales", "calendar", "distributor_master"] as const) {
    const h1 = headerOf(base.inputs[key]), h2 = headerOf(next.inputs[key]);
    const added = h2.filter((c) => !h1.includes(c)), removed = h1.filter((c) => !h2.includes(c));
    if (added.length || removed.length) {
      drift.push({ code: "SCHEMA_CHANGE", detail: `${key}: ${added.length ? `added ${added.join(", ")}` : ""}${added.length && removed.length ? "; " : ""}${removed.length ? `removed ${removed.join(", ")}` : ""}.` });
    }
  }
  const cats = new Set(base.result.recommendations.map((r) => r.Category));
  for (const c of new Set(next.result.recommendations.map((r) => r.Category))) if (!cats.has(c)) drift.push({ code: "NEW_CATEGORY", detail: `New category “${c}”.` });

  return { diffs, changed: diffs.filter((d) => d.changed.length), alerts, drift };
}

export const ALERT_LABEL: Record<Alert["code"], string> = {
  QTY_JUMP: "Order size jumped",
  PAUSE_TO_REORDER: "Overstock to stockout",
  REORDER_TO_PAUSE: "Stockout to overstock",
  DEMAND_SHIFT: "Demand shifted",
  HISTORY_LOST: "Sales history lost",
  NEWLY_HELD: "Newly held for review",
  DISTRIBUTOR_CHANGED: "Distributor changed",
};
