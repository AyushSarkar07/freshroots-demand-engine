import Link from "next/link";
import { notFound } from "next/navigation";
import { SalesChart } from "@/components/SalesChart";
import { SkuBody, SkuHeader } from "@/components/SkuDetail";
import { Panel } from "@/components/ui";
import { fmtDateTime, units, withRun } from "@/lib/format";
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
  const history = run.result.history[id] ?? [];

  return (
    <>
      <SkuHeader rec={rec} distributor={run.result.distributors[rec.Distributor_ID]}
        right={<Link href={withRun("/", run.id)} className="shrink-0 text-[12.5px] font-semibold text-spice hover:underline">← Decision desk</Link>} />
      <div className="mx-auto grid max-w-[1320px] gap-6 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:px-10">
        <div className="overflow-hidden rounded-[var(--radius-xl)] border border-line bg-paper-2 shadow-[var(--shadow-1)]">
          <SkuBody runId={run.id} rec={rec} decision={decision} history={history} config={c} readOnly={run.source === "scenario"} />
        </div>
        <div className="space-y-6">
          <Panel eyebrow="History" title="Weekly sales" sub={`Through ${run.result.sales_cutoff_week}. The 4-week average is compared with the 12-week average to detect a surge.`}>
            <SalesChart history={history} avg12={rec.avg_12w_sales} avg4={rec.avg_4w_sales} baseline={rec.baseline_demand} longWeeks={c.long_window_weeks} shortWeeks={c.short_window_weeks} />
          </Panel>
          <Panel eyebrow="Audit" title="Decision history">
            {events.length ? (
              <ol className="relative space-y-3 border-l border-line pl-5">
                {events.map((e) => (
                  <li key={e.id} className="relative text-[13px]">
                    <span aria-hidden className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-night" />
                    <div>{e.kind === "decision" ? String(e.detail.kind) : "Decision undone"}{e.kind === "decision" && e.detail.decision === "order" ? ` · ${units(Number(e.detail.qty))} units` : ""}</div>
                    <div className="text-[12px] text-muted">{e.actor} · {fmtDateTime(e.at)}{typeof e.detail.note === "string" && e.detail.note ? <span className="text-ink-2"> · “{e.detail.note}”</span> : null}</div>
                  </li>
                ))}
              </ol>
            ) : <p className="text-[13px] text-muted">No decisions on this SKU yet.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
