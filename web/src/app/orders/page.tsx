import Link from "next/link";
import { ExportButton } from "@/components/ExportButton";
import { Card, Empty, Pill, Stat } from "@/components/ui";
import { approvalStats } from "@/lib/decisions";
import { fmtDate, fmtDateTime, pct, units, withRun } from "@/lib/format";
import { purchaseOrders } from "@/lib/po";
import { loadRun } from "@/lib/runs";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Orders({ searchParams }: PageProps<"/orders">) {
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  if (!run) return <Empty>No runs yet.</Empty>;
  const store = getStore();
  const [decisions, events] = await Promise.all([store.listDecisions(run.id), store.listEvents(run.id)]);
  const groups = purchaseOrders(run, decisions);
  const stats = approvalStats(run, decisions);
  const exports = events.filter((e) => e.kind === "po_exported");
  const pending = run.result.recommendations.filter((r) => (r.Action === "IMMEDIATE_REORDER" || r.Action === "MANUAL_REVIEW") && !decisions.some((d) => d.sku_id === r.SKU_ID));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[28px] leading-tight tracking-tight">Purchase orders</h1>
          <p className="mt-1 text-[13px] text-ink-2">Approved lines from the run evaluated {fmtDate(run.evaluation_date)}, one order per distributor. Export to CSV and import into Zoho Inventory.</p>
        </div>
        {groups.length > 0 && <ExportButton href={`/api/runs/${run.id}/export?type=po`} label="Export all approved lines" />}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Approved units" value={units(stats.approvedUnits)} note={`${groups.reduce((s, g) => s + g.lines.length, 0)} lines, ${groups.length} distributor(s)`} />
        <Stat label="Waiting for a decision" value={pending.length} tone={pending.length ? "warn" : "good"} note={pending.length ? `${stats.pendingReorders} reorders, ${stats.pendingReviews} reviews` : "All decided"} />
        <Stat label="Override rate" value={pct(stats.overrideRate)} note="Edits and rejections of rule-based decisions. Above 30% means the rules need revisiting." />
        <Stat label="Exports" value={exports.length} note={exports[0] ? `Last by ${exports[0].actor}, ${fmtDateTime(exports[0].at)}` : "Not exported yet"} />
      </div>

      {pending.length > 0 && (
        <div className="rounded-lg bg-warn-soft px-4 py-3 text-[13px] text-warn">
          Still waiting: {pending.map((r, i) => (
            <span key={r.SKU_ID}>{i > 0 && ", "}<Link className="underline" href={withRun(`/sku/${r.SKU_ID}`, run.id)}>{r.SKU_Name.replace(/^Freshroots /, "")}</Link></span>
          ))}. Exported files contain approved lines only.
        </div>
      )}

      {groups.length === 0 ? (
        <Empty>No approved lines yet. Approve reorders on <Link className="text-accent underline" href={withRun("/", run.id)}>Decisions</Link>.</Empty>
      ) : groups.map((g) => (
        <Card key={g.distributor_id}
          title={<span>{g.distributor_name || g.distributor_id} <span className="font-mono text-[12px] font-normal text-muted">{g.distributor_id}</span></span>}
          sub={`PO reference FR-${run.evaluation_date.replace(/-/g, "")}-${g.distributor_id} · ${units(g.units)} units`}
          right={<div className="flex items-center gap-2">
            {g.distributor_status && g.distributor_status !== "Active" && <Pill tone="warn">! {g.distributor_status}</Pill>}
            <ExportButton href={`/api/runs/${run.id}/export?type=po&distributor=${encodeURIComponent(g.distributor_id)}`} label="Export CSV" small />
          </div>}>
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-muted">
                  <th className="py-2 pl-4 pr-3 font-medium sm:pl-0">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Quantity</th>
                  <th className="px-3 py-2 text-right font-medium">Engine said</th>
                  <th className="py-2 pl-3 pr-4 font-medium sm:pr-0">Approved by</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((l) => (
                  <tr key={l.sku_id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pl-4 pr-3 sm:pl-0">
                      <Link href={withRun(`/sku/${l.sku_id}`, run.id)} className="hover:text-accent hover:underline">{l.sku_name}</Link>
                      <div className="font-mono text-[11.5px] text-muted">{l.sku_id}</div>
                    </td>
                    <td className="tnum px-3 py-2.5 text-right font-medium">{units(l.qty)}</td>
                    <td className="tnum px-3 py-2.5 text-right text-ink-2">{l.engine_qty ? units(l.engine_qty) : "—"}{l.engine_qty && l.engine_qty !== l.qty ? " (edited)" : ""}</td>
                    <td className="py-2.5 pl-3 pr-4 text-[12.5px] sm:pr-0">
                      {l.approved_by} <span className="text-muted">· {fmtDateTime(l.approved_at)}</span>
                      <div className="text-muted">{l.decision}{l.note ? ` · “${l.note}”` : ""}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      <p className="text-[12px] text-muted">The app never sends an order to a supplier. Purchase orders are raised in Zoho Inventory from the exported file, which keeps one authorised person accountable for each order.</p>
    </div>
  );
}
