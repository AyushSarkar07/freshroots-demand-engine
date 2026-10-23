"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { AnimatedNumber } from "./AnimatedNumber";
import { DemandPulse } from "./DemandPulse";
import { IconArrowRight, IconArrowUpRight, IconSpark } from "./icons";
import { StatusDot } from "./ui";
import type { EngineConfig } from "@/lib/engine/config";
import type { Recommendation } from "@/lib/engine/engine";
import { fmtDate, units, weeks, withRun } from "@/lib/format";
import { coverRange, coverState, type Freshness, groups, shortName } from "@/lib/insights";
import { reviewText } from "@/lib/issues";
import type { PlannerBrief } from "@/lib/types";

export type Filter = "todo" | "all" | "IMMEDIATE_REORDER" | "PAUSE_ORDER" | "MANUAL_REVIEW" | "MAINTAIN";

interface Props {
  runId: string;
  recs: Recommendation[];
  config: EngineConfig;
  history: Record<string, { week: string; units: number }[]>;
  brief: PlannerBrief | null;
  fresh: Freshness;
  calendarAgrees: boolean | null;
  stats: { actionable: number; decided: number; pendingReorders: number; pendingReviews: number; approvedUnits: number };
  approvedBySku: Record<string, number>;
  onFilter: (f: Filter) => void;
  onOpen: (sku: string) => void;
}

function Card({ children, className = "", onClick, label }: { children: ReactNode; className?: string; onClick?: () => void; label?: string }) {
  // A stretched button covers the card, so block content stays valid HTML and the whole card is one target.
  return (
    <section className={`lift group relative flex flex-col overflow-hidden rounded-[var(--radius-xl)] border text-left ${className}`}>
      {children}
      {onClick && <button type="button" onClick={onClick} aria-label={label} className="absolute inset-0 z-10 cursor-pointer rounded-[var(--radius-xl)]" />}
    </section>
  );
}

