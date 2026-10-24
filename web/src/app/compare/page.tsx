import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, Panel, StatusBadge, Tag } from "@/components/ui";
import { ALERT_LABEL, compareRuns } from "@/lib/compare";
import { fmtDate, fmtDateTime, units, weeks } from "@/lib/format";
import { reviewText } from "@/lib/issues";
import { loadRun } from "@/lib/runs";
import { getStore } from "@/lib/store";
import type { Recommendation } from "@/lib/engine/engine";

export const dynamic = "force-dynamic";

function Cell({ r, other }: { r: Recommendation | null; other: Recommendation | null }) {
  if (!r) return <span className="text-[12.5px] text-muted">Not in this run</span>;
  const qtyChanged = other && other.Recommended_Order_Qty !== r.Recommended_Order_Qty;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge action={r.Action} size="sm" />
        <span className={`tnum text-[13px] ${qtyChanged ? "font-semibold" : ""}`}>{units(r.Recommended_Order_Qty)} units</span>
      </div>
      <div className="tnum text-[12px] text-ink-2">
        {weeks(r.weeks_of_stock)} wks · demand {weeks(r.baseline_demand)}/wk · {r.weeks_observed_12w}/12 weeks of history · {r.Distributor_ID || "no distributor"}
      </div>
      {r.Action === "MANUAL_REVIEW" && <div className="text-[12px] text-crit">{reviewText(r)}</div>}
    </div>
  );
}

function Delta({ label, a, b, good }: { label: string; a: number; b: number; good: "up" | "down" | "none" }) {
  const d = b - a;
  const tone = d === 0 || good === "none" ? "text-muted" : (d > 0) === (good === "up") ? "text-ok" : "text-crit";
  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-paper-2 p-4">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className="tnum mt-1 font-display text-[24px] font-semibold tracking-tight">{units(a)} → {units(b)}</div>
      <div className={`tnum text-[12px] font-semibold ${tone}`}>{d === 0 ? "no change" : `${d > 0 ? "+" : ""}${units(d)}`}</div>
    </div>
  );
}

