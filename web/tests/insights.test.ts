import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/lib/engine/config";
import { runEngine } from "@/lib/engine/engine";
import { coverRange, coverState, demandTrend, freshness, gaugeScale, groups } from "@/lib/insights";

const load = (dir: string, date: string) => {
  const r = (f: string) => readFileSync(path.join(dir, f), "utf8");
  return runEngine({ sku_master: r("sku_master.csv"), current_inventory: r("current_inventory.csv"), weekly_sales: r("weekly_sales.csv"), calendar: r("calendar.csv"), distributor_master: r("distributor_master.csv") }, date);
};
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const real = load(path.join(ROOT, "data"), "2026-10-22");
const datasets = {
  real,
  sample: load(path.join(ROOT, "sample_data"), "2026-10-22"),
  messy: load(path.join(import.meta.dirname, "fixtures", "messy"), "2026-07-15"),
};

describe("stock-cover instrument", () => {
  const low = coverRange("Low", DEFAULT_CONFIG);
  const high = coverRange("High", DEFAULT_CONFIG);

  it("uses the configured ranges per perishability", () => {
    expect(low).toEqual({ lo: 6, hi: 14 });
    expect(high).toEqual({ lo: 3, hi: 4 });
  });

  it("keeps the engine's inclusive boundaries", () => {
    expect(coverState(5.99, low)).toBe("below");
    expect(coverState(6, low)).toBe("within");
    expect(coverState(14, low)).toBe("within");
    expect(coverState(14.01, low)).toBe("above");
    expect(coverState(3, high)).toBe("within");
    expect(coverState(4, high)).toBe("within");
    expect(coverState(4.08, high)).toBe("above");
    expect(coverState(null, low)).toBe("unknown");
  });

  it("places the marker on a scale with room past the overstock limit", () => {
    const g = gaugeScale(22.2, low);
    expect(g.max).toBeGreaterThan(22.2);
    expect(g.marker).toBeLessThan(100);
    expect(g.lo).toBeLessThan(g.hi);
    expect(gaugeScale(null, low).marker).toBeNull();
  });

  it.each(Object.entries(datasets))("never contradicts the engine's flag (%s)", (_n, res) => {
    for (const r of res.recommendations) {
      const st = coverState(r.weeks_of_stock, coverRange(r.Perishability, res.config));
      if (!["Low", "High"].includes(r.Perishability) || r.weeks_of_stock == null) continue;
      const expected = r.Inventory_Flag.startsWith("STOCKOUT") ? "below" : r.Inventory_Flag.startsWith("OVERSTOCK") ? "above" : "within";
      expect(st, r.SKU_ID).toBe(expected);
    }
  });
});

describe("demand pulse", () => {
  it("calls a surge only when the engine flagged one", () => {
    expect(demandTrend({ demand_ratio: 1.21, demand_spurt_flag: true })).toBe("surge");
    expect(demandTrend({ demand_ratio: 1.2, demand_spurt_flag: false })).toBe("rising");
    expect(demandTrend({ demand_ratio: 1.01, demand_spurt_flag: false })).toBe("stable");
    expect(demandTrend({ demand_ratio: 0.9, demand_spurt_flag: false })).toBe("falling");
    expect(demandTrend({ demand_ratio: null, demand_spurt_flag: false })).toBe("unavailable");
  });

  it.each(Object.entries(datasets))("agrees with every engine surge flag (%s)", (_n, res) => {
    for (const r of res.recommendations) expect(demandTrend(r) === "surge", r.SKU_ID).toBe(r.demand_spurt_flag);
  });
});

describe("overview figures", () => {
  it("reports freshness from the real export", () => {
    const f = freshness(real);
    expect(f).toMatchObject({ snapshot: "2026-10-19", snapshotAgeDays: 3, salesWeek: "2026-W42", stale: false, status: "ok", statusText: "All data checks passed" });
  });

  it("flags blocked SKUs on the messy fixture", () => {
    const f = freshness(datasets.messy);
    expect(f.status).toBe("crit");
    expect(f.statusText).toMatch(/held by data checks/);
  });

  it("groups SKUs exactly as the engine decided", () => {
    const g = groups(real.recommendations);
    expect([g.reorder.length, g.within.length, g.pause.length, g.review.length]).toEqual([5, 8, 2, 0]);
    expect(g.reorder.reduce((s, r) => s + r.Recommended_Order_Qty, 0)).toBe(real.summary.operational_kpis.total_recommended_order_units);
  });
});
