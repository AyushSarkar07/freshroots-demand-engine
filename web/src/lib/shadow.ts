/**
 * Shadow mode: the planner records his own call for each SKU without seeing the engine's,
 * and we measure how often they agree. This is the decision memo's kill criterion:
 * if the engine agrees with Raghav on fewer than 80% of the SKUs the rules cover, the written
 * rules aren't how he actually plans, so stop and redesign before going live.
 */
import type { Recommendation } from "./engine/engine";

export const SHADOW = {
  killThreshold: 0.8, // agreement below this, on rule-covered SKUs, triggers the kill criterion
  minSample: 20, // rule-covered calls needed before a verdict is given
  qtyTolerance: 0.1, // reorder quantities within ±10% count as the same call
} as const;

export type PlannerAction = "REORDER" | "PAUSE" | "MAINTAIN" | "HOLD";
export const PLANNER_ACTIONS: { value: PlannerAction; label: string; hint: string }[] = [
  { value: "REORDER", label: "Reorder", hint: "Order now" },
  { value: "PAUSE", label: "Pause", hint: "Skip the next order" },
  { value: "MAINTAIN", label: "In range", hint: "No order needed" },
  { value: "HOLD", label: "Hold", hint: "Data looks wrong / needs checking" },
];

const FROM_ENGINE: Record<string, PlannerAction> = {
  IMMEDIATE_REORDER: "REORDER", PAUSE_ORDER: "PAUSE", MAINTAIN: "MAINTAIN", MANUAL_REVIEW: "HOLD",
};
export const engineAsPlanner = (action: string): PlannerAction => FROM_ENGINE[action] ?? "HOLD";

export interface ShadowCall {
  run_id: string;
  sku_id: string;
  planner_action: PlannerAction;
  planner_qty: number;
  engine_action: string;
  engine_qty: number;
  actor: string;
  note: string;
  decided_at: string;
}

export function validateShadow(rec: Pick<Recommendation, "SKU_ID">, c: { action: string; qty: number; actor: string }): string | null {
  if (c.actor.trim().length < 2) return "Enter your name so the call is attributable.";
  if (!PLANNER_ACTIONS.some((a) => a.value === c.action)) return "Pick reorder, pause, in range or hold.";
  if (c.action === "REORDER" && !(Number.isInteger(c.qty) && c.qty > 0 && c.qty <= 1_000_000)) return "Enter the quantity you would order (a whole number).";
  return null;
}

/** Same action; for reorders, also the same quantity within the tolerance. */
export function compareCall(c: Pick<ShadowCall, "planner_action" | "planner_qty" | "engine_action" | "engine_qty">) {
  const engine = engineAsPlanner(c.engine_action);
  const actionAgrees = c.planner_action === engine;
  const qtyAgrees = actionAgrees && engine === "REORDER"
    ? Math.abs(c.planner_qty - c.engine_qty) <= SHADOW.qtyTolerance * Math.max(c.engine_qty, 1)
    : null;
  return { engine, actionAgrees, qtyAgrees, ruleCovered: c.engine_action !== "MANUAL_REVIEW" };
}

export type Verdict = "collecting" | "on_track" | "kill";

export function agreement(calls: ShadowCall[]) {
  const scored = calls.map((c) => ({ c, ...compareCall(c) }));
  const covered = scored.filter((s) => s.ruleCovered);
  const agree = covered.filter((s) => s.actionAgrees).length;
  const rate = covered.length ? agree / covered.length : null;
  const reorders = covered.filter((s) => s.engine === "REORDER" && s.actionAgrees);
  const qtyAgree = reorders.filter((s) => s.qtyAgrees).length;

  const order: PlannerAction[] = ["REORDER", "PAUSE", "MAINTAIN", "HOLD"];
  const matrix = order.map((engine) => ({
    engine,
    counts: order.map((planner) => scored.filter((s) => s.engine === engine && s.c.planner_action === planner).length),
  }));

  const verdict: Verdict = covered.length < SHADOW.minSample ? "collecting" : (rate ?? 0) >= SHADOW.killThreshold ? "on_track" : "kill";
  return {
    total: calls.length,
    covered: covered.length,
    agree,
    rate,
    qty: { compared: reorders.length, agree: qtyAgree, rate: reorders.length ? qtyAgree / reorders.length : null },
    matrix,
    order,
    verdict,
    disagreements: scored.filter((s) => !s.actionAgrees || s.qtyAgrees === false).map((s) => s.c),
    reviewCalls: scored.filter((s) => !s.ruleCovered).map((s) => s.c),
  };
}

export const ACTION_LABEL: Record<PlannerAction, string> = { REORDER: "Reorder", PAUSE: "Pause", MAINTAIN: "In range", HOLD: "Hold" };
