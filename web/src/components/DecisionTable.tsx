"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CoverBar } from "./CoverBar";
import { DecisionControls } from "./DecisionControls";
import { ActionChip, Pill } from "./ui";
import type { EngineConfig } from "@/lib/engine/config";
import type { Recommendation } from "@/lib/engine/engine";
import { units, weeks, withRun } from "@/lib/format";
import { reviewText } from "@/lib/issues";
import type { DecisionRecord } from "@/lib/types";

type Filter = "todo" | "all" | "IMMEDIATE_REORDER" | "PAUSE_ORDER" | "MANUAL_REVIEW" | "MAINTAIN";

const RANK: Record<string, number> = { IMMEDIATE_REORDER: 0, MANUAL_REVIEW: 1, PAUSE_ORDER: 2, MAINTAIN: 3 };

export function DecisionTable({ runId, recs, decisions, config }: {
  runId: string; recs: Recommendation[]; decisions: DecisionRecord[]; config: EngineConfig;
}) {
  const bySku = useMemo(() => new Map(decisions.map((d) => [d.sku_id, d])), [decisions]);
  const needsDecision = (r: Recommendation) => (r.Action === "IMMEDIATE_REORDER" || r.Action === "MANUAL_REVIEW") && !bySku.has(r.SKU_ID);
  const todo = recs.filter(needsDecision).length;
  const [filter, setFilter] = useState<Filter>(todo ? "todo" : "all");

  const count = (f: Filter) => (f === "all" ? recs.length : f === "todo" ? todo : recs.filter((r) => r.Action === f).length);
  const tabs: { f: Filter; label: string }[] = [
    { f: "todo", label: "Needs a decision" }, { f: "all", label: "All SKUs" }, { f: "IMMEDIATE_REORDER", label: "Reorder" },
    { f: "MANUAL_REVIEW", label: "Planner review" }, { f: "PAUSE_ORDER", label: "Pause" }, { f: "MAINTAIN", label: "In range" },
  ];
  const rows = recs
    .filter((r) => (filter === "all" ? true : filter === "todo" ? needsDecision(r) : r.Action === filter))
    .sort((a, b) => RANK[a.Action] - RANK[b.Action] || (a.weeks_of_stock ?? 1e9) - (b.weeks_of_stock ?? 1e9));

  const band = (r: Recommendation): [number, number] => (r.Perishability === "High"
    ? [config.high_perish_stockout_weeks, config.high_perish_overstock_weeks]
    : [config.low_perish_stockout_weeks, config.low_perish_overstock_weeks]);

  return (
    <div>
      <div className="mb-3 flex gap-1 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button key={t.f} role="tab" aria-selected={filter === t.f} onClick={() => setFilter(t.f)}
            className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12.5px] ${filter === t.f ? "bg-ink text-page font-medium" : "text-ink-2 hover:bg-page"}`}>
            {t.label} <span className="tnum opacity-70">{count(t.f)}</span>
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-[13px] text-ink-2">
          {filter === "todo" ? "Every reorder and review in this run has a decision. Approved lines are on Purchase orders." : "No SKUs in this view."}
        </div>
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[920px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] font-medium uppercase tracking-wide text-muted">
                <th className="py-2 pl-4 pr-3 font-medium sm:pl-0">Product</th>
                <th className="px-3 py-2 font-medium">Weeks of stock vs range</th>
                <th className="px-3 py-2 text-right font-medium">Demand / wk</th>
                <th className="px-3 py-2 font-medium">Engine says</th>
                <th className="py-2 pl-3 pr-4 font-medium sm:pr-0">Your decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [lo, hi] = band(r);
                return (
                  <tr key={r.SKU_ID} className="border-b border-line align-top last:border-0">
                    <td className="py-3 pl-4 pr-3 sm:pl-0">
                      <Link href={withRun(`/sku/${r.SKU_ID}`, runId)} className="font-medium hover:text-accent hover:underline">{r.SKU_Name.replace(/^Freshroots /, "")}</Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                        <span className="font-mono text-[11.5px]">{r.SKU_ID}</span>· {r.Category}
                        {r.Perishability === "High" && <Pill tone="info" title="High perishability: tighter 3–4 week range">Perishable</Pill>}
                        {r.Data_Quality_Status !== "OK" && <Pill tone={r.Data_Quality_Status === "ERROR" ? "bad" : "warn"} title={r.Data_Quality_Notes}>{r.Data_Quality_Status === "ERROR" ? "× Data error" : "! Data warning"}</Pill>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <CoverBar cover={r.weeks_of_stock} lo={lo} hi={hi} action={r.Action} />
                        <span className="tnum w-14 text-right font-medium">{weeks(r.weeks_of_stock)}</span>
                      </div>
                      <div className="tnum text-[11.5px] text-muted">{units(r.Units_On_Hand)} on hand · range {lo}–{hi} wks</div>
                    </td>
                    <td className="tnum px-3 py-3 text-right">
                      <div>{weeks(r.baseline_demand)}</div>
                      <div className="text-[11.5px] text-muted">
                        {r.demand_spurt_flag ? <Pill tone="bad" title="4-week average more than 20% above the 12-week average">Surge ×{r.demand_ratio?.toFixed(2)}</Pill> : r.demand_ratio != null ? `ratio ${r.demand_ratio.toFixed(2)}` : "—"}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <ActionChip action={r.Action} />
                      <div className="tnum mt-1 text-[12px] text-ink-2">
                        {r.Action === "IMMEDIATE_REORDER" ? `${units(r.Recommended_Order_Qty)} units${r.demand_spurt_flag ? ` (${units(r.Standard_Reorder_Qty)} × 1.5)` : ""}` : r.Action === "MANUAL_REVIEW" ? reviewText(r) : r.Action === "PAUSE_ORDER" ? "Skip the next order" : "No order"}
                      </div>
                    </td>
                    <td className="w-[250px] py-3 pl-3 pr-4 sm:pr-0">
                      <DecisionControls runId={runId} rec={r} decision={bySku.get(r.SKU_ID) ?? null} compact />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
