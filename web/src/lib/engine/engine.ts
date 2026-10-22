/**
 * Freshroots demand planning engine (TypeScript port of freshroots_engine.py).
 *
 * Deterministic and rule-based. Every function mirrors its Python counterpart, and
 * tests/parity.test.ts checks that both engines give identical decisions, data-quality
 * codes and explanations on the real SAP export. It never sends purchase orders.
 */
import { type EngineConfig, makeConfig } from "./config";
import { CsvParseError, parseCsv } from "./csv";
import {
  formatIsoWeek, isoDate, isoWeekOf, MONTH_ABBR, parseFlexibleDate, parseIsoDate, parseIsoWeek, validDay, ymKey, ymOf,
} from "./dates";
import { fmtNum, pyFixed, pyG, pyList, pyRepr, pyRound } from "./pyformat";

export const ENGINE_VERSION = "1.0.0";

export class FreshrootsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class InputFileError extends FreshrootsError {}
export class SchemaValidationError extends FreshrootsError {}
export class UnrecoverableDataError extends FreshrootsError {}

export const SKU_COLUMNS = ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID"];
export const INVENTORY_COLUMNS = ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"];
export const SALES_COLUMNS = ["SKU_ID", "Week", "Units_Sold"];

export const ACTION_REORDER = "IMMEDIATE_REORDER";
export const ACTION_PAUSE = "PAUSE_ORDER";
export const ACTION_MAINTAIN = "MAINTAIN";
export const ACTION_REVIEW = "MANUAL_REVIEW";
export type Action = typeof ACTION_REORDER | typeof ACTION_PAUSE | typeof ACTION_MAINTAIN | typeof ACTION_REVIEW;
const FLAG_SPURT = "HIGH_DEMAND_SPURT";

export type Severity = "ERROR" | "WARNING" | "INFO";
export interface DqRecord {
  Source_File: string;
  Row_Number: number | null;
  SKU_ID: string;
  Severity: Severity;
  Issue_Code: string;
  Detail: string;
  Disposition: string;
  Blocks_SKU: boolean;
}

export interface Recommendation {
  SKU_ID: string;
  SKU_Name: string;
  Category: string;
  Perishability: string;
  Units_On_Hand: number | null;
  avg_12w_sales: number | null;
  avg_4w_sales: number | null;
  seasonal_uplift_pct: number;
  baseline_demand: number | null;
  demand_ratio: number | null;
  demand_spurt_flag: boolean;
  weeks_of_stock: number | null;
  Flags: string;
  Action: Action;
  Standard_Reorder_Qty: number | null;
  effective_reorder_qty: number | null;
  Recommended_Order_Qty: number;
  Data_Quality_Status: "OK" | "WARNING" | "ERROR";
  Data_Quality_Notes: string;
  Review_Required: boolean;
  Explanation: string;
  Distributor_ID: string;
  Location_Count: number;
  Locations: string;
  weeks_observed_12w: number;
  weeks_observed_4w: number;
  reorder_multiplier: number;
  Inventory_Flag: string;
  Indicative_Action: string;
  Review_Reasons: string;
  Evaluation_Date: string;
  Inventory_As_Of_Date: string;
  Sales_Cutoff_Week: string;
}

export interface EngineInputs {
  sku_master: string;
  current_inventory: string;
  weekly_sales: string;
  calendar?: string | null;
  distributor_master?: string | null;
}

// CSV rows are text; validation adds parsed fields alongside. Parity tests pin the behaviour.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = { _row: string; [column: string]: any };
type Rec = { SKU_ID?: unknown; _row?: string | number | null };

// --------------------------------------------------------------------------- //
// Data-quality log
// --------------------------------------------------------------------------- //

