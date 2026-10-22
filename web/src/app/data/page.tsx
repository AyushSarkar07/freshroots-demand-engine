import Link from "next/link";
import { ExportButton } from "@/components/ExportButton";
import { UploadForm } from "@/components/UploadForm";
import { Card, Empty, Pill } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { fmtDate, fmtDateTime, todayIST, units } from "@/lib/format";
import { loadRun } from "@/lib/runs";
import { getStore } from "@/lib/store";
import type { EventRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

const SEV: Record<string, "bad" | "warn" | "info"> = { ERROR: "bad", WARNING: "warn", INFO: "info" };

function eventText(e: EventRecord): string {
  const d = e.detail;
  switch (e.kind) {
    case "run_created": return `Engine ran: ${d.reorder} to reorder (${units(Number(d.units))} units), ${d.review} for review, ${d.dq_errors} data errors`;
    case "brief_generated": return `Planner brief drafted: “${d.headline}”`;
    case "brief_fallback": return `Planner brief from template (${d.reason ?? "Gemini not configured"})`;
    case "notification": return d.live ? "Procurement notified on Telegram" : `Procurement notification simulated (Telegram not configured)${d.error ? `: ${d.error}` : ""}`;
    case "decision": return `${e.sku_id}: ${d.kind}${d.decision === "order" ? `, ${units(Number(d.qty))} units` : ""}${d.note ? ` (“${d.note}”)` : ""}`;
    case "decision_cleared": return `${e.sku_id}: decision undone`;
    case "po_exported": return `Purchase orders exported (${d.distributor === "all" ? "all distributors" : d.distributor}, ${d.lines} lines, ${units(Number(d.units))} units)`;
    default: return e.kind;
  }
}

export default async function Data({ searchParams }: PageProps<"/data">) {
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  const store = getStore();
  const [runs, events] = await Promise.all([store.listRuns(), run ? store.listEvents(run.id) : Promise.resolve([])]);
  const cfg = getConfig();
  const dq = run?.result.data_quality ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-[28px] leading-tight tracking-tight">Data & runs</h1>
        <p className="mt-1 text-[13px] text-ink-2">Upload the SAP export every Monday and Thursday. Every file is checked before any SKU gets a recommendation, and nothing missing is treated as zero.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card title="Upload a new export" sub="Same five CSVs the IT team exports from SAP. Columns are matched by name.">
          <UploadForm defaultDate={todayIST()} />
        </Card>
        <Card title="Runs" sub="Newest first. Each run keeps its own decisions.">
          <ul className="divide-y divide-line text-[13px]">
            {runs.map((r) => (
              <li key={r.id} className={`py-2 ${r.id === run?.id ? "font-medium" : ""}`}>
                <Link href={`/data?run=${r.id}`} className="hover:text-accent">
                  {fmtDate(r.evaluation_date)} · sales to {r.sales_cutoff_week}
                </Link>
                <div className="text-[12px] font-normal text-muted">
                  {r.label} · {r.created_by} · {fmtDateTime(r.created_at)}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-[11.5px] font-normal">
                  <Pill>{r.kpis.immediate_reorder_skus} reorder</Pill>
                  <Pill>{r.kpis.skus_requiring_manual_review} review</Pill>
                  {r.dq_errors ? <Pill tone="bad">{r.dq_errors} errors</Pill> : <Pill tone="good">✓ data</Pill>}
                  {r.id !== run?.id && <Link href={`/?run=${r.id}`} className="text-accent hover:underline">open →</Link>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {run && (
        <>
          <Card title={`Inputs for the run evaluated ${fmtDate(run.evaluation_date)}`}
            right={<div className="flex gap-2"><ExportButton small href={`/api/runs/${run.id}/export?type=recommendations`} label="Recommendations CSV" /><ExportButton small href={`/api/runs/${run.id}/export?type=dq`} label="Data-quality CSV" /></div>}>
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[560px] text-[13px]">
                <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-muted"><th className="py-2 pl-4 font-medium sm:pl-0">File</th><th className="px-3 py-2 text-right font-medium">Size</th><th className="py-2 pl-3 pr-4 font-medium sm:pr-0">SHA-256 (audit fingerprint)</th></tr></thead>
                <tbody>
                  {run.input_meta.map((f) => (
                    <tr key={f.name} className="border-b border-line last:border-0">
                      <td className="py-2 pl-4 sm:pl-0">{f.file}</td>
                      <td className="tnum px-3 py-2 text-right text-ink-2">{units(f.bytes)} B</td>
                      <td className="py-2 pl-3 pr-4 font-mono text-[11.5px] text-muted sm:pr-0">{f.sha256.slice(0, 16)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-muted">
              Calendar: {run.result.calendar.available ? `${run.result.calendar.granularity ?? "unrecognised"} calendar${run.result.calendar.evaluation_month ? `, ${run.result.calendar.evaluation_month} festival = ${String(run.result.calendar.evaluation_month_calendar_festival)}` : ""}` : "not supplied"} · engine v{run.result.engine_version} · inventory policy: {run.result.config.inventory_aggregation.replace(/_/g, " ")}
            </p>
          </Card>

          <Card title="Data-quality report" sub={`${dq.filter((d) => d.Severity === "ERROR").length} errors, ${dq.filter((d) => d.Severity === "WARNING").length} warnings, ${dq.filter((d) => d.Severity === "INFO").length} info. Errors hold the affected SKU for planner review.`}>
            {dq.length === 0 ? <Empty>✓ Every row of every file passed validation.</Empty> : (
              <div className="-mx-4 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[720px] text-[12.5px]">
                  <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-muted"><th className="py-2 pl-4 font-medium sm:pl-0">Severity</th><th className="px-2 py-2 font-medium">File · line</th><th className="px-2 py-2 font-medium">SKU</th><th className="px-2 py-2 font-medium">Issue</th><th className="py-2 pl-2 pr-4 font-medium sm:pr-0">What happened</th></tr></thead>
                  <tbody>
                    {dq.map((d, i) => (
                      <tr key={i} className="border-b border-line align-top last:border-0">
                        <td className="py-2 pl-4 sm:pl-0"><Pill tone={SEV[d.Severity]}>{d.Severity.toLowerCase()}</Pill></td>
                        <td className="px-2 py-2 text-ink-2">{d.Source_File}{d.Row_Number ? ` · ${d.Row_Number}` : ""}</td>
                        <td className="px-2 py-2 font-mono text-[11.5px]">{d.SKU_ID || "—"}</td>
                        <td className="px-2 py-2"><span className="font-mono text-[11.5px]">{d.Issue_Code}</span><div className="text-ink-2">{d.Detail}</div></td>
                        <td className="py-2 pl-2 pr-4 text-ink-2 sm:pr-0">{d.Disposition.replace(/_/g, " ").toLowerCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Activity log" sub="Everything that happened in this run, newest first.">
            <ol className="space-y-2 text-[12.5px]">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap gap-x-3 border-l-2 border-line pl-3">
                  <span className="tnum w-32 shrink-0 text-muted">{fmtDateTime(e.at)}</span>
                  <span className="flex-1 text-ink">{eventText(e)}</span>
                  <span className="text-muted">{e.actor}</span>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
      <p className="text-[12px] text-muted">Storage: {cfg.db === "postgres" ? "Postgres" : "in memory (set DATABASE_URL to keep runs)"} · Brief: {cfg.ai === "gemini" ? `Gemini ${cfg.geminiModel}` : "template (set GEMINI_API_KEY)"} · Notifications: {cfg.telegram === "live" ? "Telegram" : "simulated (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)"}</p>
    </div>
  );
}
