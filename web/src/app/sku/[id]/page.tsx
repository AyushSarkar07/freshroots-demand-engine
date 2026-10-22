import Link from "next/link";
import { notFound } from "next/navigation";
import { CoverBar } from "@/components/CoverBar";
import { DecisionControls } from "@/components/DecisionControls";
import { SalesChart } from "@/components/SalesChart";
import { ActionChip, Card, DqChip, Pill } from "@/components/ui";
import { fmtDateTime, units, weeks, withRun } from "@/lib/format";
import { reviewText } from "@/lib/issues";
import { loadRun } from "@/lib/runs";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function SkuPage({ params, searchParams }: PageProps<"/sku/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  const rec = run?.result.recommendations.find((r) => r.SKU_ID === id);
  if (!run || !rec) notFound();

  const store = getStore();
  const [decisions, events] = await Promise.all([store.listDecisions(run.id), store.listEvents(run.id, id)]);
  const decision = decisions.find((d) => d.sku_id === id) ?? null;
  const c = run.result.config;
  const [lo, hi] = rec.Perishability === "High" ? [c.high_perish_stockout_weeks, c.high_perish_overstock_weeks] : [c.low_perish_stockout_weeks, c.low_perish_overstock_weeks];
  const dist = run.result.distributors[rec.Distributor_ID];
  const history = run.result.history[id] ?? [];

  const facts: [string, string, string?][] = [
    ["Units on hand", units(rec.Units_On_Hand), rec.Location_Count > 1 ? `summed across ${rec.Locations}` : rec.Locations],
    ["12-week average", `${weeks(rec.avg_12w_sales)} / wk`, `${rec.weeks_observed_12w} of ${c.long_window_weeks} weeks observed`],
    ["4-week average", `${weeks(rec.avg_4w_sales)} / wk`, rec.demand_ratio != null ? `ratio ${rec.demand_ratio.toFixed(3)} vs surge threshold ${c.surge_ratio_threshold.toFixed(2)}` : "ratio undefined"],
    ["Seasonal uplift", `+${rec.seasonal_uplift_pct}%`, rec.seasonal_uplift_pct ? "festival month" : "not a festival month"],
    ["Baseline demand", `${weeks(rec.baseline_demand)} / wk`, "12-week average × uplift"],
    ["Weeks of stock", weeks(rec.weeks_of_stock), `allowed range ${lo}–${hi} weeks (${rec.Perishability.toLowerCase()} perishability)`],
    ["Standard reorder", units(rec.Standard_Reorder_Qty), rec.demand_spurt_flag ? `× ${rec.reorder_multiplier} surge multiplier = ${units(rec.effective_reorder_qty)}` : "no surge multiplier"],
    ["Distributor", rec.Distributor_ID, dist ? `${dist.name}${dist.status && dist.status !== "Active" ? ` (${dist.status})` : ""}` : ""],
  ];

  return (
    <div className="space-y-4">
      <Link href={withRun("/", run.id)} className="text-[12.5px] text-accent">← All decisions</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-[26px] leading-tight tracking-tight">{rec.SKU_Name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
            <span className="font-mono">{rec.SKU_ID}</span>· {rec.Category} ·
            <Pill tone={rec.Perishability === "High" ? "info" : "plain"}>{rec.Perishability} perishability</Pill>
            {rec.demand_spurt_flag && <Pill tone="bad">Demand surge</Pill>}
            <DqChip status={rec.Data_Quality_Status} />
          </div>
        </div>
        <div className="text-right">
          <ActionChip action={rec.Action} />
          {rec.Action === "IMMEDIATE_REORDER" && <div className="tnum mt-1 text-[20px] font-semibold">{units(rec.Recommended_Order_Qty)} units</div>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Why the engine says this">
            <p className="text-[14px] leading-relaxed text-ink-2">{rec.Explanation}</p>
            <div className="mt-4 flex items-center gap-3">
              <CoverBar cover={rec.weeks_of_stock} lo={lo} hi={hi} action={rec.Action} width={320} labels />
              <span className="tnum text-[13px] font-medium">{weeks(rec.weeks_of_stock)} weeks of stock</span>
            </div>
          </Card>

          <Card title="Weekly sales" sub={`Through ${run.result.sales_cutoff_week}. The 4-week average is compared with the 12-week average to detect a surge.`}>
            <SalesChart history={history} avg12={rec.avg_12w_sales} avg4={rec.avg_4w_sales} baseline={rec.baseline_demand}
              longWeeks={c.long_window_weeks} shortWeeks={c.short_window_weeks} />
          </Card>

          <Card title="The numbers">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(([k, v, note]) => (
                <div key={k} className="border-b border-line pb-2">
                  <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{k}</dt>
                  <dd className="tnum text-[15px] font-medium">{v}</dd>
                  {note && <dd className="text-[12px] text-ink-2">{note}</dd>}
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Decision" sub={rec.Action === "MANUAL_REVIEW" ? `The rules can't decide this SKU: ${reviewText(rec)}. Raghav's call.` : "Approve the engine's quantity, or change it with a reason."}>
            <DecisionControls runId={run.id} rec={rec} decision={decision} />
          </Card>

          <Card title="Data checks">
            {rec.Data_Quality_Notes ? (
              <ul className="space-y-1.5 text-[12.5px] text-ink-2">
                {rec.Data_Quality_Notes.split(" | ").map((n) => {
                  const [code, ...rest] = n.split(": ");
                  return <li key={n}><span className="font-mono text-[11.5px] text-ink">{code}</span> {rest.join(": ")}</li>;
                })}
              </ul>
            ) : <p className="text-[12.5px] text-good">✓ No data issues for this SKU.</p>}
          </Card>

          <Card title="History">
            {events.length ? (
              <ol className="space-y-2 text-[12.5px]">
                {events.map((e) => (
                  <li key={e.id} className="border-l-2 border-line pl-2">
                    <div className="text-ink">{e.kind === "decision" ? String(e.detail.kind) : "Decision undone"}{e.kind === "decision" && e.detail.decision === "order" ? ` · ${units(Number(e.detail.qty))} units` : ""}</div>
                    <div className="text-muted">{e.actor} · {fmtDateTime(e.at)}</div>
                    {typeof e.detail.note === "string" && e.detail.note && <div className="text-ink-2">“{e.detail.note}”</div>}
                  </li>
                ))}
              </ol>
            ) : <p className="text-[12.5px] text-muted">No decisions yet.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
