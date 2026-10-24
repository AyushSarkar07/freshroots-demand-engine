import { IconDownload } from "@/components/icons";
import { RulebookAsk } from "@/components/RulebookAsk";
import { PageHeader, Panel, Tag, buttonClass } from "@/components/ui";
import { CONFLICT_LABEL, type ConflictCode } from "@/lib/conflicts";
import { CONFLICT_POLICY, CONSTANTS, PEOPLE, ruleDocs, VARIABLES } from "@/lib/governance";
import { DEFAULT_CONFIG, type EngineConfig } from "@/lib/engine/config";
import { loadRun } from "@/lib/runs";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One perishability class drawn as a ruler: reorder zone, target range, overstock zone. */
function RangeRule({ title, lo, hi, note }: { title: string; lo: number; hi: number; note: string }) {
  const max = hi * 1.5;
  const p = (v: number) => `${(v / max) * 100}%`;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-semibold">{title}</h3>
        <span className="text-[12px] text-muted">{note}</span>
      </div>
      <div className="relative h-14">
        <div className="absolute inset-x-0 top-3 flex h-6 overflow-hidden rounded-[var(--radius-sm)]">
          <div className="flex h-full items-center justify-center bg-crit-soft text-[11.5px] font-semibold text-crit" style={{ width: p(lo) }}>Reorder</div>
          <div className="flex h-full items-center justify-center bg-ok-soft text-[11.5px] font-semibold text-ok" style={{ width: `calc(${p(hi)} - ${p(lo)})`, boxShadow: "inset 0 0 0 1px rgb(59 102 38 / 0.3)" }}>In range</div>
          <div className="flex h-full flex-1 items-center justify-center bg-over-soft text-[11.5px] font-semibold text-over-ink">Pause</div>
        </div>
        {[lo, hi].map((v) => (
          <div key={v} className="absolute top-0 h-11 w-px bg-ink" style={{ left: p(v) }}>
            <span className="tnum absolute top-[46px] -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold">{v} wks</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12.5px] text-ink-2">Under {lo} weeks: reorder now. Over {hi} weeks: pause the next order. {lo} to {hi} inclusive is in range, so exactly {lo} or exactly {hi} weeks needs no action.</p>
    </div>
  );
}

function SurgeScale({ c }: { c: EngineConfig }) {
  const lo = 0.6, hi = 1.8;
  const p = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div>
      <div className="relative mt-2 h-14">
        <div className="absolute inset-x-0 top-4 h-2 rounded-full bg-paper-3" />
        <div className="absolute top-4 h-2 rounded-r-full bg-under/70" style={{ left: p(c.surge_ratio_threshold), right: 0 }} />
        <div className="absolute top-1 h-8 w-0.5 bg-ink" style={{ left: p(c.surge_ratio_threshold) }} />
        <span className="tnum absolute top-10 -translate-x-1/2 text-[12px] font-semibold" style={{ left: p(c.surge_ratio_threshold) }}>{c.surge_ratio_threshold.toFixed(2)}</span>
        <span className="tnum absolute top-10 -translate-x-1/2 text-[11.5px] text-muted" style={{ left: p(1) }}>1.00</span>
        <span className="absolute top-10 text-[11.5px] text-muted" style={{ left: 0 }}>slower</span>
        <span className="absolute right-0 top-10 text-[11.5px] font-semibold text-crit">surge</span>
      </div>
      <p className="mt-3 text-[12.5px] text-ink-2">
        Ratio = 4-week average ÷ 12-week average. Strictly above {c.surge_ratio_threshold.toFixed(2)} (more than {Math.round((c.surge_ratio_threshold - 1) * 100)}% up), the SKU is flagged as surging and its reorder quantity becomes {c.surge_reorder_multiplier}× the standard quantity, rounded {c.reorder_rounding === "ceil" ? "up" : c.reorder_rounding.replace(/_/g, " ")}. Exactly {c.surge_ratio_threshold.toFixed(2)} is not a surge.
      </p>
    </div>
  );
}

