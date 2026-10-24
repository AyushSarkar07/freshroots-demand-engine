/**
 * Rule conflicts: places where two of Raghav's rules pull in different directions for the
 * same SKU. The engine still applies its documented precedence; this module makes every
 * instance visible and logged, so the rules can be refined at the monthly review.
 */
import type { EngineResult } from "./engine/engine";
import { coverRange, coverState, shortName } from "./insights";

export interface Conflict {
  code: ConflictCode;
  sku: string;
  name: string;
  detail: string;
}

export type ConflictCode =
  | "SURGE_VS_OVERSTOCK"
  | "UPLIFT_FLIPS_DECISION"
  | "ORDER_STILL_SHORT"
  | "ORDER_OVERSHOOTS_MAX"
  | "HOLD_VS_STOCKOUT"
  | "CALENDAR_VS_RULE";

const ACTION_FOR: Record<string, string> = { below: "reorder", within: "in range", above: "pause" };

export function detectConflicts(r: EngineResult): Conflict[] {
  const c = r.config;
  const out: Conflict[] = [];
  for (const x of r.recommendations) {
    const name = shortName(x.SKU_Name);
    const range = coverRange(x.Perishability, c);
    if (x.demand_spurt_flag && x.Action === "PAUSE_ORDER") {
      out.push({ code: "SURGE_VS_OVERSTOCK", sku: x.SKU_ID, name, detail: `Demand is surging (ratio ${x.demand_ratio?.toFixed(2)}), but stock is above the ${range.hi}-week limit. The cover rule wins: no order this cycle.` });
    }
    if (!x.Review_Required && x.seasonal_uplift_pct > 0 && x.avg_12w_sales && x.Units_On_Hand != null) {
      const without = coverState(x.Units_On_Hand / x.avg_12w_sales, range);
      const withUplift = coverState(x.weeks_of_stock, range);
      if (without !== withUplift) {
        out.push({ code: "UPLIFT_FLIPS_DECISION", sku: x.SKU_ID, name, detail: `The +${x.seasonal_uplift_pct}% festival uplift changes the decision from “${ACTION_FOR[without]}” to “${ACTION_FOR[withUplift]}” (${(x.Units_On_Hand / x.avg_12w_sales).toFixed(1)} → ${x.weeks_of_stock?.toFixed(1)} weeks).` });
      }
    }
    if (x.Action === "IMMEDIATE_REORDER" && x.baseline_demand && x.Units_On_Hand != null) {
      const after = (x.Units_On_Hand + x.Recommended_Order_Qty) / x.baseline_demand;
      // Two decimals near a boundary, so 5.95 never reads as "6.0, under the 6-week minimum".
      const wk = (v: number, b: number) => (Math.abs(v - b) < 0.1 ? v.toFixed(2) : v.toFixed(1));
      if (after < range.lo) {
        out.push({ code: "ORDER_STILL_SHORT", sku: x.SKU_ID, name, detail: `Even after receiving ${x.Recommended_Order_Qty} units, cover would be ${wk(after, range.lo)} weeks, still under the ${range.lo}-week minimum. The standard reorder quantity is too small for current demand.` });
      } else if (after > range.hi) {
        out.push({ code: "ORDER_OVERSHOOTS_MAX", sku: x.SKU_ID, name, detail: `Receiving ${x.Recommended_Order_Qty} units would leave ${wk(after, range.hi)} weeks of stock, over the ${range.hi}-week maximum${x.Perishability === "High" ? ": a write-off risk for a perishable" : ""}.` });
      }
    }
    if (x.Review_Required && x.Indicative_Action === "IMMEDIATE_REORDER") {
      out.push({ code: "HOLD_VS_STOCKOUT", sku: x.SKU_ID, name, detail: `Held by a data check, yet the available numbers point to a stockout. Escalate today rather than wait for the next export.` });
    }
  }
  if (r.data_quality.some((d) => d.Issue_Code === "CALENDAR_FESTIVAL_MISMATCH")) {
    out.push({ code: "CALENDAR_VS_RULE", sku: "", name: "All SKUs", detail: "The festival calendar disagrees with the festival-month rule for this month. The configured rule was applied." });
  }
  return out;
}

export const CONFLICT_LABEL: Record<ConflictCode, string> = {
  SURGE_VS_OVERSTOCK: "Surge vs overstock",
  UPLIFT_FLIPS_DECISION: "Festival uplift flips the decision",
  ORDER_STILL_SHORT: "Order too small to reach range",
  ORDER_OVERSHOOTS_MAX: "Order overshoots the maximum",
  HOLD_VS_STOCKOUT: "Data hold vs stockout risk",
  CALENDAR_VS_RULE: "Calendar vs festival rule",
};
