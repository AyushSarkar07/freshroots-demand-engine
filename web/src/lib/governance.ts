/**
 * Institutional knowledge, written down so it survives people leaving: why each rule
 * exists, who owns it, which rules can conflict and which one wins, what to do when the
 * world stops matching the model, and who is accountable for what.
 */
import type { ConflictCode } from "./conflicts";
import type { EngineConfig } from "./engine/config";

export const PEOPLE = {
  raghav: { name: "Raghav Kulkarni", role: "Senior Demand Planner" },
  priya: { name: "Priya Sharma", role: "Data Analyst" },
  deepa: { name: "Deepa Nair", role: "Head of Operations" },
  it: { name: "SAP team (IT)", role: "3-person IT team" },
  procurement: { name: "Procurement lead", role: "Purchase-order approver" },
} as const;
export type PersonKey = keyof typeof PEOPLE;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface RuleDoc {
  id: string;
  title: string;
  rule: string;
  why: string;
  edges: string[];
  owner: PersonKey;
  kind: "variable" | "constant";
  source: string;
}

export function ruleDocs(c: EngineConfig): RuleDoc[] {
  const fm = c.festival_months.map((m) => MONTHS[m - 1]).join(", ");
  return [
    {
      id: "R1", title: "Demand windows", owner: "raghav", kind: "variable", source: "Raghav's documented rules (case brief)",
      rule: `Baseline = average weekly sales over the last ${c.long_window_weeks} complete weeks; trend = the last ${c.short_window_weeks} weeks.`,
      why: `${c.long_window_weeks} weeks smooths one-off weeks without hiding a season; ${c.short_window_weeks} weeks is short enough to catch a competitor scheme or a festival build-up that a monthly cycle misses.`,
      edges: [`Fewer than ${c.min_observed_weeks_long} observed weeks (a new launch, or gaps in the export): held for the planner, no quantity.`, "A missing week is missing, never zero.", "Zero sales for 12 weeks: held (delisted, or a supply problem)."],
    },
    {
      id: "R2", title: "Festival uplift", owner: "raghav", kind: "variable", source: "Raghav's documented rules; festival calendar from SAP",
      rule: `In ${fm}, demand is raised by ${c.seasonal_uplift_pct}% before any threshold check.`,
      why: "Navratri, Dussehra and Diwali (Oct–Nov) and Gudi Padwa and Holi (Mar) lift FMCG demand across Maharashtra and Goa; without the uplift the rules would under-order into the peak.",
      edges: ["Festival dates move year to year (Diwali can fall in October or November); the calendar file is checked against the rule and disagreements are flagged.", "Applied by evaluation month, not by the week the stock will be sold in."],
    },
    {
      id: "R3", title: "Demand surge", owner: "raghav", kind: "variable", source: "Raghav's documented rules",
      rule: `If the ${c.short_window_weeks}-week average is more than ${Math.round((c.surge_ratio_threshold - 1) * 100)}% above the ${c.long_window_weeks}-week average, reorder ${c.surge_reorder_multiplier}× the standard quantity (rounded up).`,
      why: "A sustained jump means the standard quantity will run out before the next order arrives.",
      edges: [`Exactly ${c.surge_ratio_threshold.toFixed(2)} is not a surge.`, "A surge only changes the quantity; if stock is already above range, no order is placed (see conflict map)."],
    },
    {
      id: "R4", title: "Low-perishability range", owner: "raghav", kind: "variable", source: "Raghav's documented rules",
      rule: `Under ${c.low_perish_stockout_weeks} weeks of stock: reorder. Over ${c.low_perish_overstock_weeks}: pause the next order. ${c.low_perish_stockout_weeks}–${c.low_perish_overstock_weeks} inclusive: in range.`,
      why: "Covers the order cycle plus supplier lead time without tying cash up in slow stock. Stockouts cost Freshroots ₹18–22 lakh a quarter.",
      edges: [`Exactly ${c.low_perish_stockout_weeks} or ${c.low_perish_overstock_weeks} weeks needs no action.`, "Stock is summed across warehouses because sales are reported per SKU, not per warehouse."],
    },
    {
      id: "R5", title: "High-perishability range", owner: "raghav", kind: "variable", source: "Raghav's documented rules",
      rule: `Under ${c.high_perish_stockout_weeks} weeks: reorder. Over ${c.high_perish_overstock_weeks}: pause. ${c.high_perish_stockout_weeks}–${c.high_perish_overstock_weeks} inclusive: in range.`,
      why: "Most of the ₹10–12 lakh quarterly write-offs are perishables; a tight window keeps fresh stock fresh.",
      edges: ["The standard reorder quantity can overshoot a 4-week maximum on its own; the conflict check flags it before approval."],
    },
    {
      id: "R6", title: "Fail loudly", owner: "priya", kind: "constant", source: "Design decision, MESA Term 2",
      rule: "Every row is validated. A bad row holds only its own SKU for review, with the exact reason; nothing missing is treated as zero.",
      why: "A silent wrong answer is worse than no answer: the planner can act on a visible gap, not on an invisible one.",
      edges: ["Unknown SKUs in sales or stock are quarantined and listed.", "A missing column refuses the whole upload; the previous run stays in place."],
    },
    {
      id: "R7", title: "People approve, AI explains", owner: "procurement", kind: "constant", source: "Nine Checks: failure risk and judgment boundaries",
      rule: "Every reorder needs a named approver and an explicit confirm. Changing or rejecting a recommendation needs a reason. Gemini only drafts the brief and never sets a quantity.",
      why: "A wrong purchase order costs real money, so accountability sits with a person, and the friction keeps people reading instead of rubber-stamping.",
      edges: ["There is deliberately no “approve all”.", "Scenario runs can't be approved or exported."],
    },
  ];
}

