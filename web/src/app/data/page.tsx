import Link from "next/link";
import { ExportButton } from "@/components/ExportButton";
import { ScenarioForm } from "@/components/ScenarioForm";
import { UploadForm } from "@/components/UploadForm";
import { EmptyState, PageHeader, Panel, StatusDot, Tag } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { fmtDate, fmtDateTime, todayIST, units } from "@/lib/format";
import { freshness } from "@/lib/insights";
import { loadRun } from "@/lib/runs";
import { getStore } from "@/lib/store";
import type { EventRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

const SEV: Record<string, "crit" | "warn" | "plain"> = { ERROR: "crit", WARNING: "warn", INFO: "plain" };

function eventText(e: EventRecord): string {
  const d = e.detail;
  switch (e.kind) {
    case "run_created": return `Engine ran: ${d.reorder} to reorder (${units(Number(d.units))} units), ${d.review} for review, ${d.dq_errors} data errors`;
    case "brief_generated": return `Planner brief drafted: “${d.headline}”`;
    case "brief_fallback": return `Planner brief from template (${d.reason ?? "Gemini not configured"})`;
    case "notification": {
      if (d.skipped) return `Notification skipped: ${d.reason}`;
      const ds = (d.deliveries as { channel: string; live: boolean; error?: string }[] | undefined) ?? [{ channel: "telegram", live: Boolean(d.live), error: d.error as string | undefined }];
      return `Procurement alert: ${ds.map((x) => `${x.channel} ${x.live ? "sent" : x.error ? `failed (${x.error})` : "simulated (not configured)"}`).join(", ")}`;
    }
    case "decision": return `${e.sku_id}: ${d.kind}${d.decision === "order" ? `, ${units(Number(d.qty))} units` : ""}${d.note ? ` (“${d.note}”)` : ""}`;
    case "decision_cleared": return `${e.sku_id}: decision undone`;
    case "early_warning": return `Early warning (${d.severity}): ${d.name}: ${d.detail}`;
    case "rule_conflict": return `Rule conflict: ${d.name}: ${d.detail}`;
    case "drift": return `Data drift: ${d.detail}`;
    case "po_exported": return `Purchase orders exported (${d.distributor === "all" ? "all distributors" : d.distributor}, ${d.lines} line${d.lines === 1 ? "" : "s"}, ${units(Number(d.units))} units)`;
    default: return e.kind;
  }
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "ok" | "warn" | "crit" }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-night-line bg-night-2 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">{label}</div>
      <div className="tnum mt-1.5 font-display text-[22px] font-semibold tracking-tight text-cream">{value}</div>
      <div className={`mt-0.5 text-[12px] ${tone === "crit" ? "text-under" : tone === "warn" ? "text-amber" : tone === "ok" ? "text-ok-fill" : "text-mist"}`}>{note}</div>
    </div>
  );
}

