import { type NextRequest } from "next/server";
import { poCsv, purchaseOrders, toCsv } from "@/lib/po";
import { getStore } from "@/lib/store";

const RECOMMENDATION_COLUMNS = [
  "SKU_ID", "SKU_Name", "Category", "Perishability", "Units_On_Hand", "avg_12w_sales", "avg_4w_sales", "seasonal_uplift_pct",
  "baseline_demand", "demand_ratio", "demand_spurt_flag", "weeks_of_stock", "Flags", "Action", "Standard_Reorder_Qty",
  "effective_reorder_qty", "Recommended_Order_Qty", "Data_Quality_Status", "Data_Quality_Notes", "Review_Required", "Explanation",
  "Distributor_ID", "Location_Count", "Locations", "weeks_observed_12w", "weeks_observed_4w", "reorder_multiplier",
  "Inventory_Flag", "Indicative_Action", "Review_Reasons", "Evaluation_Date", "Inventory_As_Of_Date", "Sales_Cutoff_Week",
] as const;

const round4 = (v: unknown) => (typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v);

// CSV downloads: approved purchase orders (for Zoho), engine recommendations, and the data-quality report.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/runs/[id]/export">) {
  const { id } = await ctx.params;
  const type = req.nextUrl.searchParams.get("type") ?? "po";
  const store = getStore();
  const run = await store.getRun(id);
  if (!run) return new Response("Run not found", { status: 404 });

  let body: string;
  let name: string;
  if (type === "recommendations") {
    body = toCsv([...RECOMMENDATION_COLUMNS], run.result.recommendations.map((r) => RECOMMENDATION_COLUMNS.map((c) => round4(r[c]))));
    name = `reorder_recommendations_${run.evaluation_date}.csv`;
  } else if (type === "dq") {
    const cols = ["Source_File", "Row_Number", "SKU_ID", "Severity", "Issue_Code", "Detail", "Disposition", "Blocks_SKU"] as const;
    body = toCsv([...cols], run.result.data_quality.map((d) => cols.map((c) => d[c])));
    name = `data_quality_report_${run.evaluation_date}.csv`;
  } else if (type === "consolidated") {
    // The five input tables restructured into one row per SKU: master, distributor, stock and demand together.
    const cols = ["SKU_ID", "SKU_Name", "Category", "Perishability", "Distributor_ID", "Distributor_Name", "Distributor_Status", "Locations",
      "Units_On_Hand", "Inventory_As_Of_Date", "weeks_observed_12w", "avg_12w_sales", "avg_4w_sales", "demand_ratio", "baseline_demand",
      "weeks_of_stock", "Standard_Reorder_Qty", "Action", "Recommended_Order_Qty", "Data_Quality_Status"];
    const dist = run.result.distributors;
    body = toCsv(cols, run.result.recommendations.map((r) => cols.map((c) =>
      c === "Distributor_Name" ? dist[r.Distributor_ID]?.name ?? "" : c === "Distributor_Status" ? dist[r.Distributor_ID]?.status ?? "" : round4((r as unknown as Record<string, unknown>)[c]))));
    name = `consolidated_sku_table_${run.evaluation_date}.csv`;
  } else {
    if (run.source === "scenario") return new Response("Scenario runs are simulations and can't be exported as purchase orders.", { status: 409 });
    const distributor = req.nextUrl.searchParams.get("distributor");
    const groups = purchaseOrders(run, await store.listDecisions(id)).filter((g) => !distributor || g.distributor_id === distributor);
    body = poCsv(run, groups);
    name = `approved_purchase_orders_${run.evaluation_date}${distributor ? `_${distributor}` : ""}.csv`;
    await store.addEvent({
      run_id: id, sku_id: null, kind: "po_exported", actor: req.nextUrl.searchParams.get("by")?.trim() || "Unknown", at: new Date().toISOString(),
      detail: { distributor: distributor ?? "all", lines: groups.reduce((s, g) => s + g.lines.length, 0), units: groups.reduce((s, g) => s + g.units, 0) },
    });
  }
  return new Response(body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
