import Link from "next/link";
import { ExportButton } from "@/components/ExportButton";
import { IconArrowUpRight } from "@/components/icons";
import { EmptyState, PageHeader, Panel, Stat, StatusBadge, Tag } from "@/components/ui";
import { approvalStats, classify, KIND_LABEL } from "@/lib/decisions";
import { fmtDate, fmtDateTime, pct, units, withRun } from "@/lib/format";
import { shortName } from "@/lib/insights";
import { purchaseOrders } from "@/lib/po";
import { loadRun } from "@/lib/runs";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Orders({ searchParams }: PageProps<"/orders">) {
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  if (!run) return <div className="p-10"><EmptyState title="No runs yet">Upload an SAP export on Data &amp; runs first.</EmptyState></div>;

  const store = getStore();
  const [decisions, events] = await Promise.all([store.listDecisions(run.id), store.listEvents(run.id)]);
  const groups = purchaseOrders(run, decisions);
  const stats = approvalStats(run, decisions);
  const recs = new Map(run.result.recommendations.map((r) => [r.SKU_ID, r]));
  const pending = run.result.recommendations.filter((r) => (r.Action === "IMMEDIATE_REORDER" || r.Action === "MANUAL_REVIEW") && !decisions.some((d) => d.sku_id === r.SKU_ID));
  const notOrdering = decisions.filter((d) => d.decision === "no_order");
  const lines = groups.reduce((s, g) => s + g.lines.length, 0);
  const history = events.filter((e) => e.kind === "decision" || e.kind === "decision_cleared" || e.kind === "po_exported");
  const lastExport = events.find((e) => e.kind === "po_exported");
  const stamp = run.evaluation_date.replace(/-/g, "");

  return (
    <>
      <PageHeader eyebrow="Purchase orders" title="From approval to Zoho"
        sub={`Approved lines from the run evaluated ${fmtDate(run.evaluation_date)}, one purchase order per distributor. Export the CSV and import it into Zoho Inventory. Nothing is sent to a supplier from here.`}
        right={groups.length > 0 && (
          <ExportButton href={`/api/runs/${run.id}/export?type=po`} label="Export all approved lines" pending={pending.length} lines={lines}
            filename={`approved_purchase_orders_${run.evaluation_date}.csv`} />
        )} />

      <div className="mx-auto max-w-[1320px] space-y-6 px-4 py-8 sm:px-8 lg:px-10">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Approved" value={units(stats.approvedUnits)} note={`${lines} line${lines === 1 ? "" : "s"} · ${groups.length} distributor${groups.length === 1 ? "" : "s"}`} tone={stats.approvedUnits ? "ok" : undefined} />
          <Stat label="Awaiting decision" value={pending.length} tone={pending.length ? "warn" : "ok"} note={pending.length ? `${stats.pendingReorders} reorders · ${stats.pendingReviews} reviews` : "Nothing open"} />
          <Stat label="Not ordering" value={notOrdering.length} note="Rejected reorders and planner no-orders" />
          <Stat label="Override rate" value={pct(stats.overrideRate)} tone={stats.overrideRate != null && stats.overrideRate > 0.3 ? "crit" : undefined}
            note={lastExport ? `Last export by ${lastExport.actor}, ${fmtDateTime(lastExport.at)}` : "Above 30% means the rules need revisiting"} />
        </div>

        <section aria-labelledby="ready">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="ready" className="font-display text-[22px] font-semibold tracking-tight">Ready to export</h2>
            <span className="text-[12.5px] text-muted">Approved · grouped by distributor</span>
          </div>
          {groups.length === 0 ? (
            <Panel><EmptyState title="No approved lines yet" action={<Link href={withRun("/", run.id)} className="text-[13px] font-semibold text-ok hover:underline">Go to the decision desk →</Link>}>
              Approve reorders on the decision desk and they collect here, grouped into one purchase order per distributor.
            </EmptyState></Panel>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {groups.map((g) => (
                <article key={g.distributor_id} className="lift overflow-hidden rounded-[var(--radius-xl)] border border-line bg-paper-2 shadow-[var(--shadow-1)]">
                  <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-[18px] font-semibold tracking-tight">{g.distributor_name || g.distributor_id}</h3>
                        <Tag tone="ok">Approved</Tag>
                        {g.distributor_status && g.distributor_status !== "Active" && <Tag tone="warn">{g.distributor_status}</Tag>}
                      </div>
                      <div className="tnum mt-0.5 text-[12px] text-muted">{g.distributor_id} · PO FR-{stamp}-{g.distributor_id} · <b className="font-semibold text-ink">{units(g.units)}</b> units</div>
                    </div>
                    <ExportButton small href={`/api/runs/${run.id}/export?type=po&distributor=${encodeURIComponent(g.distributor_id)}`} label="CSV"
                      pending={pending.length} lines={g.lines.length} filename={`approved_purchase_orders_${run.evaluation_date}_${g.distributor_id}.csv`} />
                  </header>
                  <ul className="divide-y divide-line">
                    {g.lines.map((l) => (
                      <li key={l.sku_id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-5 py-3 text-[13px]">
                        <Link href={withRun(`/?sku=${l.sku_id}`, run.id)} className="truncate font-medium hover:underline">{shortName(l.sku_name)}</Link>
                        <span className="tnum row-span-2 self-center text-right font-display text-[18px] font-semibold">{units(l.qty)}</span>
                        <span className="text-[12px] text-muted">
                          {l.decision}{l.engine_qty && l.engine_qty !== l.qty ? ` (engine said ${units(l.engine_qty)})` : ""} · {l.approved_by} · {fmtDateTime(l.approved_at)}
                          {l.note ? <span className="text-ink-2"> · “{l.note}”</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Awaiting a decision" sub="Not in any purchase order until someone decides.">
            {pending.length ? (
              <ul className="divide-y divide-line">
                {pending.map((r) => (
                  <li key={r.SKU_ID} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <Link href={withRun(`/?sku=${r.SKU_ID}`, run.id)} className="flex min-w-0 items-center gap-2 font-medium hover:underline">
                      <span className="truncate">{shortName(r.SKU_Name)}</span><IconArrowUpRight width={13} height={13} className="shrink-0 text-muted" />
                    </Link>
                    <span className="flex shrink-0 items-center gap-2"><span className="tnum text-[12.5px] text-ink-2">{r.Action === "IMMEDIATE_REORDER" ? `${units(r.Recommended_Order_Qty)} units` : ""}</span><StatusBadge action={r.Action} size="sm" /></span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-ok">Every reorder and review is decided.</p>}
          </Panel>
          <Panel title="Not ordering" sub="Rejected reorders and planner no-order calls, with the reason given.">
            {notOrdering.length ? (
              <ul className="divide-y divide-line">
                {notOrdering.map((d) => (
                  <li key={d.sku_id} className="py-2.5 text-[13px]">
                    <div className="flex items-center justify-between gap-3"><span className="font-medium">{shortName(recs.get(d.sku_id)?.SKU_Name ?? d.sku_id)}</span><Tag tone="crit">{KIND_LABEL[classify(d)]}</Tag></div>
                    <div className="mt-0.5 text-[12px] text-muted">{d.actor} · {fmtDateTime(d.decided_at)}{d.note ? <span className="text-ink-2"> · “{d.note}”</span> : null}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-muted">No rejections in this run.</p>}
          </Panel>
        </div>

        <Panel title="Decision history" sub="Every approval, change, undo and export for this run, newest first.">
          {history.length ? (
            <ol className="relative space-y-3 border-l border-line pl-5">
              {history.map((e) => {
                const d = e.detail;
                const sku = e.sku_id ? shortName(recs.get(e.sku_id)?.SKU_Name ?? e.sku_id) : "";
                const text = e.kind === "po_exported"
                  ? `Exported ${d.distributor === "all" ? "all distributors" : d.distributor}: ${d.lines} line${d.lines === 1 ? "" : "s"}, ${units(Number(d.units))} units`
                  : e.kind === "decision_cleared" ? `${sku}: decision undone`
                  : `${sku}: ${String(d.kind)}${d.decision === "order" ? `, ${units(Number(d.qty))} units` : ""}`;
                return (
                  <li key={e.id} className="relative text-[13px]">
                    <span aria-hidden className={`absolute -left-[25px] top-1.5 h-2 w-2 rounded-full ${e.kind === "po_exported" ? "bg-lime-deep" : e.kind === "decision_cleared" ? "bg-line-strong" : "bg-forest"}`} />
                    <div className="text-ink">{text}</div>
                    <div className="text-[12px] text-muted">{e.actor} · {fmtDateTime(e.at)}{typeof d.note === "string" && d.note ? <span className="text-ink-2"> · “{d.note}”</span> : null}</div>
                  </li>
                );
              })}
            </ol>
          ) : <p className="text-[13px] text-muted">No decisions yet.</p>}
        </Panel>
      </div>
    </>
  );
}
