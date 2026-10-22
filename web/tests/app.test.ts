import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { templateBrief, unsupportedNumbers, briefFacts } from "@/lib/brief";
import { approvalStats, classify, validateDecision } from "@/lib/decisions";
import { runEngine } from "@/lib/engine/engine";
import { reviewText } from "@/lib/issues";
import { poCsv, purchaseOrders } from "@/lib/po";
import type { DecisionRecord, RunRecord } from "@/lib/types";

const DATA = path.resolve(import.meta.dirname, "..", "data");
const read = (f: string) => readFileSync(path.join(DATA, f), "utf8");
const result = runEngine({
  sku_master: read("sku_master.csv"), current_inventory: read("current_inventory.csv"), weekly_sales: read("weekly_sales.csv"),
  calendar: read("calendar.csv"), distributor_master: read("distributor_master.csv"),
}, "2026-10-22");
const run = { id: "t", evaluation_date: "2026-10-22", result } as unknown as RunRecord;
const rec = (sku: string) => result.recommendations.find((r) => r.SKU_ID === sku)!;
const decision = (sku: string, d: Partial<DecisionRecord>): DecisionRecord => ({
  run_id: "t", sku_id: sku, decision: "order", qty: rec(sku).Recommended_Order_Qty, recommended_qty: rec(sku).Recommended_Order_Qty,
  engine_action: rec(sku).Action, actor: "Priya", note: "", decided_at: "2026-10-22T10:00:00Z", ...d,
});

describe("planner brief", () => {
  const brief = templateBrief(result);
  const allowed = JSON.stringify(briefFacts(result)) + " " + [brief.headline, ...brief.bullets, ...brief.watch].join(" ");

  it("summarises the real run from engine numbers", () => {
    expect(brief.headline).toBe("5 SKUs to reorder now (1,820 units), 2 to pause.");
    expect(brief.bullets[0]).toContain("Multigrain Bread 400g 1.8 wks → 500");
    expect(brief.watch.join(" ")).toContain("demand ratio 1.21 vs the 1.20 surge line");
    expect(brief.watch.join(" ")).toContain("4.1 weeks of stock vs the 4-week maximum");
  });

  it("accepts a draft that only reuses engine numbers", () => {
    const draft = { ...brief, headline: "Reorder 5 SKUs, 1,820 units in all; Multigrain Bread is at 1.8 weeks.", source: "gemini" as const };
    expect(unsupportedNumbers(draft, allowed)).toEqual([]);
  });

  it("rejects a draft with an invented quantity or total", () => {
    const draft = { ...brief, bullets: ["Order 2,000 units of Mango Drink to be safe.", "Stockouts fell 37% last quarter."], source: "gemini" as const };
    expect(unsupportedNumbers(draft, allowed).sort()).toEqual(["2000", "37"]);
  });

  it("ignores digits inside SKU codes and week ids", () => {
    const draft = { ...brief, headline: "SKU004 and SKU011 are below range as of 2026-W42.", bullets: [], watch: [], source: "gemini" as const };
    expect(unsupportedNumbers(draft, allowed)).toEqual([]);
  });
});

describe("decisions", () => {
  it("needs a name, and a reason for any change", () => {
    expect(validateDecision(rec("SKU001"), { decision: "order", qty: 750, actor: "", note: "" })).toMatch(/name/);
    expect(validateDecision(rec("SKU001"), { decision: "order", qty: 750, actor: "Priya", note: "" })).toBeNull();
    expect(validateDecision(rec("SKU001"), { decision: "order", qty: 600, actor: "Priya", note: "" })).toMatch(/reason/);
    expect(validateDecision(rec("SKU001"), { decision: "no_order", qty: 0, actor: "Priya", note: "" })).toMatch(/reason/);
    expect(validateDecision(rec("SKU006"), { decision: "order", qty: 100, actor: "Priya", note: "" })).toMatch(/reason/);
    expect(validateDecision(rec("SKU001"), { decision: "order", qty: 1.5, actor: "Priya", note: "fine" })).toMatch(/whole number/);
  });

  it("classifies against the engine and computes the override rate", () => {
    const ds = [
      decision("SKU011", {}),
      decision("SKU001", { qty: 600, note: "shelf space" }),
      decision("SKU003", { decision: "no_order", qty: 0, note: "in transit" }),
    ];
    expect(ds.map(classify)).toEqual(["accepted", "edited", "rejected"]);
    const s = approvalStats(run, ds);
    expect(s).toMatchObject({ actionable: 5, decided: 3, pendingReorders: 2, approvedUnits: 1100, overrides: 2 });
    expect(s.overrideRate).toBeCloseTo(2 / 3);
  });

  it("groups approved lines into one purchase order per distributor", () => {
    const groups = purchaseOrders(run, [decision("SKU011", {}), decision("SKU001", {}), decision("SKU004", {}), decision("SKU003", { decision: "no_order", qty: 0, note: "x" })]);
    expect(groups.map((g) => [g.distributor_id, g.units])).toEqual([["DIST001", 750], ["DIST002", 150], ["DIST004", 500]]);
    const csv = poCsv(run, groups).trim().split("\n");
    expect(csv[0]).toMatch(/^PO_Reference,Vendor_ID,Vendor_Name,Item_SKU/);
    expect(csv[1]).toContain("FR-20261022-DIST001,DIST001,NutriFlow Distributors,SKU001");
    expect(csv).toHaveLength(4);
  });

  it("explains review holds in plain words", () => {
    expect(reviewText({ Action: "MANUAL_REVIEW", Review_Reasons: "data-quality hold (CONFLICTING_INVENTORY_SNAPSHOT, MISSING_SALES_WEEKS)" }))
      .toBe("conflicting stock records; weeks missing from the sales export");
  });
});
