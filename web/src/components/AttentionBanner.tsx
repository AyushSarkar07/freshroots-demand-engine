import Link from "next/link";
import { IconAlert, IconCheck } from "./icons";
import { ALERT_LABEL, type Alert } from "@/lib/compare";
import { CONFLICT_LABEL, detectConflicts } from "@/lib/conflicts";
import { withRun } from "@/lib/format";
import { shortName } from "@/lib/insights";
import { reviewText } from "@/lib/issues";
import type { EventRecord, RunRecord } from "@/lib/types";

interface Item { kind: "Run warning" | "Data hold" | "Early warning" | "Rule conflict"; tone: "crit" | "warn"; title: string; detail: string; sku?: string }

/**
 * Fail loudly: everything that needs a human in one place, at the top of the desk.
 * Nothing here is hidden behind a click, and nothing is summarised away.
 */
export function AttentionBanner({ run, warnings }: { run: RunRecord; warnings: EventRecord[] }) {
  const r = run.result;
  const items: Item[] = [
    ...r.summary.data_quality.global_issues.map((g) => ({ kind: "Run warning" as const, tone: "warn" as const, title: "Inputs", detail: g })),
    ...r.recommendations.filter((x) => x.Data_Quality_Status === "ERROR").map((x) => ({ kind: "Data hold" as const, tone: "crit" as const, title: shortName(x.SKU_Name), detail: `${reviewText(x)}. No quantity until the planner decides.`, sku: x.SKU_ID })),
    ...warnings.map((e) => {
      const d = e.detail as unknown as Alert;
      return { kind: "Early warning" as const, tone: d.severity === "high" ? ("crit" as const) : ("warn" as const), title: `${d.name}: ${ALERT_LABEL[d.code] ?? d.code}`, detail: d.detail, sku: e.sku_id ?? undefined };
    }),
    ...detectConflicts(r).map((c) => ({ kind: "Rule conflict" as const, tone: "warn" as const, title: `${c.name}: ${CONFLICT_LABEL[c.code]}`, detail: c.detail, sku: c.sku || undefined })),
  ];

  if (!items.length) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-line bg-paper-2 px-4 py-3 text-[13px] text-ink-2 shadow-[var(--shadow-1)]">
        <IconCheck width={16} height={16} className="text-ok" strokeWidth={2.2} />
        Nothing needs attention: no run warnings, data holds, early warnings or rule conflicts in this run.
      </div>
    );
  }
  const crit = items.filter((i) => i.tone === "crit").length;
  return (
    <section aria-labelledby="attention" className={`overflow-hidden rounded-[var(--radius-xl)] border bg-paper-2 shadow-[var(--shadow-2)] ${crit ? "border-crit/30" : "border-warn/30"}`}>
      <header className={`flex flex-wrap items-center justify-between gap-2 px-5 py-3 ${crit ? "bg-crit-soft" : "bg-warn-soft"}`}>
        <h2 id="attention" className={`flex items-center gap-2 text-[14px] font-semibold ${crit ? "text-crit" : "text-warn"}`}>
          <IconAlert width={16} height={16} strokeWidth={2} />
          Needs attention: {items.length} item{items.length > 1 ? "s" : ""}{crit ? `, ${crit} critical` : ""}
        </h2>
        <Link href={withRun("/oversight", run.id)} className="text-[12.5px] font-semibold text-ink-2 hover:underline">Full logs on Oversight →</Link>
      </header>
      <ul className="divide-y divide-line">
        {items.map((i, n) => (
          <li key={n} className="grid gap-x-4 gap-y-0.5 px-5 py-2.5 text-[13px] sm:grid-cols-[130px_minmax(0,1fr)]">
            <span className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${i.tone === "crit" ? "text-crit" : "text-warn"}`}>{i.kind}</span>
            <div className="min-w-0">
              <span className="font-semibold">{i.sku ? <Link href={withRun(`/?sku=${i.sku}`, run.id)} className="hover:underline">{i.title}</Link> : i.title}</span>
              <span className="text-ink-2"> · {i.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
