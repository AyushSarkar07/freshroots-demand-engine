import type { Recommendation } from "./engine/engine";

/** Plain-English names for the data-quality codes that hold a SKU for planner review. */
export const ISSUE_LABEL: Record<string, string> = {
  INSUFFICIENT_HISTORY: "too little sales history (new launch?)",
  MISSING_SALES_WEEKS: "weeks missing from the sales export",
  MISSING_INVENTORY: "no stock record",
  MISSING_INVENTORY_VALUE: "stock quantity blank",
  INVALID_NUMERIC: "stock quantity not a number",
  NEGATIVE_INVENTORY: "negative stock",
  INVALID_AS_OF_DATE: "stock date missing",
  FUTURE_SNAPSHOT: "stock dated after the run",
  BLANK_LOCATION: "warehouse missing on a stock row",
  CONFLICTING_INVENTORY_SNAPSHOT: "conflicting stock records",
  MULTIPLE_LOCATIONS: "held in several warehouses",
  CONFLICTING_SKU_MASTER: "SKU listed twice in the master",
  INVALID_PERISHABILITY: "unknown perishability class",
  INVALID_REORDER_QTY: "invalid standard reorder quantity",
  UNSUPPORTED_UOM: "unit of measure is not Units",
};

/** Why a SKU is in MANUAL_REVIEW, in words a planner would use. */
export function reviewText(r: Pick<Recommendation, "Action" | "Review_Reasons"> & { weeks_observed_12w?: number }): string {
  if (r.Action !== "MANUAL_REVIEW") return "";
  if (r.weeks_observed_12w === 0 && /INSUFFICIENT_HISTORY/.test(r.Review_Reasons)) return "no sales history at all (new SKU?)";
  const m = /^data-quality hold \((.*)\)$/.exec(r.Review_Reasons);
  if (m) return m[1].split(", ").map((c) => ISSUE_LABEL[c] ?? c.toLowerCase().replace(/_/g, " ")).join("; ");
  if (r.Review_Reasons.startsWith("zero demand")) return "no sales in 12 weeks (delisted or supply problem?)";
  return r.Review_Reasons;
}
