import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareRuns } from "@/lib/compare";
import { runEngine, type EngineInputs } from "@/lib/engine/engine";
import { runMessage } from "@/lib/notify";
import { applyScenario } from "@/lib/scenario";
import type { RunRecord } from "@/lib/types";

const DATA = path.resolve(import.meta.dirname, "..", "data");
const read = (f: string) => readFileSync(path.join(DATA, f), "utf8");
const inputs: EngineInputs = { sku_master: read("sku_master.csv"), current_inventory: read("current_inventory.csv"), weekly_sales: read("weekly_sales.csv"), calendar: read("calendar.csv"), distributor_master: read("distributor_master.csv") };
const asRun = (id: string, inp: EngineInputs): RunRecord => ({ id, created_at: "", created_by: "t", source: "upload", label: id, evaluation_date: "2026-10-22", inputs: inp, input_meta: [], result: runEngine(inp, "2026-10-22"), brief: null });

describe("red alerts in the procurement message", () => {
  it("leads with data holds and high-severity shifts", () => {
    const base = asRun("base", inputs);
    const next = asRun("next", applyScenario(inputs, { sku_id: "SKU009", remove_history: true }).inputs);
    const { text, html } = runMessage(next, compareRuns(base, next).alerts);
    expect(text.split("\n")[0]).toBe("RED ALERT · 2 items to act on today:");
    expect(text).toContain("Chia Seeds 200g: held by a data check (INSUFFICIENT_HISTORY)");
    expect(text).toContain("Chia Seeds 200g: Had 12 weeks of sales history; now 0.");
    expect(html.startsWith("🔴 <b>RED ALERT")).toBe(true);
  });
  it("has no red alert on a clean run", () => {
    expect(runMessage(asRun("base", inputs)).text).not.toContain("RED ALERT");
  });
});