class DataQualityLog {
  records: DqRecord[] = [];
  add(source: string, code: string, detail: string, severity: Severity = "WARNING", sku = "", row: number | null = null,
      disposition = "KEPT", blocks = false) {
    this.records.push({ Source_File: source, Row_Number: row, SKU_ID: sku, Severity: severity, Issue_Code: code, Detail: detail, Disposition: disposition, Blocks_SKU: blocks });
  }
  addRows<T extends Rec>(rows: T[], source: string, code: string, detail: string | ((r: T) => string), severity: Severity = "WARNING",
                         disposition = "KEPT", blocks = false) {
    for (const r of rows) {
      this.add(source, code, typeof detail === "function" ? detail(r) : detail, severity, String(r.SKU_ID ?? ""),
        r._row != null ? Number(r._row) : null, disposition, blocks);
    }
  }
  blockedSkus(): Set<string> {
    return new Set(this.records.filter((r) => r.Blocks_SKU && r.SKU_ID).map((r) => r.SKU_ID));
  }
  globalIssues() {
    return this.records.filter((r) => r.Source_File === "run");
  }
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

const normaliseId = (v: string | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toUpperCase();
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** Strict numeric parse: thousands separators allowed, anything else -> NaN. */
export function toNumber(v: string | undefined): number {
  const s = (v ?? "").trim().replace(/,/g, "");
  return s !== "" && NUM_RE.test(s) ? Number(s) : NaN;
}
const isNum = (x: number | null | undefined): x is number => x != null && !Number.isNaN(x);
const keyOf = (...parts: unknown[]) => JSON.stringify(parts);

function findColumn(columns: string[], ...candidates: string[]): string | null {
  const lookup = new Map(columns.map((c) => [c.toLowerCase().replace(/ /g, "_"), c]));
  for (const cand of candidates) {
    const hit = lookup.get(cand.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function readTable(text: string | null | undefined, name: string, required: boolean) {
  if (text == null) {
    if (required) throw new InputFileError(`Required input file '${name}' not provided`);
    return null;
  }
  try {
    return parseCsv(text);
  } catch (e) {
    if (e instanceof CsvParseError) throw new InputFileError(`Could not parse ${name}: ${e.message}`);
    throw e;
  }
}

/** Map headers case-insensitively onto canonical names; fail loudly if any are missing. */
function requireSchema(table: { columns: string[]; rows: Record<string, string>[] } | null, required: string[], name: string): Row[] {
  if (!table || table.columns.length === 0) throw new UnrecoverableDataError(`${name} is empty (no header row).`);
  const lookup = new Map(table.columns.map((c) => [c.toLowerCase().replace(/ /g, "_"), c]));
  const rename: Record<string, string> = {};
  const missing: string[] = [];
  for (const col of required) {
    if (table.columns.includes(col)) continue;
    const src = lookup.get(col.toLowerCase());
    if (src) rename[src] = col;
    else missing.push(col);
  }
  if (missing.length) {
    throw new SchemaValidationError(`${name} is missing required column(s) ${pyList(missing)}. Found columns: ${pyList(table.columns)}`);
  }
  if (!table.rows.length) throw new UnrecoverableDataError(`${name} has a header but no data rows.`);
  return table.rows.map((r) => {
    const out: Record<string, string> = { ...r };
    for (const [from, to] of Object.entries(rename)) out[to] = r[from];
    return out as Row;
  });
}

/** Rows whose key appears more than once (pandas duplicated(keep=False)). */
function duplicatedAll<T>(rows: T[], key: (r: T) => string): boolean[] {
  const counts = new Map<string, number>();
  rows.forEach((r) => counts.set(key(r), (counts.get(key(r)) ?? 0) + 1));
  return rows.map((r) => (counts.get(key(r)) ?? 0) > 1);
}
/** Rows that repeat an earlier row's key (pandas duplicated(keep="first")). */
function duplicatedLater<T>(rows: T[], key: (r: T) => string): boolean[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const k = key(r);
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  });
}

// --------------------------------------------------------------------------- //
// Validation
// --------------------------------------------------------------------------- //

type SkuRow = Row;
interface MasterSku {
  SKU_ID: string;
  SKU_Name: string;
  Category: string;
  Perishability: string;
  Standard_Reorder_Qty: number;
  Distributor_ID: string;
  Unit_Cost: number;
  _row: string;
}

function validateSkuMaster(table: ReturnType<typeof readTable>, config: EngineConfig, dq: DataQualityLog,
                           distributorIds: Set<string> | null): MasterSku[] {
  const src = "sku_master";
  let rows = requireSchema(table, SKU_COLUMNS, src).map((r) => ({ ...r, SKU_ID: normaliseId(r.SKU_ID), Distributor_ID: normaliseId(r.Distributor_ID) })) as SkuRow[];

  const blank = rows.filter((r) => r.SKU_ID === "");
  dq.addRows(blank, src, "BLANK_SKU_ID", "Row has no SKU_ID", "ERROR", "QUARANTINED");
  rows = rows.filter((r) => r.SKU_ID !== "");

  const exact = duplicatedLater(rows, (r) => keyOf(...SKU_COLUMNS.map((c) => r[c])));
  dq.addRows(rows.filter((_, i) => exact[i]), src, "DUPLICATE_SKU_ROW", "Identical duplicate master row collapsed", "WARNING", "COLLAPSED");
  rows = rows.filter((_, i) => !exact[i]);
  const conflict = duplicatedAll(rows, (r) => r.SKU_ID);
  dq.addRows(rows.filter((_, i) => conflict[i]), src, "CONFLICTING_SKU_MASTER",
    "SKU_ID appears more than once with different attributes; first row shown, SKU held for review", "ERROR", "SKU_BLOCKED", true);
  const later = duplicatedLater(rows, (r) => r.SKU_ID);
  rows = rows.filter((_, i) => !later[i]);

  const catMap = new Map(config.valid_categories.map((c) => [c.toLowerCase(), c]));
  dq.addRows(rows.filter((r) => !catMap.has(r.Category.toLowerCase())), src, "UNKNOWN_CATEGORY",
    (r) => `Category ${pyRepr(r.Category)} is not one of ${pyList(config.valid_categories)}; kept (category does not affect the reorder rules)`, "WARNING");
  rows = rows.map((r) => ({ ...r, Category: catMap.get(r.Category.toLowerCase()) ?? r.Category }));

  const perMap = new Map(config.valid_perishability.map((p) => [p.toLowerCase(), p]));
  dq.addRows(rows.filter((r) => !perMap.has(r.Perishability.toLowerCase())), src, "INVALID_PERISHABILITY",
    (r) => `Perishability ${pyRepr(r.Perishability)} is not one of ${pyList(config.valid_perishability)}`, "ERROR", "SKU_BLOCKED", true);
  rows = rows.map((r) => ({ ...r, Perishability: perMap.get(r.Perishability.toLowerCase()) ?? r.Perishability }));

  const qty = rows.map((r) => toNumber(r.Standard_Reorder_Qty));
  const badQty = qty.map((q) => Number.isNaN(q) || q <= 0 || q !== Math.floor(q));
  dq.addRows(rows.filter((_, i) => badQty[i]), src, "INVALID_REORDER_QTY",
    (r) => `Standard_Reorder_Qty ${pyRepr(r.Standard_Reorder_Qty)} is not a positive whole number`, "ERROR", "SKU_BLOCKED", true);

  const expected = config.expected_unit_of_measure.toLowerCase();
  dq.addRows(rows.filter((r) => r.Unit_of_Measure === ""), src, "MISSING_UOM",
    `Unit_of_Measure blank; treated as ${pyRepr(config.expected_unit_of_measure)} (sales and inventory carry no unit)`, "WARNING");
  dq.addRows(rows.filter((r) => r.Unit_of_Measure !== "" && r.Unit_of_Measure.toLowerCase() !== expected), src, "UNSUPPORTED_UOM",
    (r) => `Unit_of_Measure ${pyRepr(r.Unit_of_Measure)} differs from ${pyRepr(config.expected_unit_of_measure)}; cover cannot be computed in consistent units`,
    "ERROR", "SKU_BLOCKED", true);

  dq.addRows(rows.filter((r) => r.SKU_Name === ""), src, "MISSING_SKU_NAME", "SKU_Name is blank", "WARNING");
  dq.addRows(rows.filter((r) => r.Distributor_ID === ""), src, "MISSING_DISTRIBUTOR", "Distributor_ID is blank", "WARNING");
  if (distributorIds) {
    dq.addRows(rows.filter((r) => r.Distributor_ID !== "" && !distributorIds.has(r.Distributor_ID)), src, "UNKNOWN_DISTRIBUTOR",
      (r) => `Distributor_ID ${pyRepr(r.Distributor_ID)} not in distributor_master`, "WARNING");
  }

  const costCol = findColumn(table!.columns, "Unit_Cost", "Unit_Cost_INR", "Cost_Per_Unit");
  let cost = rows.map(() => NaN);
  if (costCol) {
    cost = rows.map((r) => toNumber(r[costCol]));
    const bad = cost.map((c) => Number.isNaN(c) || c < 0);
    dq.addRows(rows.filter((_, i) => bad[i]), src, "INVALID_UNIT_COST",
      (r) => `${costCol} ${pyRepr(r[costCol])} is not a valid non-negative number; excluded from value estimates`, "WARNING");
    cost = cost.map((c, i) => (bad[i] ? NaN : c));
  }

  return rows
    .map((r, i) => ({
      SKU_ID: r.SKU_ID, SKU_Name: r.SKU_Name, Category: r.Category, Perishability: r.Perishability,
      Standard_Reorder_Qty: badQty[i] ? NaN : qty[i], Distributor_ID: r.Distributor_ID, Unit_Cost: cost[i], _row: r._row,
    }))
    .sort((a, b) => (a.SKU_ID < b.SKU_ID ? -1 : a.SKU_ID > b.SKU_ID ? 1 : 0));
}

type InvRow = Row & { on_hand: number; as_of: number | null };
export interface InventoryAgg {
  SKU_ID: string;
  Units_On_Hand: number;
  Location_Count: number;
  Locations: string;
  as_of_min: number | null;
  as_of_max: number | null;
  inventory_valid: boolean;
}

function validateInventory(table: ReturnType<typeof readTable>, masterIds: Set<string>, evalDay: number, config: EngineConfig,
                           dq: DataQualityLog): { valid: InvRow[]; agg: Map<string, InventoryAgg> } {
  const src = "current_inventory";
  let rows = requireSchema(table, INVENTORY_COLUMNS, src).map((r) => ({ ...r, SKU_ID: normaliseId(r.SKU_ID), Location: r.Location.replace(/\s+/g, " ") })) as Row[] as InvRow[];

  dq.addRows(rows.filter((r) => r.SKU_ID === ""), src, "BLANK_SKU_ID", "Row has no SKU_ID", "ERROR", "QUARANTINED");
  dq.addRows(rows.filter((r) => r.SKU_ID !== "" && !masterIds.has(r.SKU_ID)), src, "UNKNOWN_SKU",
    (r) => `SKU_ID ${pyRepr(r.SKU_ID)} not in sku_master`, "ERROR", "QUARANTINED");
  rows = rows.filter((r) => r.SKU_ID !== "" && masterIds.has(r.SKU_ID));
  rows = rows.map((r) => ({ ...r, on_hand: toNumber(r.Units_On_Hand), as_of: parseFlexibleDate(r.As_Of_Date) }));

  const exact = duplicatedLater(rows, (r) => keyOf(r.SKU_ID, r.Location, r.Units_On_Hand, r.As_Of_Date));
  dq.addRows(rows.filter((_, i) => exact[i]), src, "DUPLICATE_INVENTORY_ROW", "Identical duplicate snapshot collapsed", "WARNING", "COLLAPSED");
  rows = rows.filter((_, i) => !exact[i]);
  const conflict = duplicatedAll(rows, (r) => keyOf(r.SKU_ID, r.Location));
  dq.addRows(rows.filter((_, i) => conflict[i]), src, "CONFLICTING_INVENTORY_SNAPSHOT",
    (r) => `More than one differing snapshot for ${r.SKU_ID} at ${pyRepr(r.Location)} (Units_On_Hand=${pyRepr(r.Units_On_Hand)}, As_Of_Date=${pyRepr(r.As_Of_Date)})`,
    "ERROR", "SKU_BLOCKED", true);

  const checks: [(r: InvRow) => boolean, string, (r: InvRow) => string][] = [
    [(r) => r.Location === "", "BLANK_LOCATION", () => "Location is blank"],
    [(r) => r.Units_On_Hand === "", "MISSING_INVENTORY_VALUE", () => "Units_On_Hand is blank (not assumed to be zero)"],
    [(r) => r.Units_On_Hand !== "" && Number.isNaN(r.on_hand), "INVALID_NUMERIC", (r) => `Units_On_Hand ${pyRepr(r.Units_On_Hand)} is not numeric`],
    [(r) => r.on_hand < 0, "NEGATIVE_INVENTORY", (r) => `Units_On_Hand ${r.Units_On_Hand} is negative`],
    [(r) => r.as_of == null, "INVALID_AS_OF_DATE", (r) => `As_Of_Date ${pyRepr(r.As_Of_Date)} is missing or not a recognised date`],
    [(r) => r.as_of != null && r.as_of > evalDay, "FUTURE_SNAPSHOT", (r) => `As_Of_Date ${r.As_Of_Date} is after evaluation date ${isoDate(evalDay)}`],
  ];
  const invalid = rows.map(() => false);
  for (const [test, code, detail] of checks) {
    const hit = rows.map((r, i) => !invalid[i] && test(r));
    dq.addRows(rows.filter((_, i) => hit[i]), src, code, detail, "ERROR", "SKU_BLOCKED", true);
    hit.forEach((h, i) => h && (invalid[i] = true));
  }
  conflict.forEach((c, i) => c && (invalid[i] = true));

  dq.addRows(rows.filter((r, i) => !invalid[i] && r.on_hand !== Math.floor(r.on_hand)), src, "FRACTIONAL_INVENTORY",
    (r) => `Units_On_Hand ${r.Units_On_Hand} is fractional`, "WARNING");
  dq.addRows(rows.filter((r, i) => !invalid[i] && r.as_of != null && evalDay - r.as_of > config.stale_inventory_days), src, "STALE_INVENTORY",
    (r) => `Snapshot ${r.As_Of_Date} is more than ${config.stale_inventory_days} days before evaluation date ${isoDate(evalDay)}`, "WARNING");

  const valid = rows.filter((_, i) => !invalid[i]);
  const allSkus = [...new Set(rows.map((r) => r.SKU_ID))].sort();
  const agg = new Map<string, InventoryAgg>();
  for (const sku of allSkus) {
    const mine = rows.map((r, i) => ({ r, ok: !invalid[i] })).filter((x) => x.r.SKU_ID === sku);
    const okRows = mine.filter((x) => x.ok).map((x) => x.r);
    const inventoryValid = mine.every((x) => x.ok);
    const dates = okRows.map((r) => r.as_of!).filter((d) => d != null);
    agg.set(sku, {
      SKU_ID: sku,
      Units_On_Hand: inventoryValid && okRows.length ? okRows.reduce((s, r) => s + r.on_hand, 0) : NaN,
      Location_Count: new Set(okRows.map((r) => r.Location)).size,
      Locations: okRows.map((r) => r.Location).sort().join("; "),
      as_of_min: dates.length ? Math.min(...dates) : null,
      as_of_max: dates.length ? Math.max(...dates) : null,
      inventory_valid: inventoryValid,
    });
  }

  for (const a of agg.values()) {
    if (a.inventory_valid && a.as_of_min !== a.as_of_max) {
      dq.add(src, "MIXED_SNAPSHOT_DATES",
        `Locations report different snapshot dates (${isoDate(a.as_of_min!)} to ${isoDate(a.as_of_max!)}); summed as-is`, "WARNING", a.SKU_ID);
    }
  }
  for (const a of agg.values()) {
    if (!(a.inventory_valid && a.Location_Count > 1)) continue;
    if (config.inventory_aggregation === "require_single_location") {
      dq.add(src, "MULTIPLE_LOCATIONS", `Held in ${a.Location_Count} locations; policy require_single_location needs review`,
        "ERROR", a.SKU_ID, null, "SKU_BLOCKED", true);
    } else {
      dq.add(src, "LOCATIONS_SUMMED", `Stock summed across ${a.Location_Count} locations (${a.Locations})`, "INFO", a.SKU_ID);
    }
  }
  for (const sku of [...masterIds].sort()) {
    if (!agg.has(sku)) dq.add(src, "MISSING_INVENTORY", "No inventory record for this SKU (not assumed to be zero)", "ERROR", sku, null, "SKU_BLOCKED", true);
  }
  return { valid, agg };
}

export interface SalesRow {
  SKU_ID: string;
  Week: string;
  week_start: number;
  Units_Sold: number;
  _row: string;
}

function validateSales(table: ReturnType<typeof readTable>, masterIds: Set<string>, evalDay: number, dq: DataQualityLog): SalesRow[] {
  const src = "weekly_sales";
  let rows: Row[] = requireSchema(table, SALES_COLUMNS, src).map((r) => ({ ...r, SKU_ID: normaliseId(r.SKU_ID) }));

  dq.addRows(rows.filter((r) => r.SKU_ID === ""), src, "BLANK_SKU_ID", "Row has no SKU_ID", "ERROR", "QUARANTINED");
  dq.addRows(rows.filter((r) => r.SKU_ID !== "" && !masterIds.has(r.SKU_ID)), src, "UNKNOWN_SKU",
    (r) => `SKU_ID ${pyRepr(r.SKU_ID)} not in sku_master`, "ERROR", "QUARANTINED");
  rows = rows.filter((r) => r.SKU_ID !== "" && masterIds.has(r.SKU_ID)).map((r) => ({ ...r, week_start: parseIsoWeek(r.Week) }));

  dq.addRows(rows.filter((r) => r.week_start == null), src, "INVALID_WEEK", (r) => `Week ${pyRepr(r.Week)} is not a valid ISO week (YYYY-Www)`, "ERROR", "QUARANTINED");
  rows = rows.filter((r) => r.week_start != null).map((r) => ({ ...r, Week: formatIsoWeek(r.week_start!), units: toNumber(r.Units_Sold) }));

  const missing = (r: Row) => r.Units_Sold === "";
  const invalid = (r: Row) => !missing(r) && Number.isNaN(r.units);
  const negative = (r: Row) => r.units < 0;
  dq.addRows(rows.filter(missing), src, "MISSING_SALES_VALUE", (r) => `Units_Sold blank for ${r.Week} (treated as missing, not zero)`, "ERROR", "QUARANTINED");
  dq.addRows(rows.filter(invalid), src, "INVALID_NUMERIC", (r) => `Units_Sold ${pyRepr(r.Units_Sold)} for ${r.Week} is not numeric`, "ERROR", "QUARANTINED");
  dq.addRows(rows.filter(negative), src, "NEGATIVE_SALES", (r) => `Units_Sold ${r.Units_Sold} for ${r.Week} is negative`, "ERROR", "QUARANTINED");
  rows = rows.filter((r) => !(missing(r) || invalid(r) || negative(r)));

  const exact = duplicatedLater(rows, (r) => keyOf(r.SKU_ID, r.week_start, r.units));
  dq.addRows(rows.filter((_, i) => exact[i]), src, "DUPLICATE_SALES_ROW", (r) => `Identical duplicate for ${r.Week} collapsed`, "WARNING", "COLLAPSED");
  rows = rows.filter((_, i) => !exact[i]);
  const conflict = duplicatedAll(rows, (r) => keyOf(r.SKU_ID, r.week_start));
  dq.addRows(rows.filter((_, i) => conflict[i]), src, "CONFLICTING_SALES_ROWS", (r) => `${r.Week} has differing Units_Sold values; week treated as missing`, "ERROR", "QUARANTINED");
  rows = rows.filter((_, i) => !conflict[i]);

  // A week counts only once it is complete (its Sunday is on/before the evaluation date).
  const future = (r: Row) => r.week_start + 6 > evalDay;
  dq.addRows(rows.filter(future), src, "WEEK_AFTER_EVALUATION", (r) => `${r.Week} is not complete as of ${isoDate(evalDay)}; excluded`, "INFO", "EXCLUDED");
  rows = rows.filter((r) => !future(r));

  dq.addRows(rows.filter((r) => r.units !== Math.floor(r.units!)), src, "FRACTIONAL_SALES", (r) => `Units_Sold ${r.Units_Sold} for ${r.Week} is fractional`, "WARNING");
  return rows.map((r) => ({ SKU_ID: r.SKU_ID, Week: r.Week, week_start: r.week_start!, Units_Sold: r.units!, _row: r._row }));
}

const TRUE_WORDS = new Set(["true", "yes", "y", "1"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", ""]);

export interface CalendarInfo {
  available: boolean;
  columns?: string[];
  week_column?: string | null;
  festival_column?: string | null;
  festival_is_flag?: boolean;
  granularity?: "week" | "month";
  evaluation_month?: string;
  evaluation_month_rule_festival?: boolean;
  evaluation_month_calendar_festival?: boolean;
  festivals_recent_and_next_4_weeks?: Record<string, string>;
}
interface CalendarData {
  info: CalendarInfo;
  weeks?: Map<number, Record<string, string>>;
  months?: Map<string, boolean | null>;
}

function inspectCalendar(table: ReturnType<typeof readTable>, dq: DataQualityLog): CalendarData {
  const info: CalendarInfo = { available: false };
  if (!table) return { info };
  const cols = table.columns;
  if (!cols.length || !table.rows.length) {
    dq.add("calendar", "EMPTY_CALENDAR", "calendar file is empty; calendar checks skipped", "WARNING");
    return { info };
  }
  const rows = table.rows as Row[];
  let weekCol: string | null = null;
  for (const c of cols) {
    const values = rows.map((r) => r[c]).filter((v) => v !== "");
    if (values.length && values.filter((v) => parseIsoWeek(v) != null).length / values.length >= 0.9) {
      weekCol = c;
      break;
    }
  }
  const festivalCol = cols.find((c) => /festiv|holiday|event/.test(c.toLowerCase())) ?? null;
  const festivalIsFlag = !!festivalCol && rows.every((r) => TRUE_WORDS.has(r[festivalCol].toLowerCase()) || FALSE_WORDS.has(r[festivalCol].toLowerCase()));
  Object.assign(info, { available: true, columns: cols, week_column: weekCol, festival_column: festivalCol, festival_is_flag: festivalIsFlag });

  if (weekCol == null) {
    const months = calendarMonths(rows, cols);
    if (months == null) {
      dq.add("calendar", "UNRECOGNISED_CALENDAR", `No ISO-week or year-month columns detected in calendar (columns: ${pyList(cols)}); calendar checks skipped`, "WARNING");
      return { info };
    }
    info.granularity = "month";
    dq.addRows(rows.filter((_, i) => months[i] == null).map((r) => ({ ...r, SKU_ID: "" })), "calendar", "INVALID_MONTH",
      "Calendar row has no valid year/month", "WARNING", "IGNORED");
    const map = new Map<string, boolean | null>();
    rows.forEach((r, i) => {
      if (months[i] != null) map.set(months[i]!, festivalIsFlag ? TRUE_WORDS.has(r[festivalCol!].toLowerCase()) : null);
    });
    return { info, months: map };
  }

  info.granularity = "week";
  const parsed = rows.map((r) => parseIsoWeek(r[weekCol!]));
  dq.addRows(rows.filter((_, i) => parsed[i] == null).map((r): Row => ({ ...r, SKU_ID: "" })), "calendar", "INVALID_WEEK",
    (r) => `Calendar week ${pyRepr(r[weekCol!])} is not a valid ISO week`, "WARNING", "IGNORED");
  const weeks = new Map<number, Record<string, string>>();
  let dups = 0;
  rows.forEach((r, i) => {
    const w = parsed[i];
    if (w == null) return;
    if (weeks.has(w)) return void dups++;
    weeks.set(w, Object.fromEntries(cols.filter((c) => c !== weekCol).map((c) => [c, r[c]])));
  });
  if (dups) dq.add("calendar", "DUPLICATE_CALENDAR_WEEK", `${dups} duplicate calendar week row(s); first kept`, "WARNING");
  return { info, weeks };
}

function calendarMonths(rows: Row[], cols: string[]): (string | null)[] | null {
  const ymCol = cols.find((c) => ["year_month", "yearmonth", "month_id"].includes(c.toLowerCase().replace(/ /g, "_")));
  if (ymCol) {
    return rows.map((r) => {
      const m = /^(\d{4})-(\d{1,2})$/.exec(r[ymCol]);
      return m && validDay(+m[1], +m[2], 1) != null ? ymKey(+m[1], +m[2]) : null;
    });
  }
  const yc = findColumn(cols, "Year");
  const mc = findColumn(cols, "Month");
  if (!yc || !mc) return null;
  return rows.map((r) => {
    const y = toNumber(r[yc]);
    const m = toNumber(r[mc]);
    return Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12 ? ymKey(y, m) : null;
  });
}

function checkCalendarMonths(cal: CalendarData, sales: SalesRow[], evalDay: number, config: EngineConfig, dq: DataQualityLog) {
  const months = cal.months;
  if (!months || !months.size) return;
  const { year, month } = ymOf(evalDay);
  const evalKey = ymKey(year, month);
  const ruleSays = config.festival_months.includes(month);
  cal.info.evaluation_month = evalKey;
  cal.info.evaluation_month_rule_festival = ruleSays;
  if (!months.has(evalKey)) {
    dq.add("run", "CALENDAR_MISSING_EVAL_MONTH", `Calendar has no row for ${evalKey}; festival rule applied from configuration only`, "WARNING");
  } else if (months.get(evalKey) != null) {
    const calSays = months.get(evalKey)!;
    cal.info.evaluation_month_calendar_festival = calSays;
    if (calSays !== ruleSays) {
      dq.add("run", "CALENDAR_FESTIVAL_MISMATCH",
        `Calendar marks ${evalKey} festival=${calSays ? "True" : "False"} but the configured rule says ${ruleSays ? "True" : "False"}; the configured rule was applied - confirm with the planner`, "WARNING");
    }
  }
  const disagree = [...months.entries()]
    .filter(([k, flag]) => flag != null && flag !== config.festival_months.includes(Number(k.slice(5))))
    .map(([k]) => k)
    .sort();
  if (disagree.length) {
    dq.add("calendar", "CALENDAR_RULE_DISAGREEMENT", `Calendar festival flag differs from festival_months ${pyList(config.festival_months)} for: ${disagree.join(", ")}`, "WARNING");
  }
  const salesMonths = new Set(sales.map((s) => { const d = ymOf(s.week_start); return ymKey(d.year, d.month); }));
  const uncovered = [...salesMonths].filter((k) => !months.has(k)).sort();
  if (uncovered.length) dq.add("calendar", "SALES_MONTH_NOT_IN_CALENDAR", `Sales months absent from calendar: ${uncovered.join(", ")}`, "WARNING");
}

// --------------------------------------------------------------------------- //
// Calculations
// --------------------------------------------------------------------------- //

function prepareWeeklySales(sales: SalesRow[], evalDay: number, config: EngineConfig, dq: DataQualityLog): { sales: SalesRow[]; cutoff: number } {
  let cutoff: number;
  if (config.sales_cutoff_week) {
    const c = parseIsoWeek(config.sales_cutoff_week);
    if (c == null) throw new FreshrootsError(`sales_cutoff_week '${config.sales_cutoff_week}' is not a valid ISO week`);
    if (c + 6 > evalDay) throw new FreshrootsError(`sales_cutoff_week ${config.sales_cutoff_week} is not complete on ${isoDate(evalDay)}`);
    cutoff = c;
  } else {
    if (!sales.length) throw new UnrecoverableDataError("weekly_sales has no valid, complete weeks on or before the evaluation date.");
    cutoff = Math.max(...sales.map((s) => s.week_start));
  }
  const evalWeek = isoWeekOf(evalDay).monday;
  const lag = Math.floor((evalWeek - cutoff) / 7) - 1;
  if (lag > config.max_sales_lag_weeks) {
    dq.add("run", "STALE_SALES_DATA",
      `Latest sales week ${formatIsoWeek(cutoff)} is ${lag} complete week(s) before evaluation week ${formatIsoWeek(evalWeek)}; demand may be out of date`, "WARNING");
  }
  const prepared = sales.filter((s) => s.week_start <= cutoff)
    .sort((a, b) => (a.SKU_ID < b.SKU_ID ? -1 : a.SKU_ID > b.SKU_ID ? 1 : a.week_start - b.week_start));
  return { sales: prepared, cutoff };
}

interface Metrics {
  avg_12w_sales: number;
  avg_4w_sales: number;
  weeks_observed_12w: number;
  weeks_observed_4w: number;
  missing_weeks: string;
  history_complete: boolean;
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

function calculateDemandMetrics(skuIds: string[], sales: SalesRow[], cutoff: number, config: EngineConfig, dq: DataQualityLog): Map<string, Metrics> {
  const longWeeks = Array.from({ length: config.long_window_weeks }, (_, k) => cutoff - 7 * k);
  const shortWeeks = new Set(longWeeks.slice(0, config.short_window_weeks));
  const lookup = new Map(sales.map((s) => [keyOf(s.SKU_ID, s.week_start), s.Units_Sold]));
  const firstWeek = new Map<string, number>();
  for (const s of sales) if (!firstWeek.has(s.SKU_ID) || s.week_start < firstWeek.get(s.SKU_ID)!) firstWeek.set(s.SKU_ID, s.week_start);

  const out = new Map<string, Metrics>();
  const windowStart = longWeeks[longWeeks.length - 1];
  for (const sku of [...skuIds].sort()) {
    const obs = longWeeks.map((w) => ({ w, v: lookup.get(keyOf(sku, w)) }));
    const long = obs.filter((o) => o.v != null).map((o) => o.v!);
    const short = obs.filter((o) => o.v != null && shortWeeks.has(o.w)).map((o) => o.v!);
    const missing = obs.filter((o) => o.v == null).map((o) => o.w).sort((a, b) => a - b).map(formatIsoWeek).join(", ");
    const m: Metrics = {
      avg_12w_sales: mean(long), avg_4w_sales: mean(short), weeks_observed_12w: long.length, weeks_observed_4w: short.length,
      missing_weeks: missing,
      history_complete: long.length >= config.min_observed_weeks_long && short.length >= config.min_observed_weeks_short,
    };
    out.set(sku, m);
    if (m.history_complete) continue;
    const starts = firstWeek.get(sku);
    if (starts == null || starts > windowStart) {
      const since = starts != null ? `history starts ${formatIsoWeek(starts)}` : "no valid sales history";
      dq.add("weekly_sales", "INSUFFICIENT_HISTORY", `Only ${m.weeks_observed_12w} of ${config.long_window_weeks} weeks in the baseline window (${since})`, "ERROR", sku, null, "SKU_BLOCKED", true);
    } else {
      dq.add("weekly_sales", "MISSING_SALES_WEEKS", `${m.weeks_observed_12w} of ${config.long_window_weeks} weeks observed; missing: ${m.missing_weeks}`, "ERROR", sku, null, "SKU_BLOCKED", true);
    }
  }
  return out;
}

function roundQty(raw: number, mode: EngineConfig["reorder_rounding"]) {
  if (mode === "ceil") return Math.ceil(raw);
  if (mode === "floor") return Math.floor(raw);
  return Math.floor(raw + 0.5);
}

function bandText(perishability: string, c: EngineConfig) {
  if (perishability === "High") return `high-perishability band ${pyG(c.high_perish_stockout_weeks)}-${pyG(c.high_perish_overstock_weeks)} weeks`;
  if (perishability === "Low") return `low-perishability band ${pyG(c.low_perish_stockout_weeks)}-${pyG(c.low_perish_overstock_weeks)} weeks`;
  return "no valid perishability band";
}

function explain(r: Recommendation, c: EngineConfig, evalDay: number): string {
  const parts: string[] = [];
  if (!isNum(r.avg_12w_sales)) {
    parts.push("No usable sales in the 12-week window.");
  } else {
    let trend = `Demand: 4-wk avg ${fmtNum(r.avg_4w_sales)} vs 12-wk avg ${fmtNum(r.avg_12w_sales)} units/wk`;
    if (!isNum(r.demand_ratio)) trend += " (ratio undefined: zero 12-week demand).";
    else if (r.demand_spurt_flag) trend += ` (ratio ${pyFixed(r.demand_ratio, 2)} > ${pyFixed(c.surge_ratio_threshold, 2)}: ${FLAG_SPURT}, reorder qty x${pyG(c.surge_reorder_multiplier)}).`;
    else trend += ` (ratio ${pyFixed(r.demand_ratio, 2)}, no surge).`;
    parts.push(trend);
    const month = MONTH_ABBR[ymOf(evalDay).month - 1];
    if (r.seasonal_uplift_pct > 0) parts.push(`Festival-month uplift +${pyG(r.seasonal_uplift_pct)}% (${month}) -> baseline ${fmtNum(r.baseline_demand)} units/wk.`);
    else parts.push(`No seasonal uplift (${month} is not a festival month).`);
  }
  const band = bandText(r.Perishability, c);
  if (!isNum(r.Units_On_Hand)) parts.push("Stock on hand unknown or unreliable.");
  else if (!isNum(r.weeks_of_stock)) parts.push(`${fmtNum(r.Units_On_Hand, 0)} units on hand; cover undefined.`);
  else parts.push(`Cover: ${fmtNum(r.Units_On_Hand, 0)} units = ${pyFixed(r.weeks_of_stock, 1)} weeks vs ${band}.`);

  if (r.Action === ACTION_REORDER) {
    const how = r.demand_spurt_flag ? `${r.Standard_Reorder_Qty} x ${pyG(r.reorder_multiplier)}, ${c.reorder_rounding}` : "standard quantity";
    parts.push(`Below minimum cover -> ${ACTION_REORDER} ${r.Recommended_Order_Qty.toLocaleString("en-US")} units (${how}).`);
  } else if (r.Action === ACTION_PAUSE) parts.push(`Above maximum cover -> ${ACTION_PAUSE}; no order.`);
  else if (r.Action === ACTION_MAINTAIN) parts.push(`Within band -> ${ACTION_MAINTAIN}; no order.`);
  else {
    let msg = `${ACTION_REVIEW}: ${r.Review_Reasons}.`;
    if (r.Indicative_Action) msg += ` Rules on available data would say ${r.Indicative_Action}; not actioned until a planner confirms.`;
    parts.push(msg);
  }
  return parts.join(" ");
}

function generateRecommendations(master: MasterSku[], inventory: Map<string, InventoryAgg>, metrics: Map<string, Metrics>, dq: DataQualityLog,
                                 evalDay: number, cutoff: number, c: EngineConfig): Recommendation[] {
  const blockedSet = dq.blockedSkus();
  const uplift = c.festival_months.includes(ymOf(evalDay).month) ? c.seasonal_uplift_pct : 0;
  const issues = dq.records.filter((r) => r.SKU_ID !== "" && r.Severity !== "INFO");

  return master.map((s) => {
    const inv = inventory.get(s.SKU_ID);
    const m = metrics.get(s.SKU_ID)!;
    const onHand = inv ? inv.Units_On_Hand : NaN;
    const baseline = m.avg_12w_sales * (1 + uplift / 100);

    const avg12 = m.avg_12w_sales;
    const ratio = avg12 > 0 ? m.avg_4w_sales / avg12 : NaN;
    const spurt = isNum(ratio) && pyRound(ratio, c.comparison_decimals) > c.surge_ratio_threshold;
    const multiplier = spurt ? c.surge_reorder_multiplier : 1;
    const effective = Number.isNaN(s.Standard_Reorder_Qty) ? NaN : roundQty(pyRound(s.Standard_Reorder_Qty * multiplier, c.comparison_decimals), c.reorder_rounding);
    const weeks = baseline > 0 ? onHand / baseline : NaN;

    const cover = isNum(weeks) ? pyRound(weeks, c.comparison_decimals) : NaN;
    let invFlag = "";
    let ruleAction: Action | "" = "";
    const band = s.Perishability === "Low" ? [c.low_perish_stockout_weeks, c.low_perish_overstock_weeks, ""] as const
      : s.Perishability === "High" ? [c.high_perish_stockout_weeks, c.high_perish_overstock_weeks, "_HIGH"] as const : null;
    if (band && isNum(cover)) {
      const [lo, hi, suffix] = band;
      if (cover < lo) [invFlag, ruleAction] = [`STOCKOUT_RISK${suffix}`, ACTION_REORDER];
      else if (cover > hi) [invFlag, ruleAction] = [`OVERSTOCK_RISK${suffix}`, ACTION_PAUSE];
      else [invFlag, ruleAction] = ["OPTIMAL_LEVEL", ACTION_MAINTAIN];
    }

    const blocked = blockedSet.has(s.SKU_ID);
    const zeroDemand = m.history_complete && baseline === 0;
    const undefinedCover = !isNum(weeks);
    const review = blocked || zeroDemand || undefinedCover;

    const mine = issues.filter((r) => r.SKU_ID === s.SKU_ID);
    const blockingCodes = [...new Set(dq.records.filter((r) => r.Blocks_SKU && r.SKU_ID === s.SKU_ID).map((r) => r.Issue_Code))];
    const reasons = blocked ? `data-quality hold (${blockingCodes.join(", ")})`
      : zeroDemand ? "zero demand in the 12-week baseline; cover undefined, check for delisting or supply interruption"
      : undefinedCover ? "stock cover cannot be computed" : "";
    const action: Action = review ? ACTION_REVIEW : (ruleAction as Action);
    const flags = [
      ...(invFlag && !blocked ? [invFlag] : []), ...(spurt ? [FLAG_SPURT] : []), ...(zeroDemand ? ["ZERO_DEMAND"] : []), ...(blocked ? ["DATA_QUALITY_HOLD"] : []),
    ].join(";");

    const rec: Recommendation = {
      SKU_ID: s.SKU_ID, SKU_Name: s.SKU_Name, Category: s.Category, Perishability: s.Perishability,
      Units_On_Hand: isNum(onHand) ? onHand : null,
      avg_12w_sales: isNum(avg12) ? avg12 : null, avg_4w_sales: isNum(m.avg_4w_sales) ? m.avg_4w_sales : null,
      seasonal_uplift_pct: uplift, baseline_demand: isNum(baseline) ? baseline : null,
      demand_ratio: isNum(ratio) ? ratio : null, demand_spurt_flag: spurt, weeks_of_stock: isNum(weeks) ? weeks : null,
      Flags: flags, Action: action,
      Standard_Reorder_Qty: isNum(s.Standard_Reorder_Qty) ? s.Standard_Reorder_Qty : null,
      effective_reorder_qty: isNum(effective) ? effective : null,
      Recommended_Order_Qty: action === ACTION_REORDER ? effective : 0,
      Data_Quality_Status: blocked ? "ERROR" : mine.length ? "WARNING" : "OK",
      Data_Quality_Notes: mine.map((r) => `${r.Issue_Code}: ${r.Detail}`).join(" | "),
      Review_Required: review, Explanation: "",
      Distributor_ID: s.Distributor_ID, Location_Count: inv?.Location_Count ?? 0, Locations: inv?.Locations ?? "",
      weeks_observed_12w: m.weeks_observed_12w, weeks_observed_4w: m.weeks_observed_4w, reorder_multiplier: multiplier,
      Inventory_Flag: invFlag, Indicative_Action: review ? ruleAction : "", Review_Reasons: reasons,
      Evaluation_Date: isoDate(evalDay), Inventory_As_Of_Date: inv?.as_of_max != null ? isoDate(inv.as_of_max) : "",
      Sales_Cutoff_Week: formatIsoWeek(cutoff),
    };
    rec.Explanation = explain(rec, c, evalDay);
    return rec;
  });
}

// --------------------------------------------------------------------------- //
// Summary
// --------------------------------------------------------------------------- //

export interface EngineSummary {
  operational_kpis: {
    total_skus_in_master: number;
    skus_with_valid_recommendations: number;
    skus_requiring_manual_review: number;
    stockout_risk_skus: number;
    overstock_risk_skus: number;
    optimal_level_skus: number;
    high_demand_spurt_skus: number;
    immediate_reorder_skus: number;
    pause_order_skus: number;
    total_recommended_order_units: number;
    recommended_order_units_by_category: Record<string, number>;
    review_skus_with_indicative_stockout: number;
  };
  financial_estimates: { status: "CALCULATED" | "NOT_AVAILABLE"; inventory_value_inr: number | null; recommended_purchase_order_value_inr: number | null; reason?: string };
  business_baseline_reported: { quarterly_stockout_loss_inr_lakh: number[]; quarterly_overstock_writeoff_inr_lakh: number[]; quarterly_total_planning_loss_inr_lakh: number[] };
  illustrative_prevention_scenarios: { reduction_pct: number; quarterly_loss_reduction_inr_lakh: number[]; annualised_inr_lakh: number[] }[];
  data_quality: { issues_total: number; errors: number; warnings: number; info: number; skus_blocked: number; records_quarantined: number; issues_by_code: Record<string, number>; global_issues: string[] };
}

const r2 = (x: number) => Number(pyFixed(x, 2));

function calculateSummary(results: Recommendation[], master: MasterSku[], dq: DataQualityLog, c: EngineConfig): EngineSummary {
  const valid = results.filter((r) => !r.Review_Required);
  const review = results.filter((r) => r.Review_Required);
  const byCat: Record<string, number> = {};
  for (const r of [...results].sort((a, b) => (a.Category < b.Category ? -1 : 1))) byCat[r.Category] = (byCat[r.Category] ?? 0) + r.Recommended_Order_Qty;

  const costs = new Map(master.map((m) => [m.SKU_ID, m.Unit_Cost]));
  const allCosts = master.length > 0 && master.every((m) => isNum(m.Unit_Cost));
  const financial: EngineSummary["financial_estimates"] = allCosts
    ? {
        status: "CALCULATED",
        inventory_value_inr: r2(results.reduce((s, r) => s + (isNum(r.Units_On_Hand) ? r.Units_On_Hand * costs.get(r.SKU_ID)! : 0), 0)),
        recommended_purchase_order_value_inr: r2(results.reduce((s, r) => s + r.Recommended_Order_Qty * costs.get(r.SKU_ID)!, 0)),
      }
    : {
        status: "NOT_AVAILABLE", inventory_value_inr: null, recommended_purchase_order_value_inr: null,
        reason: "The input files carry no unit cost, price, or margin for every SKU, so inventory exposure and purchase-order value are not calculated. Add a Unit_Cost column to sku_master to enable them.",
      };

  const [lo, hi] = c.baseline_quarterly_total_loss_lakh;
  const codes: Record<string, number> = {};
  for (const r of [...dq.records].sort((a, b) => (a.Issue_Code < b.Issue_Code ? -1 : 1))) codes[r.Issue_Code] = (codes[r.Issue_Code] ?? 0) + 1;
  const sev = (s: Severity) => dq.records.filter((r) => r.Severity === s).length;

  return {
    operational_kpis: {
      total_skus_in_master: results.length,
      skus_with_valid_recommendations: valid.length,
      skus_requiring_manual_review: review.length,
      stockout_risk_skus: valid.filter((r) => r.Flags.includes("STOCKOUT_RISK")).length,
      overstock_risk_skus: valid.filter((r) => r.Flags.includes("OVERSTOCK_RISK")).length,
      optimal_level_skus: valid.filter((r) => r.Flags.includes("OPTIMAL_LEVEL")).length,
      high_demand_spurt_skus: results.filter((r) => r.demand_spurt_flag).length,
      immediate_reorder_skus: results.filter((r) => r.Action === ACTION_REORDER).length,
      pause_order_skus: results.filter((r) => r.Action === ACTION_PAUSE).length,
      total_recommended_order_units: results.reduce((s, r) => s + r.Recommended_Order_Qty, 0),
      recommended_order_units_by_category: byCat,
      review_skus_with_indicative_stockout: review.filter((r) => r.Indicative_Action === ACTION_REORDER).length,
    },
    financial_estimates: financial,
    business_baseline_reported: {
      quarterly_stockout_loss_inr_lakh: [...c.baseline_quarterly_stockout_loss_lakh],
      quarterly_overstock_writeoff_inr_lakh: [...c.baseline_quarterly_overstock_loss_lakh],
      quarterly_total_planning_loss_inr_lakh: [lo, hi],
    },
    illustrative_prevention_scenarios: c.prevention_scenarios_pct.map((pct) => ({
      reduction_pct: pct,
      quarterly_loss_reduction_inr_lakh: [r2((lo * pct) / 100), r2((hi * pct) / 100)],
      annualised_inr_lakh: [r2(((lo * pct) / 100) * 4), r2(((hi * pct) / 100) * 4)],
    })),
    data_quality: {
      issues_total: dq.records.length, errors: sev("ERROR"), warnings: sev("WARNING"), info: sev("INFO"),
      skus_blocked: results.filter((r) => r.Data_Quality_Status === "ERROR").length,
      records_quarantined: dq.records.filter((r) => r.Disposition === "QUARANTINED").length,
      issues_by_code: codes,
      global_issues: dq.globalIssues().map((r) => r.Detail),
    },
  };
}

// --------------------------------------------------------------------------- //
// Orchestration
// --------------------------------------------------------------------------- //

export interface EngineResult {
  engine_version: string;
  evaluation_date: string;
  sales_cutoff_week: string;
  inventory_snapshot_dates: string[];
  calendar: CalendarInfo;
  config: EngineConfig;
  recommendations: Recommendation[];
  data_quality: DqRecord[];
  summary: EngineSummary;
  /** Weekly sales actually used, per SKU, oldest first: for charts. */
  history: Record<string, { week: string; units: number }[]>;
  distributors: Record<string, { name: string; status: string }>;
}

export function runEngine(inputs: EngineInputs, evaluationDate: string, overrides: Partial<EngineConfig> = {}): EngineResult {
  const c = makeConfig(overrides);
  const evalDay = parseIsoDate(evaluationDate);
  if (evalDay == null) throw new FreshrootsError(`evaluation_date must be YYYY-MM-DD, got '${evaluationDate}'`);
  const dq = new DataQualityLog();

  const skuT = readTable(inputs.sku_master, "sku_master", true);
  const invT = readTable(inputs.current_inventory, "current_inventory", true);
  const salesT = readTable(inputs.weekly_sales, "weekly_sales", true);
  const calT = readTable(inputs.calendar, "calendar", false);
  const distT = readTable(inputs.distributor_master, "distributor_master", false);

  let distributorIds: Set<string> | null = null;
  let inactive = new Set<string>();
  const distributors: EngineResult["distributors"] = {};
  if (distT && distT.rows.length) {
    const col = findColumn(distT.columns, "Distributor_ID");
    if (col) {
      distributorIds = new Set(distT.rows.map((r) => normaliseId(r[col])));
      const statusCol = findColumn(distT.columns, "Status");
      const nameCol = findColumn(distT.columns, "Distributor_Name", "Name");
      if (statusCol) inactive = new Set(distT.rows.filter((r) => r[statusCol].toLowerCase() !== "active").map((r) => normaliseId(r[col])));
      for (const r of distT.rows) distributors[normaliseId(r[col])] = { name: nameCol ? r[nameCol] : "", status: statusCol ? r[statusCol] : "" };
    } else {
      dq.add("distributor_master", "NO_DISTRIBUTOR_ID_COLUMN", "distributor_master has no Distributor_ID column; distributor check skipped", "WARNING");
    }
  }

  const master = validateSkuMaster(skuT, c, dq, distributorIds);
  dq.addRows(master.filter((m) => inactive.has(m.Distributor_ID)), "sku_master", "INACTIVE_DISTRIBUTOR",
    (r) => `Distributor ${r.Distributor_ID} is not Active in distributor_master; confirm supplier before ordering`, "WARNING");
  if (!master.length) throw new UnrecoverableDataError("sku_master has no usable SKU rows after validation.");
  const masterIds = new Set(master.map((m) => m.SKU_ID));
  const inv = validateInventory(invT, masterIds, evalDay, c, dq);
  const validSales = validateSales(salesT, masterIds, evalDay, dq);
  const cal = inspectCalendar(calT, dq);
  checkCalendarMonths(cal, validSales, evalDay, c, dq);
  if (cal.weeks?.size) {
    const missing = [...new Set(validSales.map((s) => s.week_start))].filter((w) => !cal.weeks!.has(w)).sort((a, b) => a - b);
    if (missing.length) {
      dq.add("calendar", "SALES_WEEK_NOT_IN_CALENDAR", `${missing.length} sales week(s) absent from calendar: ${missing.slice(0, 10).map(formatIsoWeek).join(", ")}`, "WARNING");
    }
  }

  const { sales, cutoff } = prepareWeeklySales(validSales, evalDay, c, dq);
  const metrics = calculateDemandMetrics(master.map((m) => m.SKU_ID), sales, cutoff, c, dq);
  const recommendations = generateRecommendations(master, inv.agg, metrics, dq, evalDay, cutoff, c);
  const summary = calculateSummary(recommendations, master, dq, c);

  if (cal.weeks && cal.info.festival_column && !cal.info.festival_is_flag) {
    const fest = cal.info.festival_column;
    const evalWeek = isoWeekOf(evalDay).monday;
    const window = [...new Set([...Array.from({ length: c.short_window_weeks }, (_, k) => cutoff - 7 * k), ...Array.from({ length: 5 }, (_, k) => evalWeek + 7 * k)])].sort((a, b) => a - b);
    const upcoming: Record<string, string> = {};
    for (const w of window) {
      const v = cal.weeks.get(w)?.[fest]?.trim();
      if (v && !["None", "nan", "-", "0", "No"].includes(v)) upcoming[formatIsoWeek(w)] = v;
    }
    cal.info.festivals_recent_and_next_4_weeks = upcoming;
  }

  const history: EngineResult["history"] = {};
  for (const s of sales) (history[s.SKU_ID] ??= []).push({ week: s.Week, units: s.Units_Sold });

  return {
    engine_version: ENGINE_VERSION,
    evaluation_date: isoDate(evalDay),
    sales_cutoff_week: formatIsoWeek(cutoff),
    inventory_snapshot_dates: [...new Set(inv.valid.map((r) => isoDate(r.as_of!)))].sort(),
    calendar: cal.info,
    config: c,
    recommendations,
    data_quality: dq.records,
    summary,
    history,
    distributors,
  };
}
