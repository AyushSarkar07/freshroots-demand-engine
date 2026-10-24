import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareRuns } from "@/lib/compare";
import { detectConflicts } from "@/lib/conflicts";
import { type EngineInputs, runEngine } from "@/lib/engine/engine";
import { rulebookSections, searchRulebook } from "@/lib/rulebook";
import { applyScenario, ScenarioError } from "@/lib/scenario";
import type { RunRecord } from "@/lib/types";

const DATA = path.resolve(import.meta.dirname, "..", "data");
const read = (f: string) => readFileSync(path.join(DATA, f), "utf8");
const inputs: EngineInputs = {
  sku_master: read("sku_master.csv"), current_inventory: read("current_inventory.csv"), weekly_sales: read("weekly_sales.csv"),
  calendar: read("calendar.csv"), distributor_master: read("distributor_master.csv"),
};
const DATE = "2026-10-22";
const asRun = (id: string, inp: EngineInputs, overrides = {}): RunRecord => ({
  id, created_at: "2026-10-22T00:00:00Z", created_by: "test", source: "upload", label: id, evaluation_date: DATE,
  inputs: inp, input_meta: [], result: runEngine(inp, DATE, overrides), brief: null,
});
const base = asRun("base", inputs);

describe("database simulation: SKU009 as a new SKU", () => {
  const { inputs: sim, spec } = applyScenario(inputs, {
    sku_id: "SKU009", remove_history: true, new_distributor: { id: "DIST005", name: "Konkan Fresh Supply", region: "Goa" }, remap_to: "DIST005",
  });
  const scenario = asRun("sim", sim);
  const before = base.result.recommendations.find((r) => r.SKU_ID === "SKU009")!;
  const after = scenario.result.recommendations.find((r) => r.SKU_ID === "SKU009")!;

  it("applies the three operations to copies of the tables", () => {
    expect(spec.operations[0]).toMatch(/^DELETE FROM weekly_sales WHERE sku_id = 'SKU009';  -- 16 rows/);
    expect(spec.operations[1]).toMatch(/^INSERT INTO distributor_master .*'DIST005', 'Konkan Fresh Supply', 'Goa', 'Active'/);
    expect(spec.operations[2]).toMatch(/^UPDATE sku_master SET distributor_id = 'DIST005' WHERE sku_id = 'SKU009';  -- was DIST003/);
    expect(sim.weekly_sales!.split("\n").filter((l) => l.startsWith("SKU009")).length).toBe(0);
    expect(inputs.weekly_sales.split("\n").filter((l) => l.startsWith("SKU009")).length).toBe(16); // original untouched
  });

  it("was a normal in-range SKU before", () => {
    expect(before).toMatchObject({ Action: "MAINTAIN", Recommended_Order_Qty: 0, weeks_observed_12w: 12, Distributor_ID: "DIST003" });
  });

  it("is flagged as having no history and gets a reorder quantity of zero", () => {
    expect(after).toMatchObject({ Action: "MANUAL_REVIEW", Recommended_Order_Qty: 0, Review_Required: true, weeks_observed_12w: 0, Data_Quality_Status: "ERROR", Distributor_ID: "DIST005" });
    expect(after.Data_Quality_Notes).toContain("INSUFFICIENT_HISTORY: Only 0 of 12 weeks in the baseline window (no valid sales history)");
    expect(scenario.result.distributors.DIST005).toEqual({ name: "Konkan Fresh Supply", status: "Active" });
  });

  it("leaves every other SKU's decision unchanged", () => {
    for (const r of scenario.result.recommendations.filter((x) => x.SKU_ID !== "SKU009")) {
      const b = base.result.recommendations.find((x) => x.SKU_ID === r.SKU_ID)!;
      expect([r.Action, r.Recommended_Order_Qty], r.SKU_ID).toEqual([b.Action, b.Recommended_Order_Qty]);
    }
  });

  it("raises the right early warnings and drift when compared with the original", () => {
    const cmp = compareRuns(base, scenario);
    expect(cmp.changed.map((d) => d.sku)).toEqual(["SKU009"]);
    expect(cmp.alerts.map((a) => [a.sku, a.code, a.severity])).toEqual([["SKU009", "HISTORY_LOST", "high"], ["SKU009", "DISTRIBUTOR_CHANGED", "medium"]]);
    expect(cmp.drift.map((d) => d.code)).toEqual(["NEW_DISTRIBUTOR"]);
  });

  it("refuses unsafe or empty scenarios", () => {
    expect(() => applyScenario(inputs, { sku_id: "SKU999", remove_history: true })).toThrow(ScenarioError);
    expect(() => applyScenario(inputs, { sku_id: "SKU009", remove_history: false, new_distributor: { id: "DIST001", name: "Dup" } })).toThrow(/already exists/);
    expect(() => applyScenario(inputs, { sku_id: "SKU009", remove_history: false })).toThrow(/at least one change/);
    expect(() => applyScenario(inputs, { sku_id: "SKU009", remove_history: false, remap_to: "DIST999" })).toThrow(/doesn't exist/);
  });
});

describe("early warnings for anomalous shifts", () => {
  it("flags an order that jumps by 50% or more (the chia seeds 100 → 180 case)", () => {
    const next = structuredClone(base);
    const prev = structuredClone(base);
    const p = prev.result.recommendations.find((r) => r.SKU_ID === "SKU009")!;
    const n = next.result.recommendations.find((r) => r.SKU_ID === "SKU009")!;
    Object.assign(p, { Action: "IMMEDIATE_REORDER", Recommended_Order_Qty: 100 });
    Object.assign(n, { Action: "IMMEDIATE_REORDER", Recommended_Order_Qty: 180 });
    const a = compareRuns(prev, next).alerts.find((x) => x.code === "QTY_JUMP")!;
    expect(a).toMatchObject({ sku: "SKU009", severity: "high" });
    expect(a.detail).toContain("100 → 180 units (+80%)");
  });

  it("stays quiet when nothing moved", () => {
    expect(compareRuns(base, structuredClone(base)).alerts).toEqual([]);
  });

  it("detects a changed export format as drift", () => {
    // A renamed required column is refused outright (fail loudly); an extra column is accepted and reported as drift.
    expect(() => asRun("renamed", { ...inputs, current_inventory: inputs.current_inventory.replace("Location", "Warehouse") })).toThrow(/missing required column\(s\) \['Location'\]/);
    const extra = asRun("extra", { ...inputs, sku_master: inputs.sku_master.replace("Distributor_ID", "Distributor_ID,Brand_Owner").replace(/\n(SKU\d+[^\n]*)/g, "\n$1,Freshroots") });
    expect(compareRuns(base, extra).drift.find((d) => d.code === "SCHEMA_CHANGE")?.detail).toBe("sku_master: added Brand_Owner.");
  });
});

describe("rule conflicts", () => {
  it("finds the three real conflicts in the SAP export", () => {
    const c = detectConflicts(base.result);
    expect(c.map((x) => [x.sku, x.code])).toEqual([["SKU002", "UPLIFT_FLIPS_DECISION"], ["SKU003", "ORDER_STILL_SHORT"], ["SKU013", "ORDER_STILL_SHORT"]]);
    expect(c[0].detail).toContain("from “pause” to “in range” (14.3 → 11.5 weeks)");
    expect(c[1].detail).toContain("5.95 weeks, still under the 6-week minimum");
  });

  it("logs surge-vs-overstock and festival flips when they happen", () => {
    const r = structuredClone(base.result);
    const quinoa = r.recommendations.find((x) => x.SKU_ID === "SKU006")!;
    quinoa.demand_spurt_flag = true;
    const codes = detectConflicts(r).map((x) => x.code);
    expect(codes).toContain("SURGE_VS_OVERSTOCK");
    const flipped = runEngine({ ...inputs, current_inventory: inputs.current_inventory.replace("SKU001,Pune Central Warehouse,900", "SKU001,Pune Central Warehouse,1400") }, DATE);
    expect(detectConflicts(flipped).find((x) => x.sku === "SKU001")?.code).toBe("UPLIFT_FLIPS_DECISION");
  });
});

describe("rulebook", () => {
  const sections = rulebookSections(base.result.config);
  it("documents every rule, conflict and failure with an owner", () => {
    expect(sections.filter((s) => s.id.startsWith("R"))).toHaveLength(7);
    expect(sections.filter((s) => s.id.startsWith("C"))).toHaveLength(6);
    expect(sections.filter((s) => s.id.startsWith("F")).every((s) => /Owner: /.test(s.body))).toBe(true);
  });
  it("answers why-questions from the right section without AI", () => {
    expect(searchRulebook(sections, "Why is the festival uplift 25 percent?")[0].id).toBe("R2");
    expect(searchRulebook(sections, "what about a new SKU with no sales history")[0].id).toMatch(/^(R1|F3)$/);
  });
});
