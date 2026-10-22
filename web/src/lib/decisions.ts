import type { Recommendation } from "./engine/engine";
import type { DecisionRecord, RunRecord } from "./types";

export type DecisionKind = "accepted" | "edited" | "rejected" | "planner_order" | "planner_no_order" | "override_order";

/** How a person's decision relates to what the engine recommended. Feeds the override rate. */
export function classify(d: DecisionRecord): DecisionKind {
  if (d.engine_action === "IMMEDIATE_REORDER") {
    if (d.decision === "no_order") return "rejected";
    return d.qty === d.recommended_qty ? "accepted" : "edited";
  }
  if (d.engine_action === "MANUAL_REVIEW") return d.decision === "order" ? "planner_order" : "planner_no_order";
  return d.decision === "order" ? "override_order" : "accepted";
}
export const KIND_LABEL: Record<DecisionKind, string> = {
  accepted: "Approved as recommended",
  edited: "Approved with edited quantity",
  rejected: "Rejected",
  planner_order: "Planner ordered",
  planner_no_order: "Planner: no order",
  override_order: "Ordered against the rules",
};
export const isOverride = (k: DecisionKind) => k === "edited" || k === "rejected" || k === "override_order";

export interface DecisionInput {
  decision: "order" | "no_order";
  qty: number;
  actor: string;
  note: string;
}

/** Validation shared by the API and the UI. Returns an error message or null. */
export function validateDecision(rec: Recommendation, d: DecisionInput): string | null {
  if (d.actor.trim().length < 2) return "Enter your name so the decision is attributable.";
  if (d.decision !== "order" && d.decision !== "no_order") return "Decision must be order or no_order.";
  if (d.decision === "order" && !(Number.isInteger(d.qty) && d.qty > 0 && d.qty <= 1_000_000)) return "Quantity must be a whole number between 1 and 1,000,000.";
  const deviates = rec.Action === "IMMEDIATE_REORDER" ? d.decision === "no_order" || d.qty !== rec.Recommended_Order_Qty : d.decision === "order";
  if (deviates && d.note.trim().length < 3) {
    return rec.Action === "MANUAL_REVIEW" ? "Add a short note explaining the planner's call." : "Add a reason when you change or reject the engine's recommendation.";
  }
  return null;
}

export interface ApprovalStats {
  actionable: number;
  decided: number;
  pendingReorders: number;
  pendingReviews: number;
  approvedUnits: number;
  overrides: number;
  overrideRate: number | null;
}

export function approvalStats(run: RunRecord, decisions: DecisionRecord[]): ApprovalStats {
  const recs = run.result.recommendations;
  const bySku = new Map(decisions.map((d) => [d.sku_id, d]));
  const needs = recs.filter((r) => r.Action === "IMMEDIATE_REORDER" || r.Action === "MANUAL_REVIEW");
  const covered = decisions.filter((d) => d.engine_action !== "MANUAL_REVIEW");
  const overrides = covered.filter((d) => isOverride(classify(d))).length;
  return {
    actionable: needs.length,
    decided: needs.filter((r) => bySku.has(r.SKU_ID)).length,
    pendingReorders: recs.filter((r) => r.Action === "IMMEDIATE_REORDER" && !bySku.has(r.SKU_ID)).length,
    pendingReviews: recs.filter((r) => r.Action === "MANUAL_REVIEW" && !bySku.has(r.SKU_ID)).length,
    approvedUnits: decisions.filter((d) => d.decision === "order").reduce((s, d) => s + d.qty, 0),
    overrides,
    overrideRate: covered.length ? overrides / covered.length : null,
  };
}