function Kicker({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <div className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${dark ? "text-sage" : "text-muted"}`}>{children}</div>;
}

function Ring({ value, total }: { value: number; total: number }) {
  const r = 26, c = 2 * Math.PI * r;
  const frac = total ? value / total : 1;
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden className="shrink-0 -rotate-90">
      <circle cx="34" cy="34" r={r} fill="none" stroke="var(--line)" strokeWidth="7" />
      {frac > 0 && (
        <circle cx="34" cy="34" r={r} fill="none" stroke="var(--forest)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} className="transition-[stroke-dasharray] duration-300 ease-[var(--ease)]" />
      )}
    </svg>
  );
}

export function Bento({ runId, recs, config, history, brief, fresh, calendarAgrees, stats, approvedBySku, onFilter, onOpen }: Props) {
  const g = groups(recs);
  const byCover = (a: Recommendation, b: Recommendation) => (a.weeks_of_stock ?? 1e9) - (b.weeks_of_stock ?? 1e9);
  const reorder = [...g.reorder].sort(byCover);
  const totalUnits = reorder.reduce((s, r) => s + r.Recommended_Order_Qty, 0);
  const maxQty = Math.max(1, ...reorder.map((r) => r.Recommended_Order_Qty));
  const approvedCount = reorder.filter((r) => approvedBySku[r.SKU_ID] != null).length;
  const surges = recs.filter((r) => r.demand_spurt_flag).sort((a, b) => (b.demand_ratio ?? 0) - (a.demand_ratio ?? 0));
  const closest = surges.length ? null : [...recs].filter((r) => r.demand_ratio != null && !r.Review_Required).sort((a, b) => (b.demand_ratio ?? 0) - (a.demand_ratio ?? 0))[0];
  const pending = stats.actionable - stats.decided;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12">
      {/* 1 — dominant: what to order */}
      <section className="on-dark relative order-1 overflow-hidden rounded-[var(--radius-xl)] border border-forest-line bg-forest-2 p-6 text-ivory shadow-[var(--shadow-3)] md:order-none md:col-span-6 lg:col-span-6 lg:row-span-2">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgb(201_243_106/0.18),transparent_65%)]" />
        <div className="relative flex items-start justify-between gap-4">
          <Kicker dark>Recommended reorder</Kicker>
          <span className="tnum rounded-full bg-forest-3 px-2.5 py-1 text-[11.5px] font-semibold text-sage">
            {approvedCount}/{reorder.length} approved
          </span>
        </div>
        <div className="relative mt-3 flex items-end gap-3">
          <AnimatedNumber value={totalUnits} className="font-display text-[64px] font-semibold leading-[0.9] tracking-[-0.03em] text-lime sm:text-[76px]" />
          <div className="pb-2 text-[13px] leading-snug text-sage">units across<br /><b className="text-ivory">{reorder.length} SKU{reorder.length === 1 ? "" : "s"}</b> below their reorder point</div>
        </div>
        {reorder.length ? (
          <ul className="relative mt-6 space-y-1">
            {reorder.map((r) => {
              const ok = approvedBySku[r.SKU_ID] != null;
              return (
                <li key={r.SKU_ID}>
                  <button onClick={() => onOpen(r.SKU_ID)}
                    className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-[var(--radius)] px-2 py-2 text-left transition-colors duration-150 hover:bg-forest-3 sm:grid-cols-[minmax(0,1fr)_120px_64px]">
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium">{shortName(r.SKU_Name)}</span>
                      <span className="tnum text-[11.5px] text-sage">
                        <span className="text-coral">{weeks(r.weeks_of_stock)} wks</span> of {coverRange(r.Perishability, config).lo}+ needed{r.Perishability === "High" ? " · perishable" : ""}{r.demand_spurt_flag ? " · surge ×1.5" : ""}
                      </span>
                    </span>
                    <span aria-hidden className="hidden h-1.5 overflow-hidden rounded-full bg-forest-3 sm:block">
                      <span className="block h-full rounded-full bg-lime transition-[width] duration-300" style={{ width: `${(r.Recommended_Order_Qty / maxQty) * 100}%`, opacity: ok ? 1 : 0.55 }} />
                    </span>
                    <span className="tnum text-right text-[14px] font-semibold">{units(r.Recommended_Order_Qty)}{ok && <span className="sr-only"> (approved)</span>}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="relative mt-6 text-[14px] text-sage">Nothing is below its reorder point in this run.</p>
        )}
        <div className="relative mt-auto flex flex-wrap items-center justify-between gap-3 pt-6">
          <span className="text-[12px] text-sage">Bar = recommended quantity · solid once approved</span>
          <button onClick={() => onFilter("IMMEDIATE_REORDER")} className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-lime px-3.5 py-2 text-[13px] font-semibold text-forest transition-colors hover:bg-[#d4f77f]">
            Review reorders <IconArrowRight width={15} height={15} />
          </button>
        </div>
      </section>

      {/* 2 — what still needs a person */}
      <Card onClick={() => onFilter("todo")} label={`${pending} SKUs need a decision. Show them.`}
        className="order-2 border-line bg-paper-2 p-5 md:order-none md:col-span-3 lg:col-span-3">
        <Kicker>Needs a decision</Kicker>
        <div className="mt-3 flex items-center justify-between gap-3">
          <AnimatedNumber value={pending} className="font-display text-[48px] font-semibold leading-none tracking-tight" />
          <Ring value={stats.decided} total={stats.actionable} />
        </div>
        <p className="mt-3 text-[12.5px] text-ink-2">
          {pending ? `${stats.pendingReorders} reorder${stats.pendingReorders === 1 ? "" : "s"} · ${stats.pendingReviews} planner review${stats.pendingReviews === 1 ? "" : "s"} waiting` : "Every reorder and review is decided."}
        </p>
        <span className="tnum mt-1 text-[12px] text-muted">{stats.decided} of {stats.actionable} decided · {units(stats.approvedUnits)} units approved</span>
      </Card>

      {/* 3 — planner review */}
      <Card onClick={() => onFilter("MANUAL_REVIEW")} label={`${g.review.length} SKUs held for planner review`}
        className="order-7 border-dashed border-line-strong bg-paper p-5 md:order-none md:col-span-3 lg:col-span-3">
        <Kicker>Planner review</Kicker>
        <div className="mt-3 font-display text-[48px] font-semibold leading-none tracking-tight"><AnimatedNumber value={g.review.length} /></div>
        {g.review.length ? (
          <ul className="mt-3 space-y-1 text-[12.5px] text-ink-2">
            {g.review.slice(0, 3).map((r) => <li key={r.SKU_ID} className="truncate"><b className="font-medium text-ink">{shortName(r.SKU_Name)}</b> · {reviewText(r)}</li>)}
            {g.review.length > 3 && <li className="text-muted">+{g.review.length - 3} more</li>}
          </ul>
        ) : <p className="mt-3 text-[12.5px] text-ink-2">Nothing waiting for Raghav. Every SKU fit the rules.</p>}
      </Card>

      {/* 4 — overstock */}
      <Card onClick={() => onFilter("PAUSE_ORDER")} label={`${g.pause.length} SKUs overstocked. Show them.`}
        className="order-5 border-line bg-paper-2 p-5 md:order-none md:col-span-3 lg:col-span-3">
        <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-amber" />
        <Kicker>Overstock pauses</Kicker>
        <div className="mt-3 font-display text-[48px] font-semibold leading-none tracking-tight"><AnimatedNumber value={g.pause.length} /></div>
        <ul className="mt-3 space-y-1 text-[12.5px]">
          {g.pause.slice(0, 3).map((r) => (
            <li key={r.SKU_ID} className="flex justify-between gap-2"><span className="truncate text-ink-2">{shortName(r.SKU_Name)}</span><span className="tnum shrink-0 font-semibold text-warn">{weeks(r.weeks_of_stock)} wks</span></li>
          ))}
          {!g.pause.length && <li className="text-ink-2">No SKU is above its overstock limit.</li>}
        </ul>
      </Card>

      {/* 5 — in range */}
      <Card onClick={() => onFilter("MAINTAIN")} label={`${g.within.length} of ${recs.length} SKUs in their target range`}
        className="order-6 border-line bg-paper-2 p-5 md:order-none md:col-span-3 lg:col-span-3">
        <Kicker>In target range</Kicker>
        <div className="mt-3 flex items-baseline gap-1.5">
          <span className="font-display text-[48px] font-semibold leading-none tracking-tight"><AnimatedNumber value={g.within.length} /></span>
          <span className="tnum text-[16px] font-medium text-muted">/ {recs.length}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5" aria-hidden>
          {[...recs].sort(byCover).map((r) => {
            const st = coverState(r.weeks_of_stock, coverRange(r.Perishability, config));
            const bg = r.Review_Required ? "transparent" : st === "below" ? "var(--coral)" : st === "above" ? "var(--amber)" : "var(--ok)";
            return <span key={r.SKU_ID} title={`${shortName(r.SKU_Name)}: ${weeks(r.weeks_of_stock)} wks`} className="h-3 w-3 rounded-full" style={{ background: bg, border: r.Review_Required ? "1.5px dashed var(--muted)" : "none" }} />;
          })}
        </div>
        <span className="mt-2 text-[11.5px] text-muted">One dot per SKU, lowest cover first. Coral below range, green in range, amber over.</span>
      </Card>

      {/* 6 — demand surge */}
      <section className="lift order-3 flex flex-col rounded-[var(--radius-xl)] border border-line bg-paper-2 p-5 md:order-none md:col-span-6 lg:col-start-8 lg:col-span-5 lg:row-start-3">
        <div className="flex items-center justify-between gap-3">
          <Kicker>Demand surge alerts</Kicker>
          <span className="tnum whitespace-nowrap text-[12px] text-muted">surge line {config.surge_ratio_threshold.toFixed(2)}×</span>
        </div>
        <div className="mt-3 font-display text-[48px] font-semibold leading-none tracking-tight"><AnimatedNumber value={surges.length} /></div>
        <div className="mt-4 space-y-4">
          {(surges.length ? surges.slice(0, 2) : closest ? [closest] : []).map((r) => (
            <div key={r.SKU_ID} className="relative -mx-2 rounded-[var(--radius)] px-2 py-1 transition-colors hover:bg-paper-3">
              <button type="button" onClick={() => onOpen(r.SKU_ID)} aria-label={`Open ${shortName(r.SKU_Name)}`} className="absolute inset-0 z-10 rounded-[var(--radius)]" />
              <div className="mb-1 flex items-center justify-between text-[13px]">
                <span className="font-medium">{shortName(r.SKU_Name)}</span>
                {!surges.length && <span className="text-[11.5px] text-muted">closest to the line</span>}
              </div>
              <DemandPulse rec={r} history={history[r.SKU_ID] ?? []} threshold={config.surge_ratio_threshold} longWeeks={config.long_window_weeks} shortWeeks={config.short_window_weeks} height={56} />
            </div>
          ))}
          {surges.length > 2 && <button onClick={() => onFilter("all")} className="text-[12.5px] font-semibold text-ok hover:underline">+{surges.length - 2} more in the desk</button>}
        </div>
      </section>

      {/* 7 — planner brief (the AI step) */}
      <section className="order-4 flex flex-col rounded-[var(--radius-xl)] border border-line bg-paper-2 p-6 md:order-none md:col-span-6 lg:col-start-1 lg:col-span-7 lg:row-span-2 lg:row-start-3">
        <div className="flex items-center justify-between gap-3">
          <Kicker>Planner brief</Kicker>
          <span className="inline-flex items-center gap-1 text-[11.5px] text-muted" title={brief?.fallback_reason ?? undefined}>
            <IconSpark width={13} height={13} />
            {brief?.source === "gemini" ? "Drafted by Gemini · every number checked against the engine" : "Template brief"}
          </span>
        </div>
        {brief ? (
          <>
            <p className="mt-3 font-display text-[21px] font-semibold leading-snug tracking-tight">{brief.headline}</p>
            <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink-2">
              {brief.bullets.map((b, i) => <li key={i} className="flex gap-2.5"><span aria-hidden className="mt-[9px] h-1 w-3 shrink-0 rounded-full bg-lime-deep" /><span>{b}</span></li>)}
            </ul>
            {brief.watch.length > 0 && (
              <div className="mt-4 rounded-[var(--radius)] border border-warn/25 bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">
                <b className="font-semibold">Close to a threshold.</b> A small change in sales would flip these:
                <ul className="mt-1 space-y-0.5">{brief.watch.map((w, i) => <li key={i}>· {w.replace(/\.$/, "")}</li>)}</ul>
              </div>
            )}
          </>
        ) : <p className="mt-3 text-[13px] text-muted">The brief for this run is still being written. Refresh in a moment.</p>}
      </section>

      {/* 8 — data health */}
      <section className="order-8 flex flex-col rounded-[var(--radius-xl)] border border-line bg-paper p-5 md:order-none md:col-span-6 lg:col-start-8 lg:col-span-5 lg:row-start-4">
        <Kicker>Data health</Kicker>
        <div className="mt-3 text-ink">
          <StatusDot tone={fresh.status}><span className="font-semibold">{fresh.statusText}</span></StatusDot>
        </div>
        <dl className="tnum mt-4 space-y-2.5 text-[12.5px]">
          <div className="flex justify-between gap-3"><dt className="text-muted">Stock snapshot</dt><dd className="font-medium">{fresh.snapshot ? fmtDate(fresh.snapshot) : "—"}{fresh.snapshotAgeDays != null ? <span className="text-muted"> · {fresh.snapshotAgeDays}d old</span> : null}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Sales through</dt><dd className="font-medium">{fresh.salesWeek}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Festival calendar</dt><dd className="font-medium">{calendarAgrees == null ? "Not checked" : calendarAgrees ? "Agrees with rule" : "Disagrees"}</dd></div>
        </dl>
        <Link href={withRun("/data", runId)} className="mt-auto inline-flex items-center gap-1 pt-4 text-[12.5px] font-semibold text-ok hover:underline">
          Validation report <IconArrowUpRight width={14} height={14} />
        </Link>
      </section>
    </div>
  );
}
