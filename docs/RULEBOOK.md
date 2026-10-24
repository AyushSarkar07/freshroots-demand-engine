# Freshroots Reorder Desk · Rulebook

Why every rule exists, who owns it, where rules conflict, and what to do when the world stops matching the model. Generated from the engine configuration used by the run evaluated 2026-10-22.

## R1 · Demand windows

Rule: Baseline = average weekly sales over the last 12 complete weeks; trend = the last 4 weeks.
Why it exists: 12 weeks smooths one-off weeks without hiding a season; 4 weeks is short enough to catch a competitor scheme or a festival build-up that a monthly cycle misses.
Edge cases:
- Fewer than 12 observed weeks (a new launch, or gaps in the export): held for the planner, no quantity.
- A missing week is missing, never zero.
- Zero sales for 12 weeks: held (delisted, or a supply problem).
Owner: Raghav Kulkarni (Senior Demand Planner). Type: variable. Source: Raghav's documented rules (case brief).

## R2 · Festival uplift

Rule: In Oct, Nov, Mar, demand is raised by 25% before any threshold check.
Why it exists: Navratri, Dussehra and Diwali (Oct–Nov) and Gudi Padwa and Holi (Mar) lift FMCG demand across Maharashtra and Goa; without the uplift the rules would under-order into the peak.
Edge cases:
- Festival dates move year to year (Diwali can fall in October or November); the calendar file is checked against the rule and disagreements are flagged.
- Applied by evaluation month, not by the week the stock will be sold in.
Owner: Raghav Kulkarni (Senior Demand Planner). Type: variable. Source: Raghav's documented rules; festival calendar from SAP.

## R3 · Demand surge

Rule: If the 4-week average is more than 20% above the 12-week average, reorder 1.5× the standard quantity (rounded up).
Why it exists: A sustained jump means the standard quantity will run out before the next order arrives.
Edge cases:
- Exactly 1.20 is not a surge.
- A surge only changes the quantity; if stock is already above range, no order is placed (see conflict map).
Owner: Raghav Kulkarni (Senior Demand Planner). Type: variable. Source: Raghav's documented rules.

## R4 · Low-perishability range

Rule: Under 6 weeks of stock: reorder. Over 14: pause the next order. 6–14 inclusive: in range.
Why it exists: Covers the order cycle plus supplier lead time without tying cash up in slow stock. Stockouts cost Freshroots ₹18–22 lakh a quarter.
Edge cases:
- Exactly 6 or 14 weeks needs no action.
- Stock is summed across warehouses because sales are reported per SKU, not per warehouse.
Owner: Raghav Kulkarni (Senior Demand Planner). Type: variable. Source: Raghav's documented rules.

## R5 · High-perishability range

Rule: Under 3 weeks: reorder. Over 4: pause. 3–4 inclusive: in range.
Why it exists: Most of the ₹10–12 lakh quarterly write-offs are perishables; a tight window keeps fresh stock fresh.
Edge cases:
- The standard reorder quantity can overshoot a 4-week maximum on its own; the conflict check flags it before approval.
Owner: Raghav Kulkarni (Senior Demand Planner). Type: variable. Source: Raghav's documented rules.

## R6 · Fail loudly

Rule: Every row is validated. A bad row holds only its own SKU for review, with the exact reason; nothing missing is treated as zero.
Why it exists: A silent wrong answer is worse than no answer: the planner can act on a visible gap, not on an invisible one.
Edge cases:
- Unknown SKUs in sales or stock are quarantined and listed.
- A missing column refuses the whole upload; the previous run stays in place.
Owner: Priya Sharma (Data Analyst). Type: constant. Source: Design decision, MESA Term 2.

## R7 · People approve, AI explains

Rule: Every reorder needs a named approver and an explicit confirm. Changing or rejecting a recommendation needs a reason. Gemini only drafts the brief and never sets a quantity.
Why it exists: A wrong purchase order costs real money, so accountability sits with a person, and the friction keeps people reading instead of rubber-stamping.
Edge cases:
- There is deliberately no “approve all”.
- Scenario runs can't be approved or exported.
Owner: Procurement lead (Purchase-order approver). Type: constant. Source: Nine Checks: failure risk and judgment boundaries.

## C1 · Conflict: Surge vs overstock

Which rule wins: Cover rule wins: no order while stock is above range.
Monthly review question: If it repeats for a SKU, the overstock limit may be too low for its new demand.
Owner: Raghav Kulkarni (Senior Demand Planner).

## C2 · Conflict: Festival uplift flips the decision

Which rule wins: Uplift applies (documented rule).
Monthly review question: Check the SKU really is festival-sensitive; staples often aren't.
Owner: Raghav Kulkarni (Senior Demand Planner).

## C3 · Conflict: Order too small to reach range

Which rule wins: Standard quantity is ordered; the planner may edit it upward with a reason.
Monthly review question: Raise the SKU's standard reorder quantity in the SKU master.
Owner: Raghav Kulkarni (Senior Demand Planner).

