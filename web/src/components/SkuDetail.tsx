import type { ReactNode } from "react";
import { CoverGauge, coverWord } from "./CoverGauge";
import { DecisionControls } from "./DecisionControls";
import { DemandPulse } from "./DemandPulse";
import { Eyebrow, StatusBadge, Tag } from "./ui";
import type { EngineConfig } from "@/lib/engine/config";
import type { Recommendation } from "@/lib/engine/engine";
import { units, weeks } from "@/lib/format";
import { coverRange, demandTrend, TREND_LABEL } from "@/lib/insights";
import { reviewText } from "@/lib/issues";
import type { DecisionRecord } from "@/lib/types";

function Fact({ k, v, note, strong = false }: { k: string; v: ReactNode; note?: ReactNode; strong?: boolean }) {
  return (
    <div className="border-t border-line pt-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{k}</dt>
      <dd className={`tnum mt-0.5 ${strong ? "font-display text-[22px] font-semibold tracking-tight" : "text-[15px] font-semibold"}`}>{v}</dd>
      {note && <dd className="text-[12px] text-ink-2">{note}</dd>}
    </div>
  );
}

/** Dark identity header shared by the drawer and the full SKU page. */
export function SkuHeader({ rec, distributor, titleId, right }: { rec: Recommendation; distributor?: { name: string; status: string }; titleId?: string; right?: ReactNode }) {
  return (
    <div className="on-dark relative overflow-hidden bg-forest px-6 pb-6 pt-5 text-ivory">
      <div className="coord-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow dark>{rec.SKU_ID} · {rec.Category} · {rec.Perishability} perishability</Eyebrow>
          <h2 id={titleId} className="font-display text-[26px] font-semibold leading-tight tracking-[-0.015em]">{rec.SKU_Name.replace(/^Freshroots\s+/i, "")}</h2>
          {distributor && <div className="mt-1 text-[12.5px] text-sage">Supplied by {distributor.name || rec.Distributor_ID}{distributor.status && distributor.status !== "Active" ? ` (${distributor.status})` : ""}</div>}
        </div>
        {right}
      </div>
      <div className="relative mt-4 flex flex-wrap items-end justify-between gap-3">
        <StatusBadge action={rec.Action} />
        {rec.Action === "IMMEDIATE_REORDER" && (
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sage">Recommended</div>
            <div className="tnum font-display text-[30px] font-semibold leading-none text-lime">{units(rec.Recommended_Order_Qty)}<span className="ml-1 text-[14px] font-medium text-sage">units</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SkuBody({ runId, rec, decision, history, config }: {
  runId: string; rec: Recommendation; decision: DecisionRecord | null; history: { week: string; units: number }[]; config: EngineConfig;
}) {
  const range = coverRange(rec.Perishability, config);
  const cw = coverWord(rec.weeks_of_stock, range);
  const trend = demandTrend(rec);

  return (
    <div className="space-y-6 px-6 py-6">
      <section aria-label="Decision" className="rounded-[var(--radius-lg)] border border-line bg-paper p-4">
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Your decision</div>
        {rec.Action === "MANUAL_REVIEW" && <p className="mb-3 text-[13px] text-ink-2">The rules can&apos;t decide this SKU: {reviewText(rec)}. This is Raghav&apos;s call.</p>}
        <DecisionControls runId={runId} rec={rec} decision={decision} />
      </section>

      <section aria-label="Stock cover">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-semibold">Stock cover</h3>
          <span className={`text-[12.5px] font-semibold ${cw.text}`}>{cw.word}</span>
        </div>
        <CoverGauge weeks={rec.weeks_of_stock} range={range} onHand={rec.Units_On_Hand} demand={rec.baseline_demand} size="lg" />
        <p className="tnum mt-3 text-[13px] text-ink-2">
          <b className="font-display text-[20px] font-semibold text-ink">{weeks(rec.weeks_of_stock)}</b> weeks of stock · {units(rec.Units_On_Hand)} units on hand
          {rec.Location_Count > 1 ? ` across ${rec.Location_Count} warehouses` : ""}
        </p>
      </section>

      <section aria-label="Demand pulse">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-semibold">Demand pulse</h3>
          <span className="text-[12px] text-muted">last {config.short_window_weeks} weeks vs {config.long_window_weeks}-week baseline</span>
        </div>
        <DemandPulse rec={rec} history={history} threshold={config.surge_ratio_threshold} longWeeks={config.long_window_weeks} shortWeeks={config.short_window_weeks} />
      </section>

      <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
        <Fact k="12-week average" v={`${weeks(rec.avg_12w_sales)} / wk`} note={`${rec.weeks_observed_12w} of ${config.long_window_weeks} weeks observed`} />
        <Fact k="4-week average" v={`${weeks(rec.avg_4w_sales)} / wk`} />
        <Fact k="Demand ratio" v={rec.demand_ratio != null ? rec.demand_ratio.toFixed(3) : "—"}
          note={trend === "surge" ? `Surge: above ${config.surge_ratio_threshold.toFixed(2)}, reorder ×${config.surge_reorder_multiplier}` : `${TREND_LABEL[trend]} · surge line ${config.surge_ratio_threshold.toFixed(2)}`} />
        <Fact k="Seasonal adjustment" v={rec.seasonal_uplift_pct ? `+${rec.seasonal_uplift_pct}%` : "None"} note={rec.seasonal_uplift_pct ? "Festival month" : "Not a festival month"} />
        <Fact k="Baseline demand" v={`${weeks(rec.baseline_demand)} / wk`} note="12-week average × seasonal adjustment" />
        <Fact k="Standard reorder" v={units(rec.Standard_Reorder_Qty)} note="From the SKU master" />
        <Fact k="Effective reorder" v={units(rec.effective_reorder_qty)} note={rec.reorder_multiplier !== 1 ? `× ${rec.reorder_multiplier} surge multiplier, rounded ${config.reorder_rounding === "ceil" ? "up" : config.reorder_rounding}` : "No multiplier"} />
        <Fact k="Recommended" v={rec.Action === "IMMEDIATE_REORDER" ? units(rec.Recommended_Order_Qty) : "0"} strong
          note={rec.Action === "IMMEDIATE_REORDER" ? "Ordered only after approval" : rec.Action === "MANUAL_REVIEW" ? "Held for the planner" : "No order this cycle"} />
      </dl>

      <section aria-label="Engine explanation">
        <h3 className="mb-1.5 text-[13px] font-semibold">Why the engine says this</h3>
        <p className="rounded-[var(--radius)] bg-paper-3 px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink-2">{rec.Explanation}</p>
      </section>

      <section aria-label="Data checks">
        <h3 className="mb-1.5 text-[13px] font-semibold">Data checks</h3>
        {rec.Data_Quality_Notes ? (
          <ul className="space-y-1.5 text-[12.5px] text-ink-2">
            {rec.Data_Quality_Notes.split(" | ").map((n) => {
              const [code, ...rest] = n.split(": ");
              return <li key={n} className="flex gap-2"><Tag tone={rec.Data_Quality_Status === "ERROR" ? "crit" : "warn"}>{code}</Tag><span>{rest.join(": ")}</span></li>;
            })}
          </ul>
        ) : <p className="text-[12.5px] font-medium text-ok">No data issues for this SKU.</p>}
      </section>
    </div>
  );
}