export default async function Rules({ searchParams }: PageProps<"/rules">) {
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  const c = run?.result.config ?? DEFAULT_CONFIG;
  const docs = ruleDocs(c);

  return (
    <>
      <PageHeader eyebrow="Rules" title="How a decision is made"
        sub="Raghav's documented rules, which cover 80–85% of his recommendations, applied the same way to every SKU on every run. These are the thresholds this run used, read from the engine, not restated." />

      <div className="mx-auto grid max-w-[1320px] gap-6 px-4 py-8 sm:px-8 lg:grid-cols-2 lg:px-10">
        <Panel eyebrow="Rule 1 · demand" title="Two windows of weekly sales">
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: c.long_window_weeks }, (_, i) => (
              <div key={i} className={`h-10 flex-1 rounded-[4px] ${i >= c.long_window_weeks - c.short_window_weeks ? "bg-night" : "bg-paper-3"}`} />
            ))}
          </div>
          <div className="tnum mt-1.5 flex justify-between text-[11.5px] text-muted"><span>{c.long_window_weeks} weeks ago</span><span className="font-semibold text-ink">last {c.short_window_weeks} weeks</span><span>latest complete week</span></div>
          <p className="mt-3 text-[12.5px] text-ink-2">The average over the last {c.long_window_weeks} complete weeks is the baseline; the last {c.short_window_weeks} weeks show the trend. A week with no data counts as missing, not zero. A SKU without all {c.min_observed_weeks_long} weeks goes to the planner.</p>
        </Panel>

        <Panel eyebrow="Rule 2 · seasonality" title={`+${c.seasonal_uplift_pct}% in festival months`}>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
            {MONTHS.map((m, i) => {
              const on = c.festival_months.includes(i + 1);
              return (
                <div key={m} className={`rounded-[var(--radius-sm)] px-1 py-2.5 text-center ${on ? "bg-spice text-night" : "bg-paper-3 text-muted"}`}>
                  <div className="text-[12px] font-semibold">{m}</div>
                  <div className="tnum text-[11px]">{on ? `+${c.seasonal_uplift_pct}%` : "—"}</div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[12.5px] text-ink-2">In {c.festival_months.map((m) => MONTHS[m - 1]).join(", ")}, the 12-week average is raised by {c.seasonal_uplift_pct}% before weeks of stock are worked out. The month of the evaluation date decides; the calendar file is checked against it and any disagreement is flagged.</p>
        </Panel>

        <Panel eyebrow="Rule 3 · surge" title="When demand is running hot">
          <SurgeScale c={c} />
        </Panel>

        <Panel eyebrow="Rule 4 · weeks of stock" title="Units on hand ÷ adjusted weekly demand">
          <div className="space-y-8">
            <RangeRule title="Low perishability" lo={c.low_perish_stockout_weeks} hi={c.low_perish_overstock_weeks} note="beverages, snacks, staples" />
            <RangeRule title="High perishability" lo={c.high_perish_stockout_weeks} hi={c.high_perish_overstock_weeks} note="dairy alternatives, fresh bread" />
          </div>
        </Panel>

        <Panel eyebrow="Boundary" title="When the rules step aside" className="lg:col-span-1">
          <p className="mb-3 text-[13px] text-ink-2">These SKUs get no quantity. They go to the planner, who decides and writes a note.</p>
          <ul className="space-y-2 text-[13px] text-ink-2">
            {["Too little sales history: a new launch, or gaps in the export",
              "Missing, negative, conflicting or future-dated stock records",
              "An invalid perishability class, reorder quantity or unit of measure",
              `Zero demand over ${c.long_window_weeks} weeks: possibly delisted, or a supply problem`].map((t) => (
              <li key={t} className="flex gap-2.5"><span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full border border-ink-2" />{t}</li>
            ))}
          </ul>
        </Panel>

        <Panel eyebrow="Boundary" title="Where people and AI fit">
          <ol className="space-y-3 text-[13px]">
            {[
              ["Rules decide", "Every action and quantity comes from the rules above. Gemini never sets one."],
              ["Gemini summarises", "It drafts the planner brief from the engine's output. A draft mentioning any number the engine didn't produce is thrown away for a plain template."],
              ["People approve", "Each reorder needs a named approver; changing or rejecting one needs a reason. The override rate shows when the rules need revisiting."],
              ["Zoho places the order", "The app exports approved lines and never contacts a supplier."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-night text-[11.5px] font-bold text-spice">{i + 1}</span>
                <div><div className="font-semibold">{t}</div><p className="text-ink-2">{d}</p></div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[12px] text-muted">Not modelled: supplier pack sizes, minimum order quantities, lead times, safety stock, and sales lost to past stockouts.</p>
        </Panel>
      </div>

      <section id="rulebook" className="mx-auto max-w-[1320px] scroll-mt-24 space-y-6 px-4 pb-10 sm:px-8 lg:px-10">
        <Panel eyebrow="Institutional memory" title="Rulebook"
          sub="Why each rule exists, its edge cases and its owner, written down so the logic survives people changing roles. Ask it a question, or download it."
          right={<a href={`/api/rulebook${run ? `?run=${run.id}` : ""}`} className={buttonClass("ghost", "sm")}><IconDownload width={15} height={15} /> Download (.md)</a>}>
          <RulebookAsk runId={run?.id} />
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          {docs.map((r) => (
            <article id={r.id} key={r.id} className="scroll-mt-24 rounded-[var(--radius-xl)] border border-line bg-paper-2 p-5 shadow-[var(--shadow-1)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-night px-1.5 py-0.5 font-mono text-[11.5px] text-spice">{r.id}</span>
                <h3 className="font-display text-[18px] font-semibold tracking-tight">{r.title}</h3>
                <Tag tone={r.kind === "variable" ? "warn" : "plain"}>{r.kind}</Tag>
              </div>
              <p className="mt-2 text-[13.5px] font-medium">{r.rule}</p>
              <p className="mt-2 text-[13px] text-ink-2"><b className="font-semibold text-ink">Why it exists.</b> {r.why}</p>
              <ul className="mt-2 space-y-1 text-[12.5px] text-ink-2">{r.edges.map((e) => <li key={e} className="flex gap-2"><span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-2" />{e}</li>)}</ul>
              <div className="mt-3 text-[12px] text-muted">Owner: <b className="font-semibold text-ink">{PEOPLE[r.owner].name}</b> ({PEOPLE[r.owner].role}) · Source: {r.source}</div>
            </article>
          ))}
        </div>

        <Panel eyebrow="Mapped before go-live" title="Conflict map" sub="Where two rules can disagree for the same SKU, which one wins, and what the monthly review should ask. Every instance is logged on Oversight.">
          <ul className="divide-y divide-line">
            {(Object.keys(CONFLICT_POLICY) as ConflictCode[]).map((k, i) => (
              <li id={`C${i + 1}`} key={k} className="grid scroll-mt-24 gap-x-6 gap-y-1 py-3 text-[13px] md:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
                <div><span className="font-mono text-[11.5px] text-muted">C{i + 1}</span> <b className="font-semibold">{CONFLICT_LABEL[k]}</b></div>
                <div className="text-ink-2"><b className="font-semibold text-ink">Winner:</b> {CONFLICT_POLICY[k].winner}</div>
                <div className="text-ink-2"><b className="font-semibold text-ink">Review:</b> {CONFLICT_POLICY[k].review} <span className="text-muted">({PEOPLE[CONFLICT_POLICY[k].owner].name})</span></div>
              </li>
            ))}
          </ul>
        </Panel>

        <div id="V1" className="grid scroll-mt-24 gap-4 md:grid-cols-2">
          <Panel eyebrow="Expect these to change" title="Variables" sub="Review them when the business or the data changes; each has an owner in the rulebook.">
            <ul className="space-y-1.5 text-[13px] text-ink-2">{VARIABLES.map((v) => <li key={v} className="flex gap-2"><span aria-hidden className="mt-2 h-1 w-3 shrink-0 rounded-full bg-amber" />{v}</li>)}</ul>
          </Panel>
          <Panel eyebrow="Hold these by design" title="Constants" sub="Changing any of these changes what the system is, not how it's tuned.">
            <ul className="space-y-1.5 text-[13px] text-ink-2">{CONSTANTS.map((v) => <li key={v} className="flex gap-2"><span aria-hidden className="mt-2 h-1 w-3 shrink-0 rounded-full bg-night" />{v}</li>)}</ul>
          </Panel>
        </div>
      </section>
    </>
  );
}
