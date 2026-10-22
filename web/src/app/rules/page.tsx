import { Card } from "@/components/ui";
import { DEFAULT_CONFIG } from "@/lib/engine/config";
import { loadRun } from "@/lib/runs";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Rules({ searchParams }: PageProps<"/rules">) {
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  const c = run?.result.config ?? DEFAULT_CONFIG;
  const festival = c.festival_months.map((m) => MONTHS[m - 1]).join(", ");

  const steps: [string, string][] = [
    ["Demand", `The average weekly sales over the last ${c.long_window_weeks} complete weeks, and over the last ${c.short_window_weeks}. A week with no data counts as missing, not zero. A SKU without all ${c.long_window_weeks} weeks goes to the planner.`],
    ["Festival uplift", `In ${festival}, the ${c.long_window_weeks}-week average is raised by ${c.seasonal_uplift_pct}% before anything else is checked.`],
    ["Surge", `If the ${c.short_window_weeks}-week average is more than ${Math.round((c.surge_ratio_threshold - 1) * 100)}% above the ${c.long_window_weeks}-week average, the SKU is flagged as surging and its reorder quantity is ×${c.surge_reorder_multiplier} the standard quantity, rounded up.`],
    ["Weeks of stock", "Units on hand (summed across warehouses) divided by the adjusted weekly demand."],
    ["Low perishability", `Under ${c.low_perish_stockout_weeks} weeks: reorder now. Over ${c.low_perish_overstock_weeks} weeks: pause the next order. ${c.low_perish_stockout_weeks} to ${c.low_perish_overstock_weeks} inclusive: in range.`],
    ["High perishability", `Under ${c.high_perish_stockout_weeks} weeks: reorder now. Over ${c.high_perish_overstock_weeks} weeks: pause. ${c.high_perish_stockout_weeks} to ${c.high_perish_overstock_weeks} inclusive: in range.`],
  ];
  const review = [
    "fewer than the required weeks of sales history: a new launch, or gaps in the export",
    "missing, negative, conflicting or future-dated stock records",
    "an invalid perishability class, reorder quantity or unit of measure",
    "zero demand over the 12 weeks: possibly delisted, or a supply problem",
  ];

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="font-serif text-[28px] leading-tight tracking-tight">How a decision is made</h1>
        <p className="mt-1 text-[13px] text-ink-2">These are Raghav&apos;s documented rules, which cover 80–85% of his recommendations, applied the same way to every SKU on every run. The thresholds below are the ones this run used.</p>
      </div>
      <Card>
        <ol className="space-y-3">
          {steps.map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{i + 1}</span>
              <div><div className="text-[14px] font-semibold">{t}</div><p className="text-[13.5px] text-ink-2">{d}</p></div>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="When the rules step aside" sub="These SKUs get no quantity. They go to the planner, who decides and writes a note.">
        <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-ink-2">{review.map((r) => <li key={r}>{r}</li>)}</ul>
      </Card>
      <Card title="Where people and AI fit">
        <ul className="space-y-2 text-[13.5px] text-ink-2">
          <li><b className="text-ink">Rules decide.</b> Every action and quantity comes from the steps above. Gemini never decides one.</li>
          <li><b className="text-ink">Gemini summarises.</b> It drafts the planner brief from the engine&apos;s output. If the draft mentions any number the engine didn&apos;t produce, the app discards it and uses a plain template.</li>
          <li><b className="text-ink">People approve.</b> Each reorder needs a named approver. Changing or rejecting a quantity needs a reason, and the override rate shows when the rules need revisiting.</li>
          <li><b className="text-ink">Zoho places the order.</b> The app exports approved lines; it never contacts a supplier.</li>
        </ul>
      </Card>
      <p className="text-[12px] text-muted">Not modelled: supplier pack sizes, minimum order quantities, lead times, safety stock, and sales lost to past stockouts.</p>
    </div>
  );
}