export default async function Data({ searchParams }: PageProps<"/data">) {
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  const store = getStore();
  const [runs, events] = await Promise.all([store.listRuns(), run ? store.listEvents(run.id) : Promise.resolve([])]);
  // Scenario lab: the latest real runs, with their SKUs and distributors for the form.
  const realRuns = (await Promise.all(runs.filter((r) => r.source !== "scenario").slice(0, 5).map((r) => store.getRun(r.id)))).filter((r) => r != null);
  const labSkus = Object.fromEntries(realRuns.map((r) => [r.id, r.result.recommendations.map((x) => ({ id: x.SKU_ID, name: x.SKU_Name.replace(/^Freshroots\s+/i, ""), distributor: x.Distributor_ID }))]));
  const labDists = Object.fromEntries(realRuns.map((r) => [r.id, Object.keys(r.result.distributors)]));
  const drift = events.filter((e) => e.kind === "drift");
  const cfg = getConfig();
  const dq = run?.result.data_quality ?? [];
  const fresh = run ? freshness(run.result) : null;
  const errors = dq.filter((d) => d.Severity === "ERROR").length;
  const warnings = dq.filter((d) => d.Severity === "WARNING").length;

  return (
    <>
      <PageHeader eyebrow="Data & runs" title="Inputs you can trust"
        sub="Upload the SAP export every Monday and Thursday. Every row is checked before any SKU gets a recommendation; nothing missing is treated as zero, and a bad row holds only its own SKU."
        right={fresh && (
          <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:grid-cols-4">
            <Tile label="Stock snapshot" value={fresh.snapshot ? fmtDate(fresh.snapshot) : "—"} note={fresh.snapshotAgeDays != null ? `${fresh.snapshotAgeDays} day${fresh.snapshotAgeDays === 1 ? "" : "s"} before evaluation` : "No valid snapshot"} tone={fresh.stale ? "warn" : "ok"} />
            <Tile label="Latest sales week" value={fresh.salesWeek} note={`Evaluated ${fmtDate(run!.evaluation_date)}`} />
            <Tile label="Validation" value={errors ? `${errors} error${errors === 1 ? "" : "s"}` : warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "Passed"} note={fresh.statusText} tone={fresh.status} />
            <Tile label="Last run" value={fmtDate(run!.created_at)} note={`by ${run!.created_by}`} />
          </div>
        )} />

      <div className="mx-auto max-w-[1320px] space-y-6 px-4 py-8 sm:px-8 lg:px-10">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel eyebrow="New run" title="Upload an SAP export" sub="The same five CSVs the IT team exports. Columns are matched by name.">
            <UploadForm defaultDate={todayIST()} />
          </Panel>
          <Panel eyebrow="History" title="Runs" sub="Newest first. Each run keeps its own decisions.">
            {runs.length ? (
              <ul className="-my-2 divide-y divide-line">
                {runs.map((r) => {
                  const on = r.id === run?.id;
                  return (
                    <li key={r.id} className={`relative py-3 ${on ? "before:absolute before:-left-6 before:inset-y-2 before:w-[3px] before:rounded-full before:bg-spice-deep" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/data?run=${r.id}`} className="tnum text-[13.5px] font-semibold hover:underline">{fmtDate(r.evaluation_date)} · {r.sales_cutoff_week}</Link>
                        {on ? <Tag tone="lime">Viewing</Tag> : <Link href={`/?run=${r.id}`} className="text-[12px] font-semibold text-ok hover:underline">Open →</Link>}
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-muted">{r.label} · {r.created_by} · {fmtDateTime(r.created_at)}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <Tag tone="crit">{r.kpis.immediate_reorder_skus} reorder</Tag>
                        <Tag tone="neutral">{r.kpis.skus_requiring_manual_review} review</Tag>
                        {r.dq_errors ? <Tag tone="crit">{r.dq_errors} errors</Tag> : <Tag tone="ok">Data passed</Tag>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-[13px] text-muted">No runs yet.</p>}
          </Panel>
        </div>

        {realRuns.length > 0 && (
          <section id="scenario-lab" className="scroll-mt-24">
            <Panel eyebrow="Database simulation" title="Scenario lab"
              sub="Simulate a new SKU with no history without adding one: delete its sales, add a distributor, remap the SKU, rerun, and compare with the original. Runs on a copy; the real run is never changed.">
              <ScenarioForm runs={realRuns.map((r) => ({ id: r.id, label: r.label, evaluation_date: r.evaluation_date }))} skus={labSkus} distributors={labDists}
                defaultRun={run && run.source !== "scenario" ? run.id : realRuns[0].id} />
            </Panel>
          </section>
        )}

        {run && (
          <>
            <Panel eyebrow="Audit" title={`Inputs for the run evaluated ${fmtDate(run.evaluation_date)}`}
              sub={`Engine v${run.result.engine_version} · calendar ${run.result.calendar.available ? `${run.result.calendar.granularity ?? "unrecognised"}${run.result.calendar.evaluation_month ? `, ${run.result.calendar.evaluation_month} festival = ${String(run.result.calendar.evaluation_month_calendar_festival)}` : ""}` : "not supplied"} · inventory policy: ${run.result.config.inventory_aggregation.replace(/_/g, " ")}`}
              right={<div className="flex flex-wrap gap-2">
                <ExportButton small href={`/api/runs/${run.id}/export?type=consolidated`} label="One consolidated table" filename={`consolidated_sku_table_${run.evaluation_date}.csv`} />
                <ExportButton small href={`/api/runs/${run.id}/export?type=recommendations`} label="Recommendations CSV" filename={`reorder_recommendations_${run.evaluation_date}.csv`} />
                <ExportButton small href={`/api/runs/${run.id}/export?type=dq`} label="Data-quality CSV" filename={`data_quality_report_${run.evaluation_date}.csv`} />
              </div>}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {run.input_meta.map((f) => (
                  <div key={f.name} className="rounded-[var(--radius)] border border-line bg-paper px-3 py-2.5">
                    <div className="truncate text-[13px] font-semibold">{f.file}</div>
                    <div className="tnum text-[12px] text-muted">{units(f.bytes)} bytes</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted" title={`SHA-256 ${f.sha256}`}>{f.sha256.slice(0, 16)}…</div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel eyebrow="Data drift" title={run.base_run_id ? "What changed since the previous run" : "Drift"}
              sub={run.base_run_id ? <>Compared with the run it followed. <Link className="font-semibold text-ok hover:underline" href={`/compare?run=${run.id}`}>Full comparison →</Link></> : "This is the first run, so there is nothing to compare against yet."}>
              {drift.length ? (
                <ul className="space-y-2 text-[13px]">{drift.map((e) => <li key={e.id} className="flex gap-2"><Tag tone="plain">{String(e.detail.code).replace(/_/g, " ").toLowerCase()}</Tag><span className="text-ink-2">{String(e.detail.detail)}</span></li>)}</ul>
              ) : <p className="text-[13px] text-muted">{run.base_run_id ? "Same SKUs, distributors and file columns as the previous run." : "No earlier run."}</p>}
            </Panel>

            <Panel eyebrow="Validation" title="Data-quality report"
              sub={`${errors} errors, ${warnings} warnings, ${dq.length - errors - warnings} info. An error holds the affected SKU for planner review; everything else still gets a recommendation.`}>
              {dq.length === 0 ? (
                <EmptyState title="Every row passed">All five files were read and checked: no missing, conflicting, negative or out-of-date values.</EmptyState>
              ) : (
                <div className="-mx-5 overflow-x-auto sm:-mx-6">
                  <table className="w-full min-w-[760px] text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.1em] text-muted">
                        <th className="py-2 pl-6 font-semibold">Severity</th><th className="px-2 py-2 font-semibold">File · line</th><th className="px-2 py-2 font-semibold">SKU</th>
                        <th className="px-2 py-2 font-semibold">Issue</th><th className="py-2 pl-2 pr-6 font-semibold">What happened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dq.map((d, i) => (
                        <tr key={i} className="border-b border-line align-top last:border-0">
                          <td className="py-2.5 pl-6"><Tag tone={SEV[d.Severity]}>{d.Severity.toLowerCase()}</Tag></td>
                          <td className="tnum px-2 py-2.5 text-ink-2">{d.Source_File}{d.Row_Number ? ` · ${d.Row_Number}` : ""}</td>
                          <td className="px-2 py-2.5 font-mono text-[11.5px]">{d.SKU_ID || "—"}</td>
                          <td className="px-2 py-2.5"><span className="font-mono text-[11.5px]">{d.Issue_Code}</span><div className="text-ink-2">{d.Detail}</div></td>
                          <td className="py-2.5 pl-2 pr-6 text-ink-2">{d.Disposition.replace(/_/g, " ").toLowerCase()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel eyebrow="Audit" title="Activity log" sub="Everything that happened in this run, newest first.">
              <ol className="relative space-y-3 border-l border-line pl-5">
                {events.map((e) => (
                  <li key={e.id} className="relative text-[13px]">
                    <span aria-hidden className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-night" />
                    <div className="text-ink">{eventText(e)}</div>
                    <div className="tnum text-[12px] text-muted">{e.actor} · {fmtDateTime(e.at)}</div>
                  </li>
                ))}
              </ol>
            </Panel>
          </>
        )}

        <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted">
          <StatusDot tone={cfg.db === "postgres" ? "ok" : "warn"}>{cfg.db === "postgres" ? "Runs stored in Postgres" : "In-memory store: set DATABASE_URL to keep runs"}</StatusDot>
          <StatusDot tone={cfg.ai === "gemini" ? "ok" : "warn"}>{cfg.ai === "gemini" ? `Brief: Gemini ${cfg.geminiModel}` : "Brief: template (set GEMINI_API_KEY)"}</StatusDot>
          <StatusDot tone={cfg.telegram === "live" ? "ok" : "warn"}>{cfg.telegram === "live" ? "Alerts: Telegram" : "Alerts simulated (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)"}</StatusDot>
        </p>
      </div>
    </>
  );
}
