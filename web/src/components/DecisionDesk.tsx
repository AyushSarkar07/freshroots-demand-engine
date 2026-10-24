"use client";
import { useMemo, useState } from "react";
import type { Filter } from "./Bento";
import { CoverGauge } from "./CoverGauge";
import { DecisionControls } from "./DecisionControls";
import { IconSearch } from "./icons";
import { DqTag, EmptyState, StatusBadge, Tag } from "./ui";
import type { EngineConfig } from "@/lib/engine/config";
import type { Recommendation } from "@/lib/engine/engine";
import { units, weeks } from "@/lib/format";
import { coverRange, demandTrend, shortName, TREND_LABEL } from "@/lib/insights";
import { reviewText } from "@/lib/issues";
import type { DecisionRecord } from "@/lib/types";

type Sort = "urgency" | "cover" | "qty" | "name";
const RANK: Record<string, number> = { IMMEDIATE_REORDER: 0, MANUAL_REVIEW: 1, PAUSE_ORDER: 2, MAINTAIN: 3 };
const TREND_CLS: Record<string, string> = { surge: "text-crit", rising: "text-warn", stable: "text-ok", falling: "text-ink-2", unavailable: "text-muted" };

export function DecisionDesk({ runId, recs, decisions, config, filter, setFilter, selected, onOpen, readOnly = false }: {
  runId: string; recs: Recommendation[]; decisions: DecisionRecord[]; config: EngineConfig; readOnly?: boolean;
  filter: Filter; setFilter: (f: Filter) => void; selected: string | null; onOpen: (sku: string) => void;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("urgency");
  const bySku = useMemo(() => new Map(decisions.map((d) => [d.sku_id, d])), [decisions]);
  const needs = (r: Recommendation) => (r.Action === "IMMEDIATE_REORDER" || r.Action === "MANUAL_REVIEW") && !bySku.has(r.SKU_ID);

  const count = (f: Filter) => (f === "all" ? recs.length : f === "todo" ? recs.filter(needs).length : recs.filter((r) => r.Action === f).length);
  const tabs: { f: Filter; label: string }[] = [
    { f: "todo", label: "Needs a decision" }, { f: "all", label: "All SKUs" }, { f: "IMMEDIATE_REORDER", label: "Reorder" },
    { f: "PAUSE_ORDER", label: "Pause" }, { f: "MAINTAIN", label: "In range" }, { f: "MANUAL_REVIEW", label: "Planner review" },
  ];
  const needle = q.trim().toLowerCase();
  const rows = recs
    .filter((r) => (filter === "all" ? true : filter === "todo" ? needs(r) : r.Action === filter))
    .filter((r) => !needle || `${r.SKU_Name} ${r.SKU_ID} ${r.Category}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === "name") return a.SKU_Name.localeCompare(b.SKU_Name);
      if (sort === "qty") return b.Recommended_Order_Qty - a.Recommended_Order_Qty || (a.weeks_of_stock ?? 1e9) - (b.weeks_of_stock ?? 1e9);
      if (sort === "cover") return (a.weeks_of_stock ?? 1e9) - (b.weeks_of_stock ?? 1e9);
      return RANK[a.Action] - RANK[b.Action] || (a.weeks_of_stock ?? 1e9) - (b.weeks_of_stock ?? 1e9);
    });

  return (
    <section id="desk" aria-labelledby="desk-title" className="scroll-mt-24 rounded-[var(--radius-xl)] border border-line bg-paper-2 shadow-[var(--shadow-1)]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 pb-4 pt-5 sm:px-6">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">The decision desk</div>
          <h2 id="desk-title" className="font-display text-[24px] font-semibold tracking-tight">Every SKU, one decision</h2>
          <p className="mt-1 max-w-xl text-[13px] text-muted">The rules recommend; you decide. Changing or rejecting a recommendation needs a reason, and every decision is logged with your name.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <label className="relative flex-1 sm:flex-none">
            <span className="sr-only">Search SKUs</span>
            <IconSearch width={15} height={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or SKU"
              className="h-9 w-full rounded-[var(--radius)] border border-line-strong bg-paper pl-8 pr-3 text-[13px] sm:w-56" />
          </label>
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <span className="sr-only sm:not-sr-only">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 rounded-[var(--radius)] border border-line-strong bg-paper px-2 text-[13px] text-ink">
              <option value="urgency">Most urgent first</option>
              <option value="cover">Lowest cover first</option>
              <option value="qty">Largest order first</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
        </div>
      </header>

      <div role="tablist" aria-label="Filter SKUs" className="flex gap-1 overflow-x-auto border-b border-line px-4 py-2 sm:px-5">
        {tabs.map((t) => {
          const on = filter === t.f;
          return (
            <button key={t.f} role="tab" aria-selected={on} onClick={() => setFilter(t.f)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] transition-colors duration-150 ${on ? "bg-night font-semibold text-cream" : "text-ink-2 hover:bg-paper-3"}`}>
              {t.label}
              <span className={`tnum rounded-full px-1.5 text-[11px] ${on ? "bg-spice text-night" : "bg-paper-3 text-muted"}`}>{count(t.f)}</span>
            </button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        filter === "todo" && !needle
          ? <EmptyState title="The desk is clear">Every reorder and planner review in this run has a decision. Approved lines are waiting on Purchase orders.</EmptyState>
          : <EmptyState title="No SKUs in this view">{needle ? `Nothing matches “${q}”.` : "Try another filter."}</EmptyState>
      ) : (
        <table className="w-full border-collapse text-[13px] max-md:block">
          <thead className="max-md:hidden">
            <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-muted">
              <th className="py-3 pl-6 pr-3 font-semibold">Product</th>
              <th className="px-3 py-3 font-semibold">Weeks of stock vs range</th>
              <th className="px-3 py-3 text-right font-semibold">Demand / wk</th>
              <th className="px-3 py-3 font-semibold">Engine recommends</th>
              <th className="py-3 pl-3 pr-6 font-semibold">Decision</th>
            </tr>
          </thead>
          <tbody className="max-md:block">
            {rows.map((r) => {
              const range = coverRange(r.Perishability, config);
              const trend = demandTrend(r);
              const isSel = selected === r.SKU_ID;
              return (
                <tr key={r.SKU_ID} onClick={() => onOpen(r.SKU_ID)}
                  className={`cursor-pointer border-t border-line align-top transition-colors duration-150 max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-3 max-md:px-5 max-md:py-4 ${isSel ? "bg-spice/15" : "hover:bg-paper"}`}>
                  <td className={`relative py-4 pl-6 pr-3 max-md:col-span-2 max-md:p-0 ${isSel ? "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-spice-deep" : ""}`}>
                    <button onClick={(e) => { e.stopPropagation(); onOpen(r.SKU_ID); }} className="text-left font-semibold hover:underline">{shortName(r.SKU_Name)}</button>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                      <span className="font-mono text-[11.5px]">{r.SKU_ID}</span>· {r.Category}
                      {r.Perishability === "High" && <Tag tone="plain" title={`High perishability: ${range.lo}–${range.hi} week range`}>Perishable</Tag>}
                      <DqTag status={r.Data_Quality_Status} notes={r.Data_Quality_Notes} />
                    </div>
                  </td>
                  <td className="px-3 py-4 max-md:col-span-2 max-md:p-0">
                    <div className="flex items-center gap-3">
                      <div className="w-full max-w-[180px]"><CoverGauge weeks={r.weeks_of_stock} range={range} onHand={r.Units_On_Hand} demand={r.baseline_demand} /></div>
                      <span className="tnum w-12 shrink-0 text-right text-[14px] font-semibold">{weeks(r.weeks_of_stock)}</span>
                    </div>
                    <div className="tnum mt-1 text-[11.5px] text-muted">{units(r.Units_On_Hand)} on hand · range {range.lo}–{range.hi} wks</div>
                  </td>
                  <td className="tnum px-3 py-4 text-right max-md:p-0 max-md:text-left">
                    <div className="font-semibold">{weeks(r.baseline_demand)}</div>
                    <div className={`text-[11.5px] font-medium ${TREND_CLS[trend]}`}>{r.demand_ratio != null ? `${r.demand_ratio.toFixed(2)}× ` : ""}{TREND_LABEL[trend]}</div>
                  </td>
                  <td className="px-3 py-4 max-md:p-0">
                    <StatusBadge action={r.Action} size="sm" />
                    <div className="tnum mt-1.5 text-[12px] text-ink-2">
                      {r.Action === "IMMEDIATE_REORDER" ? <><b className="font-semibold text-ink">{units(r.Recommended_Order_Qty)}</b> units{r.demand_spurt_flag ? ` (${units(r.Standard_Reorder_Qty)} × ${r.reorder_multiplier})` : ""}</>
                        : r.Action === "MANUAL_REVIEW" ? reviewText(r) : r.Action === "PAUSE_ORDER" ? "Skip the next order" : "No order"}
                    </div>
                  </td>
                  <td className="w-[270px] py-4 pl-3 pr-6 max-md:col-span-2 max-md:w-auto max-md:p-0" onClick={(e) => e.stopPropagation()}>
                    <DecisionControls runId={runId} rec={r} decision={bySku.get(r.SKU_ID) ?? null} compact readOnly={readOnly} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
