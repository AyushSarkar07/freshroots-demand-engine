import { describe, expect, it } from "vitest";
import { agreement, compareCall, engineAsPlanner, SHADOW, validateShadow, type ShadowCall } from "@/lib/shadow";

const call = (sku: string, planner: ShadowCall["planner_action"], engine: string, pq = 0, eq = 0, note = ""): ShadowCall => ({
  run_id: "r1", sku_id: sku, planner_action: planner, planner_qty: pq, engine_action: engine, engine_qty: eq, actor: "Raghav", note, decided_at: "2026-10-24T10:00:00Z",
});

describe("shadow-mode comparison", () => {
  it("maps engine actions onto the planner's choices", () => {
    expect(["IMMEDIATE_REORDER", "PAUSE_ORDER", "MAINTAIN", "MANUAL_REVIEW"].map(engineAsPlanner)).toEqual(["REORDER", "PAUSE", "MAINTAIN", "HOLD"]);
  });

  it("treats reorder quantities within ±10% as the same call", () => {
    expect(compareCall(call("A", "REORDER", "IMMEDIATE_REORDER", 160, 150)).qtyAgrees).toBe(true);
    expect(compareCall(call("A", "REORDER", "IMMEDIATE_REORDER", 166, 150)).qtyAgrees).toBe(false);
    expect(compareCall(call("A", "PAUSE", "IMMEDIATE_REORDER", 0, 150))).toMatchObject({ actionAgrees: false, qtyAgrees: null });
  });

  it("excludes planner-review SKUs from the agreement rate", () => {
    const a = agreement([call("A", "MAINTAIN", "MAINTAIN"), call("B", "HOLD", "MANUAL_REVIEW"), call("C", "REORDER", "MANUAL_REVIEW", 50)]);
    expect(a).toMatchObject({ total: 3, covered: 1, agree: 1, rate: 1 });
    expect(a.reviewCalls).toHaveLength(2);
  });

  it("gives no verdict until the minimum sample is reached", () => {
    const few = Array.from({ length: SHADOW.minSample - 1 }, (_, i) => call(`S${i}`, "PAUSE", "MAINTAIN"));
    expect(agreement(few)).toMatchObject({ verdict: "collecting", rate: 0 });
  });

  it("triggers the kill criterion below 80% and passes at exactly 80%", () => {
    const make = (agreeN: number, total: number) => Array.from({ length: total }, (_, i) => (i < agreeN ? call(`S${i}`, "MAINTAIN", "MAINTAIN") : call(`S${i}`, "REORDER", "MAINTAIN", 100)));
    expect(agreement(make(15, 20))).toMatchObject({ rate: 0.75, verdict: "kill" });
    expect(agreement(make(16, 20))).toMatchObject({ rate: 0.8, verdict: "on_track" });
  });

  it("builds the confusion matrix and lists every disagreement, including quantity-only ones", () => {
    const a = agreement([
      call("A", "REORDER", "IMMEDIATE_REORDER", 150, 150),
      call("B", "REORDER", "IMMEDIATE_REORDER", 300, 150, "Diwali scheme from the distributor"),
      call("C", "MAINTAIN", "PAUSE_ORDER"),
    ]);
    const row = (e: string) => a.matrix.find((m) => m.engine === e)!.counts;
    expect(row("REORDER")).toEqual([2, 0, 0, 0]);
    expect(row("PAUSE")).toEqual([0, 0, 1, 0]);
    expect(a.disagreements.map((d) => d.sku_id)).toEqual(["B", "C"]);
    expect(a.qty).toMatchObject({ compared: 2, agree: 1 });
  });

  it("validates a call before it is stored", () => {
    expect(validateShadow({ SKU_ID: "A" }, { action: "REORDER", qty: 0, actor: "Raghav" })).toMatch(/quantity/);
    expect(validateShadow({ SKU_ID: "A" }, { action: "ORDER", qty: 0, actor: "Raghav" })).toMatch(/Pick/);
    expect(validateShadow({ SKU_ID: "A" }, { action: "PAUSE", qty: 0, actor: "" })).toMatch(/name/);
    expect(validateShadow({ SKU_ID: "A" }, { action: "HOLD", qty: 0, actor: "Raghav" })).toBeNull();
  });
});