## C4 · Conflict: Order overshoots the maximum

Which rule wins: Standard quantity is recommended; the approver may edit it down with a reason.
Monthly review question: Lower the standard quantity or split deliveries for perishables.
Owner: Procurement lead (Purchase-order approver).

## C5 · Conflict: Data hold vs stockout risk

Which rule wins: The data hold wins: no automatic order. Escalate to the planner the same day.
Monthly review question: Fix the source data so the hold doesn't recur.
Owner: Priya Sharma (Data Analyst).

## C6 · Conflict: Calendar vs festival rule

Which rule wins: The configured festival-month rule wins.
Monthly review question: Update festival months for the year, or correct the calendar export.
Owner: Raghav Kulkarni (Senior Demand Planner).

## F1 · Failure: SAP export is late or stale

How it shows up: Run-level warning: sales week or stock snapshot older than allowed; shown in the attention banner.
What the system does: The engine still runs, labels the data as stale and never fills the gap.
Override: Hold approvals until a fresh export lands; the previous run stays viewable.
Owner: Priya Sharma (Data Analyst).

## F2 · Failure: Export format changes (column renamed, SAP to another system)

How it shows up: Upload refused with SchemaValidationError; drift report lists added or removed columns.
What the system does: Nothing is stored; the current run is unchanged.
Override: IT re-exports with the agreed column names; column names are matched case-insensitively.
Owner: SAP team (IT) (3-person IT team).

## F3 · Failure: New SKU or lost sales history

How it shows up: INSUFFICIENT_HISTORY hold; HISTORY_LOST early warning between runs.
What the system does: No quantity; held for the planner.
Override: Planner places a launch order with a written reason (“Order…” on the SKU).
Owner: Raghav Kulkarni (Senior Demand Planner).

## F4 · Failure: Festival dates move

How it shows up: Calendar check disagrees with the festival-month rule.
What the system does: Configured rule applies; conflict logged.
Override: Run a scenario with the uplift off to see the difference, then decide.
Owner: Raghav Kulkarni (Senior Demand Planner).

## F5 · Failure: Distributor changes or goes inactive

How it shows up: DISTRIBUTOR_CHANGED early warning; INACTIVE_DISTRIBUTOR data warning.
What the system does: Recommendation unchanged; flagged.
Override: Procurement confirms the supplier before exporting the purchase order.
Owner: Procurement lead (Purchase-order approver).

## F6 · Failure: Demand shock (competitor scheme, distributor drops orders)

How it shows up: QTY_JUMP or DEMAND_SHIFT early warning; surge flag.
What the system does: Rules apply as written; alert sent.
Override: Approver edits the quantity with a reason; repeated edits raise the override rate.
Owner: Raghav Kulkarni (Senior Demand Planner).

## F7 · Failure: Gemini unavailable or invents a number

How it shows up: Brief marked as template, with the reason in the activity log.
What the system does: Template brief built from engine numbers only.
Override: None needed; decisions never depend on the brief.
Owner: SAP team (IT) (3-person IT team).

## F8 · Failure: Database unavailable

How it shows up: Page error state; decisions don't save and say so.
What the system does: No partial writes are reported as success.
Override: Retry; export the recommendations CSV from the last good run if urgent.
Owner: SAP team (IT) (3-person IT team).

## V1 · Variables and constants

Variables (expected to change; review them):
- Festival months and the size of the uplift
- Surge threshold and multiplier
- Stock-cover ranges for each perishability class
- Standard reorder quantity per SKU (SKU master)
- The distributor list and each SKU's distributor
- The SAP export format and how often it arrives
Constants (hold by design):
- Missing data is never treated as zero
- One decision per SKU per run, explained in words
- No purchase order without a named approver
- AI never sets a quantity

## A1 · Ownership and adoption

Champion: Raghav Kulkarni (Senior Demand Planner). His rules run the engine and his time moves from two days of Excel to the 15–20% of cases that need judgment, so the tool's success is his success.
Sponsor: Deepa Nair (Head of Operations). Owns the monthly review of conflicts, overrides and outcomes, and the KPI conversation with HR.
Accountability:
- Procurement lead (Purchase-order approver): Each approved purchase order. That's why approval needs a confirm and a reason for changes.
- Raghav Kulkarni (Senior Demand Planner): The rules and every planner-review SKU.
- Priya Sharma (Data Analyst): Getting a valid export in twice a week, and data-quality triage.
- SAP team (IT) (3-person IT team): Export format, database and keys.
Incentives:
- Measure the planning team on SKUs in range, stockouts and write-offs, not on how many forecasts they produced by hand.
- Never penalise an approver for following a documented recommendation that turns out wrong; review the rule instead.
- Don't reward usage. Logins and clicks are outputs; stock in range is the outcome.
People:
- No role is removed. Raghav keeps ownership of the rules and decides every exception; Priya keeps the export; procurement keeps the approval.
- The app fits the existing workflow: SAP export in, Zoho CSV out. Procurement learns one screen.
