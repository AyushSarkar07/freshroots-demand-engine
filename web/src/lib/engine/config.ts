/**
 * Business rules. Keys match the Python engine's EngineConfig / config.example.json,
 * so one JSON file configures both.
 */
export interface EngineConfig {
  long_window_weeks: number;
  short_window_weeks: number;
  min_observed_weeks_long: number;
  min_observed_weeks_short: number;
  festival_months: number[];
  seasonal_uplift_pct: number;
  surge_ratio_threshold: number;
  surge_reorder_multiplier: number;
  low_perish_stockout_weeks: number;
  low_perish_overstock_weeks: number;
  high_perish_stockout_weeks: number;
  high_perish_overstock_weeks: number;
  reorder_rounding: "ceil" | "floor" | "round_half_up";
  inventory_aggregation: "sum_locations" | "require_single_location";
  stale_inventory_days: number;
  max_sales_lag_weeks: number;
  sales_cutoff_week: string | null;
  valid_categories: string[];
  valid_perishability: string[];
  expected_unit_of_measure: string;
  comparison_decimals: number;
  baseline_quarterly_stockout_loss_lakh: [number, number];
  baseline_quarterly_overstock_loss_lakh: [number, number];
  baseline_quarterly_total_loss_lakh: [number, number];
  prevention_scenarios_pct: number[];
}

export const DEFAULT_CONFIG: EngineConfig = {
  long_window_weeks: 12,
  short_window_weeks: 4,
  min_observed_weeks_long: 12,
  min_observed_weeks_short: 4,
  festival_months: [10, 11, 3],
  seasonal_uplift_pct: 25,
  surge_ratio_threshold: 1.2,
  surge_reorder_multiplier: 1.5,
  low_perish_stockout_weeks: 6,
  low_perish_overstock_weeks: 14,
  high_perish_stockout_weeks: 3,
  high_perish_overstock_weeks: 4,
  reorder_rounding: "ceil",
  inventory_aggregation: "sum_locations",
  stale_inventory_days: 7,
  max_sales_lag_weeks: 2,
  sales_cutoff_week: null,
  // Condiment appears in the real SAP export although the brief lists only four.
  valid_categories: ["Beverage", "Snack", "Staple", "Dairy Alt", "Condiment"],
  valid_perishability: ["Low", "High"],
  expected_unit_of_measure: "Units",
  comparison_decimals: 9,
  baseline_quarterly_stockout_loss_lakh: [18, 22],
  baseline_quarterly_overstock_loss_lakh: [10, 12],
  baseline_quarterly_total_loss_lakh: [28, 34],
  prevention_scenarios_pct: [10, 20, 30],
};

export class ConfigurationError extends Error {}

export function makeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  const unknown = Object.keys(overrides).filter((k) => !(k in DEFAULT_CONFIG));
  if (unknown.length) throw new ConfigurationError(`Unknown configuration key(s): ${unknown.join(", ")}`);
  const c = { ...DEFAULT_CONFIG, ...overrides };
  const problems: string[] = [];
  if (!["ceil", "floor", "round_half_up"].includes(c.reorder_rounding)) problems.push("reorder_rounding must be ceil|floor|round_half_up");
  if (!["sum_locations", "require_single_location"].includes(c.inventory_aggregation)) problems.push("inventory_aggregation must be sum_locations|require_single_location");
  if (!(c.short_window_weeks > 0 && c.short_window_weeks <= c.long_window_weeks)) problems.push("short_window_weeks must be >0 and <= long_window_weeks");
  if (!(c.min_observed_weeks_long > 0 && c.min_observed_weeks_long <= c.long_window_weeks)) problems.push("min_observed_weeks_long must be within 1..long_window_weeks");
  if (!(c.min_observed_weeks_short > 0 && c.min_observed_weeks_short <= c.short_window_weeks)) problems.push("min_observed_weeks_short must be within 1..short_window_weeks");
  if (!(c.low_perish_stockout_weeks < c.low_perish_overstock_weeks)) problems.push("low_perish_stockout_weeks must be < low_perish_overstock_weeks");
  if (!(c.high_perish_stockout_weeks < c.high_perish_overstock_weeks)) problems.push("high_perish_stockout_weeks must be < high_perish_overstock_weeks");
  if (c.festival_months.some((m) => !(m >= 1 && m <= 12))) problems.push("festival_months must contain month numbers 1..12");
  if (c.seasonal_uplift_pct < 0 || c.surge_reorder_multiplier <= 0 || c.surge_ratio_threshold <= 0) problems.push("uplift must be >=0; surge threshold and multiplier must be >0");
  if (problems.length) throw new ConfigurationError(problems.join("; "));
  return c;
}
