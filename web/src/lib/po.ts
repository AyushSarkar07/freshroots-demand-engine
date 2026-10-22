import { classify, KIND_LABEL } from "./decisions";
import type { DecisionRecord, RunRecord } from "./types";

export interface PoLine {
  distributor_id: string;
  distributor_name: string;
  sku_id: string;
  sku_name: string;
  qty: number;
  engine_qty: number;
  decision: string;
  approved_by: string;
  approved_at: string;
  note: string;
}

export interface PoGroup {
  distributor_id: string;
  distributor_name: string;
  distributor_status: string;
  lines: PoLine[];
  units: number;
}

/** Approved order lines, grouped by distributor: one purchase order per supplier. */
export function purchaseOrders(run: RunRecord, decisions: DecisionRecord[]): PoGroup[] {
  const recs = new Map(run.result.recommendations.map((r) => [r.SKU_ID, r]));
  const dist = run.result.distributors;
  const groups = new Map<string, PoGroup>();
  for (const d of decisions.filter((x) => x.decision === "order" && x.qty > 0).sort((a, b) => a.sku_id.localeCompare(b.sku_id))) {
    const r = recs.get(d.sku_id);
    if (!r) continue;
    const id = r.Distributor_ID || "UNASSIGNED";
    const g = groups.get(id) ?? { distributor_id: id, distributor_name: dist[id]?.name ?? "", distributor_status: dist[id]?.status ?? "", lines: [], units: 0 };
    g.lines.push({
      distributor_id: id, distributor_name: g.distributor_name, sku_id: r.SKU_ID, sku_name: r.SKU_Name, qty: d.qty,
      engine_qty: r.Recommended_Order_Qty, decision: KIND_LABEL[classify(d)], approved_by: d.actor, approved_at: d.decided_at, note: d.note,
    });
    g.units += d.qty;
    groups.set(id, g);
  }
  return [...groups.values()].sort((a, b) => a.distributor_id.localeCompare(b.distributor_id));
}

const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";

/** Column names are plain so they map onto Zoho Inventory's purchase-order import. */
export function poCsv(run: RunRecord, groups: PoGroup[]): string {
  const header = ["PO_Reference", "Vendor_ID", "Vendor_Name", "Item_SKU", "Item_Name", "Quantity", "Unit", "Engine_Recommended_Qty", "Decision", "Approved_By", "Approved_At", "Note"];
  const rows = groups.flatMap((g) => g.lines.map((l) => [
    `FR-${run.evaluation_date.replace(/-/g, "")}-${g.distributor_id}`, g.distributor_id, g.distributor_name, l.sku_id, l.sku_name, l.qty, "Units",
    l.engine_qty, l.decision, l.approved_by, l.approved_at, l.note,
  ]));
  return toCsv(header, rows);
}
