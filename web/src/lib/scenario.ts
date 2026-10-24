/**
 * The database simulation exercise, as named operations on a run's input tables:
 * delete a SKU's sales history, add a distributor, remap the SKU to it, optionally switch
 * the festival uplift off. The result is a new scenario run that can be compared with its base.
 */
import { parseCsv } from "./engine/csv";
import type { EngineConfig } from "./engine/config";
import type { EngineInputs } from "./engine/engine";
import { toCsv } from "./po";
import type { ScenarioSpec } from "./types";

export interface ScenarioRequest {
  sku_id: string;
  remove_history: boolean;
  new_distributor?: { id: string; name: string; region?: string } | null;
  remap_to?: string | null;
  festival_uplift?: "rule" | "off";
}

export class ScenarioError extends Error {}

const norm = (v: string | undefined) => (v ?? "").trim().toUpperCase();
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

function table(text: string | null | undefined) {
  const t = parseCsv(text ?? "");
  return { columns: t.columns, rows: t.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "_row"))) };
}
const write = (t: { columns: string[]; rows: Record<string, string>[] }) => toCsv(t.columns, t.rows.map((r) => t.columns.map((c) => r[c] ?? "")));
const col = (cols: string[], name: string) => cols.find((c) => c.toLowerCase() === name.toLowerCase());

export function applyScenario(inputs: EngineInputs, req: ScenarioRequest): { inputs: EngineInputs; spec: ScenarioSpec; overrides: Partial<EngineConfig> } {
  const sku = norm(req.sku_id);
  const skus = table(inputs.sku_master);
  const skuCol = col(skus.columns, "SKU_ID")!;
  const distCol = col(skus.columns, "Distributor_ID")!;
  const target = skus.rows.find((r) => norm(r[skuCol]) === sku);
  if (!target) throw new ScenarioError(`${sku} is not in the SKU master of the base run.`);

  const ops: string[] = [];
  const out: EngineInputs = { ...inputs };

  if (req.remove_history) {
    const sales = table(inputs.weekly_sales);
    const sc = col(sales.columns, "SKU_ID")!;
    const before = sales.rows.length;
    sales.rows = sales.rows.filter((r) => norm(r[sc]) !== sku);
    const removed = before - sales.rows.length;
    if (!removed) throw new ScenarioError(`${sku} has no sales rows to delete.`);
    out.weekly_sales = write(sales);
    ops.push(`DELETE FROM weekly_sales WHERE sku_id = ${q(sku)};  -- ${removed} rows`);
  }

  let newDist: ScenarioSpec["new_distributor"] = null;
  if (req.new_distributor) {
    const id = norm(req.new_distributor.id);
    const name = req.new_distributor.name.trim();
    if (!/^[A-Z0-9_-]{2,20}$/.test(id)) throw new ScenarioError("Distributor ID must be 2–20 letters, digits, - or _.");
    if (name.length < 2) throw new ScenarioError("Give the new distributor a name.");
    const d = inputs.distributor_master ? table(inputs.distributor_master) : { columns: ["Distributor_ID", "Distributor_Name", "Region", "Status"], rows: [] };
    const ic = col(d.columns, "Distributor_ID") ?? "Distributor_ID";
    if (d.rows.some((r) => norm(r[ic]) === id)) throw new ScenarioError(`Distributor ${id} already exists.`);
    const region = (req.new_distributor.region ?? "").trim() || "Maharashtra";
    const row: Record<string, string> = {};
    for (const c of d.columns) {
      const k = c.toLowerCase();
      row[c] = k === "distributor_id" ? id : k.includes("name") ? name : k === "region" ? region : k === "status" ? "Active" : "";
    }
    d.rows.push(row);
    out.distributor_master = write(d);
    newDist = { id, name, region };
    ops.push(`INSERT INTO distributor_master (distributor_id, distributor_name, region, status) VALUES (${q(id)}, ${q(name)}, ${q(region)}, 'Active');`);
  }

  if (req.remap_to) {
    const to = norm(req.remap_to);
    const known = new Set(table(out.distributor_master).rows.map((r) => norm(r[col(Object.keys(r), "Distributor_ID") ?? "Distributor_ID"])));
    if (out.distributor_master && !known.has(to)) throw new ScenarioError(`Distributor ${to} doesn't exist. Add it first.`);
    const from = target[distCol];
    for (const r of skus.rows) if (norm(r[skuCol]) === sku) r[distCol] = to;
    out.sku_master = write(skus);
    ops.push(`UPDATE sku_master SET distributor_id = ${q(to)} WHERE sku_id = ${q(sku)};  -- was ${from}`);
  }

  const overrides: Partial<EngineConfig> = {};
  if (req.festival_uplift === "off") {
    overrides.seasonal_uplift_pct = 0;
    ops.push(`-- override: festival uplift switched off for this scenario (seasonal_uplift_pct = 0)`);
  }
  if (!ops.length) throw new ScenarioError("Pick at least one change to simulate.");

  return {
    inputs: out,
    overrides,
    spec: { sku_id: sku, remove_history: req.remove_history, new_distributor: newDist, remap_to: req.remap_to ? norm(req.remap_to) : null, festival_uplift: req.festival_uplift ?? "rule", operations: ops },
  };
}