export interface ConflictPolicy { winner: string; owner: PersonKey; review: string }
export const CONFLICT_POLICY: Record<ConflictCode, ConflictPolicy> = {
  SURGE_VS_OVERSTOCK: { winner: "Cover rule wins: no order while stock is above range.", owner: "raghav", review: "If it repeats for a SKU, the overstock limit may be too low for its new demand." },
  UPLIFT_FLIPS_DECISION: { winner: "Uplift applies (documented rule).", owner: "raghav", review: "Check the SKU really is festival-sensitive; staples often aren't." },
  ORDER_STILL_SHORT: { winner: "Standard quantity is ordered; the planner may edit it upward with a reason.", owner: "raghav", review: "Raise the SKU's standard reorder quantity in the SKU master." },
  ORDER_OVERSHOOTS_MAX: { winner: "Standard quantity is recommended; the approver may edit it down with a reason.", owner: "procurement", review: "Lower the standard quantity or split deliveries for perishables." },
  HOLD_VS_STOCKOUT: { winner: "The data hold wins: no automatic order. Escalate to the planner the same day.", owner: "priya", review: "Fix the source data so the hold doesn't recur." },
  CALENDAR_VS_RULE: { winner: "The configured festival-month rule wins.", owner: "raghav", review: "Update festival months for the year, or correct the calendar export." },
};

export interface FailureCase {
  scenario: string;
  signal: string;
  automatic: string;
  override: string;
  owner: PersonKey;
}

export const PLAYBOOK: FailureCase[] = [
  { scenario: "SAP export is late or stale", signal: "Run-level warning: sales week or stock snapshot older than allowed; shown in the attention banner.", automatic: "The engine still runs, labels the data as stale and never fills the gap.", override: "Hold approvals until a fresh export lands; the previous run stays viewable.", owner: "priya" },
  { scenario: "Export format changes (column renamed, SAP to another system)", signal: "Upload refused with SchemaValidationError; drift report lists added or removed columns.", automatic: "Nothing is stored; the current run is unchanged.", override: "IT re-exports with the agreed column names; column names are matched case-insensitively.", owner: "it" },
  { scenario: "New SKU or lost sales history", signal: "INSUFFICIENT_HISTORY hold; HISTORY_LOST early warning between runs.", automatic: "No quantity; held for the planner.", override: "Planner places a launch order with a written reason (“Order…” on the SKU).", owner: "raghav" },
  { scenario: "Festival dates move", signal: "Calendar check disagrees with the festival-month rule.", automatic: "Configured rule applies; conflict logged.", override: "Run a scenario with the uplift off to see the difference, then decide.", owner: "raghav" },
  { scenario: "Distributor changes or goes inactive", signal: "DISTRIBUTOR_CHANGED early warning; INACTIVE_DISTRIBUTOR data warning.", automatic: "Recommendation unchanged; flagged.", override: "Procurement confirms the supplier before exporting the purchase order.", owner: "procurement" },
  { scenario: "Demand shock (competitor scheme, distributor drops orders)", signal: "QTY_JUMP or DEMAND_SHIFT early warning; surge flag.", automatic: "Rules apply as written; alert sent.", override: "Approver edits the quantity with a reason; repeated edits raise the override rate.", owner: "raghav" },
  { scenario: "Gemini unavailable or invents a number", signal: "Brief marked as template, with the reason in the activity log.", automatic: "Template brief built from engine numbers only.", override: "None needed; decisions never depend on the brief.", owner: "it" },
  { scenario: "Database unavailable", signal: "Page error state; decisions don't save and say so.", automatic: "No partial writes are reported as success.", override: "Retry; export the recommendations CSV from the last good run if urgent.", owner: "it" },
];

export const VARIABLES = [
  "Festival months and the size of the uplift",
  "Surge threshold and multiplier",
  "Stock-cover ranges for each perishability class",
  "Standard reorder quantity per SKU (SKU master)",
  "The distributor list and each SKU's distributor",
  "The SAP export format and how often it arrives",
];
export const CONSTANTS = [
  "Missing data is never treated as zero",
  "One decision per SKU per run, explained in words",
  "No purchase order without a named approver",
  "AI never sets a quantity",
];

export const ADOPTION = {
  champion: { person: "raghav" as PersonKey, why: "His rules run the engine and his time moves from two days of Excel to the 15–20% of cases that need judgment, so the tool's success is his success." },
  sponsor: { person: "deepa" as PersonKey, why: "Owns the monthly review of conflicts, overrides and outcomes, and the KPI conversation with HR." },
  accountability: [
    { who: "procurement" as PersonKey, for: "Each approved purchase order. That's why approval needs a confirm and a reason for changes." },
    { who: "raghav" as PersonKey, for: "The rules and every planner-review SKU." },
    { who: "priya" as PersonKey, for: "Getting a valid export in twice a week, and data-quality triage." },
    { who: "it" as PersonKey, for: "Export format, database and keys." },
  ],
  incentives: [
    "Measure the planning team on SKUs in range, stockouts and write-offs, not on how many forecasts they produced by hand.",
    "Never penalise an approver for following a documented recommendation that turns out wrong; review the rule instead.",
    "Don't reward usage. Logins and clicks are outputs; stock in range is the outcome.",
  ],
  people: [
    "No role is removed. Raghav keeps ownership of the rules and decides every exception; Priya keeps the export; procurement keeps the approval.",
    "The app fits the existing workflow: SAP export in, Zoho CSV out. Procurement learns one screen.",
  ],
};
