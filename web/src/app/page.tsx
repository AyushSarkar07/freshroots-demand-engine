import Link from "next/link";
import { DecisionTable } from "@/components/DecisionTable";
import { Card, Empty, Pill, Stat } from "@/components/ui";
import { approvalStats } from "@/lib/decisions";
import { fmtDate, pct, units, withRun } from "@/lib/format";
import { loadRun } from "@/lib/runs";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Decisions({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  if (!run) return <Empty>No runs yet. Upload an SAP export on <Link className="text-accent underline" href="/data">Data & runs</Link>.</Empty>;

  const decisions = await getStore().listDecisions(run.id);
  const r = run.result;
  const k = r.summary.operational_kpis;
  const dq = r.summary.data_quality;
  const stats = approvalStats(run, decisions);
  const uplift = r.recommendations[0]?.seasonal_uplift_pct ?? 0;
  const cal = r.calendar;
  const brief = run.brief;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[28px] leading-tight tracking-tight">Reorder decisions</h1>
          <p className="mt-1 text-[13px] text-ink-2">
            Evaluated <b className="font-medium text-ink">{fmtDate(run.evaluation_date)}</b> · sales through {r.sales_cutoff_week} · stock as of{" "}
            {r.inventory_snapshot_dates.map(fmtDate).join(", ") || "—"} · {run.label}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {uplift > 0 ? <Pill tone="accent" title="Festival months: October, November, March">+{uplift}% festival uplift</Pill> : <Pill>No festival uplift</Pill>}
          {cal.evaluation_month_calendar_festival != null && (
            <Pill tone={cal.evaluation_month_calendar_festival === cal.evaluation_month_rule_festival ? "good" : "warn"}>
              {cal.evaluation_month_calendar_festival === cal.evaluation_month_rule_festival ? "✓ Calendar agrees" : "! Calendar disagrees"}
            </Pill>
          )}
          <Link href={withRun("/data", run.id)}>
            {dq.errors ? <Pill tone="bad">× {dq.skus_blocked} SKU(s) held: data errors</Pill> : dq.warnings ? <Pill tone="warn">! {dq.warnings} data warning(s)</Pill> : <Pill tone="good">✓ All data checks passed</Pill>}
          </Link>
        </div>
      </div>

      {brief && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="max-w-3xl text-[17px] font-semibold leading-snug">{brief.headline}</h2>
            <span className="text-[11.5px] text-muted" title={brief.fallback_reason ?? undefined}>
              {brief.source === "gemini" ? `Drafted by Gemini from the engine's output · numbers checked` : "Planner brief (template)"}
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-[13.5px] text-ink-2">
            {brief.bullets.map((b, i) => <li key={i} className="flex gap-2"><span aria-hidden className="text-muted">–</span><span>{b}</span></li>)}
          </ul>
          {brief.watch.length > 0 && (
            <div className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
              <b className="font-semibold">Close to a threshold</b>, so a small change in sales would flip the decision:
              <ul className="mt-1 space-y-0.5">{brief.watch.map((w, i) => <li key={i}>· {w.replace(/\.$/, "")}</li>)}</ul>
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Reorder now" value={k.immediate_reorder_skus} tone={k.immediate_reorder_skus ? "bad" : undefined} note={`${units(k.total_recommended_order_units)} units recommended`} />
        <Stat label="Pause next order" value={k.pause_order_skus} tone={k.pause_order_skus ? "info" : undefined} note="Overstocked for their range" />
        <Stat label="In range" value={`${k.optimal_level_skus}/${k.total_skus_in_master}`} note={pct(k.total_skus_in_master ? k.optimal_level_skus / k.total_skus_in_master : null) + " of SKUs"} />
        <Stat label="Planner review" value={k.skus_requiring_manual_review} tone={k.skus_requiring_manual_review ? "warn" : undefined} note="Rules can't decide these" />
        <Stat label="Decided" value={`${stats.decided}/${stats.actionable}`} tone={stats.actionable && stats.decided === stats.actionable ? "good" : undefined}
          note={<Link className="text-accent hover:underline" href={withRun("/orders", run.id)}>{units(stats.approvedUnits)} units approved →</Link>} />
      </div>

      <Card title="Every SKU, one decision" sub="The rules decide; you approve. Changing or rejecting a recommendation needs a short reason, and every decision is logged with your name.">
        <DecisionTable runId={run.id} recs={r.recommendations} decisions={decisions} config={r.config} />
      </Card>
    </div>
  );
}
