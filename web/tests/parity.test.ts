/**
 * The TypeScript engine must match the Python reference engine exactly.
 * Golden files come from `../scripts/export_golden.py` (re-run it after changing either engine).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runEngine } from "@/lib/engine/engine";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CASES: Record<string, string> = {
  real: path.join(ROOT, "data"),
  sample: path.join(ROOT, "sample_data"),
  messy: path.join(import.meta.dirname, "fixtures", "messy"),
};
const read = (dir: string, f: string) => readFileSync(path.join(dir, f), "utf8");

const NUMERIC = ["Units_On_Hand", "avg_12w_sales", "avg_4w_sales", "seasonal_uplift_pct", "baseline_demand", "demand_ratio",
  "weeks_of_stock", "Standard_Reorder_Qty", "effective_reorder_qty", "Recommended_Order_Qty", "Location_Count",
  "weeks_observed_12w", "weeks_observed_4w", "reorder_multiplier"];

describe.each(Object.entries(CASES))("parity with Python engine: %s", (name, dir) => {
  const golden = JSON.parse(readFileSync(path.join(import.meta.dirname, "golden", `${name}.json`), "utf8"));
  const ts = runEngine({
    sku_master: read(dir, "sku_master.csv"),
    current_inventory: read(dir, "current_inventory.csv"),
    weekly_sales: read(dir, "weekly_sales.csv"),
    calendar: read(dir, "calendar.csv"),
    distributor_master: read(dir, "distributor_master.csv"),
  }, golden.evaluation_date);

  it("same run metadata", () => {
    expect(ts.sales_cutoff_week).toBe(golden.sales_cutoff_week);
    expect(ts.inventory_snapshot_dates).toEqual(golden.inventory_snapshot_dates);
  });

  it("same SKUs in the same order", () => {
    expect(ts.recommendations.map((r) => r.SKU_ID)).toEqual(golden.recommendations.map((r: { SKU_ID: string }) => r.SKU_ID));
  });

  it("same decision, numbers and explanation for every SKU", () => {
    golden.recommendations.forEach((g: Record<string, unknown>, i: number) => {
      const t = ts.recommendations[i] as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(g)) {
        if (NUMERIC.includes(k) && v != null) expect(t[k] as number, `${g.SKU_ID}.${k}`).toBeCloseTo(v as number, 9);
        else expect(t[k], `${g.SKU_ID}.${k}`).toEqual(v);
      }
    });
  });

  it("same data-quality report, record for record", () => {
    expect(ts.data_quality).toEqual(golden.data_quality);
  });

  it("same KPIs and scenarios", () => {
    expect(ts.summary.operational_kpis).toMatchObject(
      Object.fromEntries(Object.entries(golden.operational_kpis).filter(([k]) => k !== "total_recommended_order_units_definition")));
    expect(ts.summary.illustrative_prevention_scenarios).toEqual(golden.scenarios);
    const { global_issues, issues_by_code, ...counts } = golden.data_quality_summary;
    expect(ts.summary.data_quality).toMatchObject({ ...counts, issues_by_code, global_issues });
  });
});