export default async function Compare({ searchParams }: PageProps<"/compare">) {
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  if (!run) notFound();
  const store = getStore();
  const runs = await store.listRuns();
  const baseId = typeof sp.base === "string" ? sp.base : run.base_run_id ?? runs.find((r) => r.source !== "scenario" && r.id !== run.id && r.created_at < run.created_at)?.id;
  const base = baseId ? await store.getRun(baseId) : null;

  if (!base) {
    return (
      <>
        <PageHeader eyebrow="Compare runs" title="Nothing to compare yet" sub="Comparisons appear once there are two runs: a new SAP export, or a scenario built from Data & runs." />
        <div className="p-10"><EmptyState title="Only one run so far" action={<Link className="text-[13px] font-semibold text-ok hover:underline" href="/data#scenario-lab">Build a scenario →</Link>}>Run the SKU009 simulation to see a comparison.</EmptyState></div>
      </>
    );
  }

  const cmp = compareRuns(base, run);
  const kb = base.result.summary.operational_kpis, ka = run.result.summary.operational_kpis;
  const isScenario = run.source === "scenario";

  return (
    <>
      <PageHeader eyebrow={isScenario ? "Scenario vs original" : "Run vs previous run"} title={isScenario ? "What the simulation changed" : "What changed since the last run"}
        sub={<>
          <b className="text-cream">Before:</b> {base.label} · evaluated {fmtDate(base.evaluation_date)} · {fmtDateTime(base.created_at)}<br />
          <b className="text-cream">After:</b> {run.label} · evaluated {fmtDate(run.evaluation_date)} · {fmtDateTime(run.created_at)} · by {run.created_by}
        </>}
        right={<div className="flex flex-wrap gap-2 text-[13px]">
          <Link href={`/?run=${run.id}`} className="rounded-[var(--radius)] bg-spice px-3 py-2 font-semibold text-night hover:bg-spice-hover">Open this run</Link>
          <Link href={`/?run=${base.id}`} className="rounded-[var(--radius)] border border-night-line px-3 py-2 font-semibold text-cream hover:bg-night-3">Open the original</Link>
        </div>} />

      <div className="mx-auto max-w-[1320px] space-y-6 px-4 py-8 sm:px-8 lg:px-10">
        {run.scenario && (
          <Panel eyebrow="Simulation" title="Operations applied to a copy of the original tables" sub="The original run and its data are untouched.">
            <pre className="overflow-x-auto rounded-[var(--radius)] bg-night px-4 py-3 font-mono text-[12.5px] leading-relaxed text-cream">{run.scenario.operations.join("\n")}</pre>
          </Panel>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Delta label="SKUs to reorder" a={kb.immediate_reorder_skus} b={ka.immediate_reorder_skus} good="none" />
          <Delta label="Units recommended" a={kb.total_recommended_order_units} b={ka.total_recommended_order_units} good="none" />
          <Delta label="Held for planner review" a={kb.skus_requiring_manual_review} b={ka.skus_requiring_manual_review} good="down" />
          <Delta label="SKUs in range" a={kb.optimal_level_skus} b={ka.optimal_level_skus} good="up" />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel eyebrow="Trust drift" title="Early warnings" sub="Shifts big enough that someone should look before approving.">
            {cmp.alerts.length ? (
              <ul className="space-y-3">
                {cmp.alerts.map((a, i) => (
                  <li key={i} className="text-[13px]">
                    <div className="flex flex-wrap items-center gap-2"><Tag tone={a.severity === "high" ? "crit" : "warn"}>{a.severity}</Tag><b className="font-semibold">{a.name}</b><span className="text-muted">· {ALERT_LABEL[a.code]}</span></div>
                    <p className="mt-0.5 text-ink-2">{a.detail}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-muted">No unusual shifts between these runs.</p>}
          </Panel>
          <Panel eyebrow="Data drift" title="What changed in the data itself" sub="New or removed SKUs and distributors, and changed file columns.">
            {cmp.drift.length ? (
              <ul className="space-y-2 text-[13px]">
                {cmp.drift.map((d, i) => <li key={i} className="flex gap-2"><Tag tone="plain">{d.code.replace(/_/g, " ").toLowerCase()}</Tag><span className="text-ink-2">{d.detail}</span></li>)}
              </ul>
            ) : <p className="text-[13px] text-muted">Same SKUs, distributors and file columns.</p>}
          </Panel>
        </div>

        <Panel eyebrow="Per SKU" title={`${cmp.changed.length} SKU${cmp.changed.length === 1 ? "" : "s"} changed`} sub="Only SKUs whose decision, quantity, data status, demand, cover or distributor moved.">
          {cmp.changed.length ? (
            <div className="-mx-5 overflow-x-auto sm:-mx-6">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.1em] text-muted">
                    <th className="py-2 pl-6 font-semibold">SKU</th><th className="px-3 py-2 font-semibold">Before</th><th className="px-3 py-2 font-semibold">After</th><th className="py-2 pl-3 pr-6 font-semibold">Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.changed.map((d) => (
                    <tr key={d.sku} className={`border-b border-line align-top last:border-0 ${run.scenario?.sku_id === d.sku ? "bg-spice/10" : ""}`}>
                      <td className="py-3 pl-6"><Link href={`/?run=${run.id}&sku=${d.sku}`} className="font-semibold hover:underline">{d.name}</Link><div className="font-mono text-[11.5px] text-muted">{d.sku}</div></td>
                      <td className="px-3 py-3"><Cell r={d.before} other={d.after} /></td>
                      <td className="px-3 py-3"><Cell r={d.after} other={d.before} /></td>
                      <td className="py-3 pl-3 pr-6"><div className="flex flex-wrap gap-1">{d.changed.map((c) => <Tag key={c} tone="plain">{c}</Tag>)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Identical decisions">Every SKU got the same decision in both runs.</EmptyState>}
        </Panel>

        <p className="text-[12.5px] text-muted">
          Compare a different pair: {runs.filter((r) => r.id !== run.id).slice(0, 6).map((r, i) => (
            <span key={r.id}>{i ? " · " : ""}<Link className="font-semibold text-ok hover:underline" href={`/compare?run=${run.id}&base=${r.id}`}>{r.source === "scenario" ? "scenario" : "run"} of {fmtDate(r.evaluation_date)}</Link></span>
          ))}
        </p>
      </div>
    </>
  );
}
