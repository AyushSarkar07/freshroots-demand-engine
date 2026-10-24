"""Unit tests for the Freshroots demand engine.

Run: python -m unittest discover -s tests -v
Every test builds its own small synthetic fixture in a temp directory.
"""
from __future__ import annotations

import csv
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import freshroots_engine as fe  # noqa: E402

EVAL_NON_FESTIVAL = date(2026, 7, 15)   # Wednesday in 2026-W29 -> cutoff 2026-W28, July: no uplift
EVAL_FESTIVAL = date(2026, 10, 14)      # Wednesday in 2026-W42 -> cutoff 2026-W41, October: +25%


def window(eval_date: date, n: int = 12) -> list:
    """The n complete ISO weeks before eval_date's week, oldest first."""
    this_monday = eval_date - timedelta(days=eval_date.weekday())
    return [this_monday - timedelta(weeks=k) for k in range(n, 0, -1)]


def wid(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


class Fixture:
    """Builds the four CSVs for a test. Defaults: one healthy low-perishability SKU."""

    def __init__(self, eval_date: date = EVAL_NON_FESTIVAL):
        self.eval_date = eval_date
        self.skus: list = []
        self.sales: list = []
        self.inventory: list = []
        self.calendar_rows: list = [[wid(w), w.strftime("%b"), ""] for w in window(eval_date, 20)]

    def sku(self, sku_id, perish="Low", std=500, weekly=None, on_hand=None, category="Beverage",
            uom="Units", locations=None, as_of=None):
        self.skus.append([sku_id, f"Name {sku_id}", category, perish, std, uom, "D01"])
        weekly = [100] * 12 if weekly is None else weekly
        weeks = window(self.eval_date, len(weekly))
        for wk, units in zip(weeks, weekly):
            if units is not None:
                self.sales.append([sku_id, wid(wk), units])
        as_of = as_of or (self.eval_date - timedelta(days=1)).isoformat()
        if locations is None and on_hand is not None:
            locations = [("Pune DC", on_hand)]
        for loc, units in (locations or []):
            self.inventory.append([sku_id, loc, units, as_of])
        return self

    def write(self, root: Path) -> dict:
        def dump(name, header, rows):
            p = root / name
            with p.open("w", newline="") as fh:
                w = csv.writer(fh)
                w.writerow(header)
                w.writerows(rows)
            return p
        return {
            "sku_master_path": dump("sku_master.csv", fe.SKU_COLUMNS, self.skus),
            "inventory_path": dump("current_inventory.csv", fe.INVENTORY_COLUMNS, self.inventory),
            "sales_path": dump("weekly_sales.csv", fe.SALES_COLUMNS, self.sales),
            "calendar_path": dump("calendar.csv", ["Week", "Month", "Festival"], self.calendar_rows),
            "distributor_path": dump("distributor_master.csv", ["Distributor_ID", "Distributor_Name"], [["D01", "Konkan"]]),
        }


class EngineTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def run_engine(self, fx: Fixture, config=None, write=False):
        paths = fx.write(self.root)
        return fe.run_freshroots_demand_engine(
            **paths, evaluation_date=fx.eval_date, config=config,
            output_dir=(self.root / "out") if write else None, print_report=False)

    def row(self, result, sku_id):
        rows = result.recommendations[result.recommendations["SKU_ID"] == sku_id]
        self.assertEqual(len(rows), 1, f"expected exactly one decision for {sku_id}")
        return rows.iloc[0]

    def assertDecision(self, r, flag, action, qty, review=False):
        self.assertEqual(r["Action"], action)
        self.assertEqual(int(r["Recommended_Order_Qty"]), qty)
        self.assertEqual(bool(r["Review_Required"]), review)
        if flag:
            self.assertIn(flag, r["Flags"].split(";"))


class TestRiskBands(EngineTestCase):
    """Flat 100 units/week in July: baseline 100, cover = on_hand / 100."""

    def test_01_low_stockout(self):
        r = self.row(self.run_engine(Fixture().sku("A", "Low", on_hand=300)), "A")
        self.assertAlmostEqual(r["weeks_of_stock"], 3.0)
        self.assertDecision(r, "STOCKOUT_RISK", "IMMEDIATE_REORDER", 500)

    def test_02_low_overstock(self):
        r = self.row(self.run_engine(Fixture().sku("A", "Low", on_hand=1500)), "A")
        self.assertDecision(r, "OVERSTOCK_RISK", "PAUSE_ORDER", 0)

    def test_03_low_balanced(self):
        r = self.row(self.run_engine(Fixture().sku("A", "Low", on_hand=1000)), "A")
        self.assertDecision(r, "OPTIMAL_LEVEL", "MAINTAIN", 0)

    def test_04_high_stockout(self):
        r = self.row(self.run_engine(Fixture().sku("A", "High", on_hand=200)), "A")
        self.assertDecision(r, "STOCKOUT_RISK_HIGH", "IMMEDIATE_REORDER", 500)

    def test_05_high_overstock(self):
        r = self.row(self.run_engine(Fixture().sku("A", "High", on_hand=500)), "A")
        self.assertDecision(r, "OVERSTOCK_RISK_HIGH", "PAUSE_ORDER", 0)

    def test_06_low_exact_6_weeks_is_optimal(self):
        r = self.row(self.run_engine(Fixture().sku("A", "Low", on_hand=600)), "A")
        self.assertEqual(r["weeks_of_stock"], 6.0)
        self.assertDecision(r, "OPTIMAL_LEVEL", "MAINTAIN", 0)

    def test_07_low_exact_14_weeks_is_optimal(self):
        r = self.row(self.run_engine(Fixture().sku("A", "Low", on_hand=1400)), "A")
        self.assertDecision(r, "OPTIMAL_LEVEL", "MAINTAIN", 0)

    def test_08_high_exact_3_weeks_is_optimal(self):
        r = self.row(self.run_engine(Fixture().sku("A", "High", on_hand=300)), "A")
        self.assertDecision(r, "OPTIMAL_LEVEL", "MAINTAIN", 0)

    def test_09_high_exact_4_weeks_is_optimal(self):
        r = self.row(self.run_engine(Fixture().sku("A", "High", on_hand=400)), "A")
        self.assertDecision(r, "OPTIMAL_LEVEL", "MAINTAIN", 0)

    def test_exact_boundary_with_uplift(self):
        # 750 / (100 * 1.25) = 6.0 exactly in October -> still optimal.
        r = self.row(self.run_engine(Fixture(EVAL_FESTIVAL).sku("A", "Low", on_hand=750)), "A")
        self.assertDecision(r, "OPTIMAL_LEVEL", "MAINTAIN", 0)


class TestDemandRules(EngineTestCase):
    def test_10_ratio_exactly_1_20_is_not_a_surge(self):
        # 8 x 90 + 4 x 120 -> avg12 = 100, avg4 = 120, ratio 1.20
        fx = Fixture().sku("A", "Low", weekly=[90] * 8 + [120] * 4, on_hand=300)
        r = self.row(self.run_engine(fx), "A")
        self.assertAlmostEqual(r["avg_12w_sales"], 100.0)
        self.assertAlmostEqual(r["avg_4w_sales"], 120.0)
        self.assertAlmostEqual(r["demand_ratio"], 1.2)
        self.assertFalse(r["demand_spurt_flag"])
        self.assertEqual(r["reorder_multiplier"], 1.0)
        self.assertDecision(r, "STOCKOUT_RISK", "IMMEDIATE_REORDER", 500)
        self.assertNotIn("HIGH_DEMAND_SPURT", r["Flags"])

    def test_11_ratio_above_1_20_is_a_surge(self):
        # 8 x 80 + 4 x 140 -> avg12 = 100, avg4 = 140, ratio 1.40
        fx = Fixture().sku("A", "Low", weekly=[80] * 8 + [140] * 4, on_hand=300)
        r = self.row(self.run_engine(fx), "A")
        self.assertTrue(r["demand_spurt_flag"])
        self.assertEqual(r["effective_reorder_qty"], 750)
        self.assertDecision(r, "HIGH_DEMAND_SPURT", "IMMEDIATE_REORDER", 750)
        self.assertIn("STOCKOUT_RISK", r["Flags"].split(";"))

    def test_surge_fraction_rounds_up(self):
        fx = Fixture().sku("A", "Low", std=333, weekly=[80] * 8 + [140] * 4, on_hand=300)
        r = self.row(self.run_engine(fx), "A")
        self.assertEqual(int(r["Recommended_Order_Qty"]), 500)  # 499.5 -> ceil
        r2 = self.row(self.run_engine(fx, config={"reorder_rounding": "floor"}), "A")
        self.assertEqual(int(r2["Recommended_Order_Qty"]), 499)

    def test_surge_without_reorder(self):
        fx = Fixture().sku("A", "Low", weekly=[80] * 8 + [140] * 4, on_hand=2000)
        r = self.row(self.run_engine(fx), "A")
        self.assertTrue(r["demand_spurt_flag"])
        self.assertDecision(r, "OVERSTOCK_RISK", "PAUSE_ORDER", 0)
        self.assertEqual(r["effective_reorder_qty"], 750)  # stored, but not ordered

    def test_12_festival_month_uplift(self):
        # 700 units: 7.0 weeks without uplift (maintain), 5.6 weeks with +25% (reorder).
        r = self.row(self.run_engine(Fixture(EVAL_FESTIVAL).sku("A", "Low", on_hand=700)), "A")
        self.assertEqual(r["seasonal_uplift_pct"], 25.0)
        self.assertAlmostEqual(r["baseline_demand"], 125.0)
        self.assertAlmostEqual(r["weeks_of_stock"], 5.6)
        self.assertDecision(r, "STOCKOUT_RISK", "IMMEDIATE_REORDER", 500)
        r_jul = self.row(self.run_engine(Fixture().sku("A", "Low", on_hand=700)), "A")
        self.assertEqual(r_jul["seasonal_uplift_pct"], 0.0)
        self.assertDecision(r_jul, "OPTIMAL_LEVEL", "MAINTAIN", 0)

    def test_13_zero_baseline_demand(self):
        r = self.row(self.run_engine(Fixture().sku("A", "Low", weekly=[0] * 12, on_hand=300)), "A")
        self.assertTrue(pd.isna(r["demand_ratio"]))
        self.assertTrue(pd.isna(r["weeks_of_stock"]))
        self.assertFalse(r["demand_spurt_flag"])
        self.assertIn("ZERO_DEMAND", r["Flags"])
        self.assertDecision(r, None, "MANUAL_REVIEW", 0, review=True)


class TestDataQuality(EngineTestCase):
    def test_14_missing_sales_weeks_not_zero_filled(self):
        weekly = [100] * 12
        weekly[3] = weekly[5] = None
        r = self.row(self.run_engine(Fixture().sku("A", "Low", weekly=weekly, on_hand=300)), "A")
        self.assertEqual(r["weeks_observed_12w"], 10)
        self.assertAlmostEqual(r["avg_12w_sales"], 100.0)  # not 83.3
        self.assertDecision(r, None, "MANUAL_REVIEW", 0, review=True)
        self.assertEqual(r["Data_Quality_Status"], "ERROR")
        self.assertIn("MISSING_SALES_WEEKS", r["Data_Quality_Notes"])
        self.assertEqual(r["Indicative_Action"], "IMMEDIATE_REORDER")

    def test_15_insufficient_history(self):
        weekly = [None] * 7 + [100] * 5
        r = self.row(self.run_engine(Fixture().sku("A", "Low", weekly=weekly, on_hand=300)), "A")
        self.assertDecision(r, None, "MANUAL_REVIEW", 0, review=True)
        self.assertIn("INSUFFICIENT_HISTORY", r["Data_Quality_Notes"])

    def test_15b_no_sales_history_at_all(self):
        # The database simulation exercise: an existing SKU whose sales rows are all deleted.
        fx = Fixture().sku("A", "Low", weekly=[], on_hand=300).sku("B", "Low", on_hand=300)
        res = self.run_engine(fx)
        a = self.row(res, "A")
        self.assertDecision(a, None, "MANUAL_REVIEW", 0, review=True)
        self.assertEqual(a["weeks_observed_12w"], 0)
        self.assertIn("INSUFFICIENT_HISTORY: Only 0 of 12 weeks in the baseline window (no valid sales history)", a["Data_Quality_Notes"])
        self.assertDecision(self.row(res, "B"), "STOCKOUT_RISK", "IMMEDIATE_REORDER", 500)

    def test_16_missing_inventory_value_and_record(self):
        fx = Fixture().sku("A", "Low", locations=[("Pune DC", "")]).sku("B", "Low")  # B has no inventory row
        res = self.run_engine(fx)
        a, b = self.row(res, "A"), self.row(res, "B")
        for r, code in ((a, "MISSING_INVENTORY_VALUE"), (b, "MISSING_INVENTORY")):
            self.assertTrue(pd.isna(r["Units_On_Hand"]), "missing stock must not become zero")
            self.assertDecision(r, None, "MANUAL_REVIEW", 0, review=True)
            self.assertIn(code, r["Data_Quality_Notes"])

    def test_17_duplicate_inventory_snapshots(self):
        fx = Fixture().sku("A", "Low", locations=[("Pune DC", 300), ("Pune DC", 300)])
        fx.sku("B", "Low", locations=[("Pune DC", 300), ("Pune DC", 900)])
        res = self.run_engine(fx)
        a, b = self.row(res, "A"), self.row(res, "B")
        self.assertEqual(a["Units_On_Hand"], 300)  # identical duplicate collapsed, not doubled
        self.assertEqual(a["Data_Quality_Status"], "WARNING")
        self.assertDecision(a, "STOCKOUT_RISK", "IMMEDIATE_REORDER", 500)
        self.assertDecision(b, None, "MANUAL_REVIEW", 0, review=True)
        self.assertIn("CONFLICTING_INVENTORY_SNAPSHOT", b["Data_Quality_Notes"])

    def test_18_unknown_sku_quarantined(self):
        fx = Fixture().sku("A", "Low", on_hand=300)
        fx.sales.append(["ZZZ", fx.sales[0][1], 50])
        fx.inventory.append(["ZZZ", "Pune DC", 10, fx.inventory[0][3]])
        res = self.run_engine(fx)
        self.assertEqual(list(res.recommendations["SKU_ID"]), ["A"])
        dq = res.data_quality
        quarantined = dq[(dq["SKU_ID"] == "ZZZ") & (dq["Issue_Code"] == "UNKNOWN_SKU")]
        self.assertEqual(len(quarantined), 2)
        self.assertTrue((quarantined["Disposition"] == "QUARANTINED").all())

    def test_19_invalid_numeric_fields(self):
        fx = Fixture()
        weekly = [100] * 12
        weekly[11] = "abc"
        fx.sku("A", "Low", weekly=weekly, on_hand=300)
        fx.sku("B", "Low", on_hand=-5)
        fx.sku("C", "Low", std="x", on_hand=300)
        res = self.run_engine(fx)
        for sku_id, code in (("A", "INVALID_NUMERIC"), ("B", "NEGATIVE_INVENTORY"), ("C", "INVALID_REORDER_QTY")):
            r = self.row(res, sku_id)
            self.assertDecision(r, None, "MANUAL_REVIEW", 0, review=True)
            self.assertIn(code, r["Data_Quality_Notes"])
        self.assertEqual(self.row(res, "A")["weeks_observed_4w"], 3)

    def test_unknown_category_warns_but_uom_blocks(self):
        # Category drives no rule, so an unlisted one is a warning; a foreign unit of measure blocks.
        fx = (Fixture().sku("A", "Low", category="Frozen", on_hand=300).sku("B", "Low", uom="Cases", on_hand=300)
              .sku("C", "Low", category="Condiment", on_hand=300))
        res = self.run_engine(fx)
        a, b, c = self.row(res, "A"), self.row(res, "B"), self.row(res, "C")
        self.assertEqual(a["Data_Quality_Status"], "WARNING")
        self.assertIn("UNKNOWN_CATEGORY", a["Data_Quality_Notes"])
        self.assertDecision(a, "STOCKOUT_RISK", "IMMEDIATE_REORDER", 500)
        self.assertIn("UNSUPPORTED_UOM", b["Data_Quality_Notes"])
        self.assertDecision(b, None, "MANUAL_REVIEW", 0, review=True)
        self.assertEqual(c["Data_Quality_Status"], "OK")  # Condiment is in the real SAP export

    def test_inactive_distributor_warns(self):
        fx = Fixture().sku("A", "Low", on_hand=300)
        paths = fx.write(self.root)
        paths["distributor_path"].write_text("Distributor_ID,Distributor_Name,Status\nD01,Konkan,Inactive\n")
        r = self.row(fe.run_freshroots_demand_engine(**paths, evaluation_date=fx.eval_date, output_dir=None,
                                                     print_report=False), "A")
        self.assertIn("INACTIVE_DISTRIBUTOR", r["Data_Quality_Notes"])
        self.assertDecision(r, "STOCKOUT_RISK", "IMMEDIATE_REORDER", 500)

    def test_20_multiple_warehouse_locations(self):
        fx = Fixture().sku("A", "Low", locations=[("Pune DC", 200), ("Goa DC", 100)])
        r = self.row(self.run_engine(fx), "A")
        self.assertEqual(r["Units_On_Hand"], 300)
        self.assertEqual(r["Location_Count"], 2)
        self.assertDecision(r, "STOCKOUT_RISK", "IMMEDIATE_REORDER", 500)
        r2 = self.row(self.run_engine(fx, config={"inventory_aggregation": "require_single_location"}), "A")
        self.assertDecision(r2, None, "MANUAL_REVIEW", 0, review=True)

    def test_stale_and_future_snapshots(self):
        fx = Fixture().sku("A", "Low", on_hand=300, as_of="2026-06-01").sku("B", "Low", on_hand=300, as_of="2026-08-01")
        res = self.run_engine(fx)
        a, b = self.row(res, "A"), self.row(res, "B")
        self.assertEqual(a["Data_Quality_Status"], "WARNING")
        self.assertIn("STALE_INVENTORY", a["Data_Quality_Notes"])
        self.assertDecision(a, "STOCKOUT_RISK", "IMMEDIATE_REORDER", 500)
        self.assertDecision(b, None, "MANUAL_REVIEW", 0, review=True)
        self.assertIn("FUTURE_SNAPSHOT", b["Data_Quality_Notes"])

    def test_incomplete_current_week_excluded(self):
        fx = Fixture().sku("A", "Low", on_hand=300)
        this_monday = fx.eval_date - timedelta(days=fx.eval_date.weekday())
        fx.sales.append(["A", wid(this_monday), 9999])
        r = self.row(self.run_engine(fx), "A")
        self.assertAlmostEqual(r["avg_4w_sales"], 100.0)
        self.assertEqual(r["Sales_Cutoff_Week"], wid(this_monday - timedelta(weeks=1)))


class TestMonthlyCalendar(EngineTestCase):
    """The real calendar.csv is monthly: Year, Month, Year_Month, Is_Festival_Month."""

    def write_calendar(self, paths, festival_months):
        rows = [f"{y},{m},{y}-{m:02d},{'TRUE' if m in festival_months else 'FALSE'}"
                for y in (2025, 2026) for m in range(1, 13)]
        paths["calendar_path"].write_text("Year,Month,Year_Month,Is_Festival_Month\n" + "\n".join(rows) + "\n")

    def run_with_calendar(self, eval_date, festival_months):
        fx = Fixture(eval_date).sku("A", "Low", on_hand=700)
        paths = fx.write(self.root)
        self.write_calendar(paths, festival_months)
        return fe.run_freshroots_demand_engine(**paths, evaluation_date=eval_date, output_dir=None, print_report=False)

    def test_calendar_agrees_with_rule(self):
        res = self.run_with_calendar(EVAL_FESTIVAL, {3, 10, 11})
        cal = res.summary["run"]["calendar"]
        self.assertEqual(cal["granularity"], "month")
        self.assertTrue(cal["evaluation_month_calendar_festival"])
        codes = set(res.data_quality["Issue_Code"])
        self.assertFalse(codes & {"CALENDAR_FESTIVAL_MISMATCH", "CALENDAR_RULE_DISAGREEMENT", "UNRECOGNISED_CALENDAR"})
        self.assertIn("agrees with the rule", res.report)
        self.assertEqual(self.row(res, "A")["seasonal_uplift_pct"], 25.0)

    def test_calendar_disagreement_is_flagged_rule_still_applied(self):
        res = self.run_with_calendar(EVAL_FESTIVAL, {3, 11})  # calendar says October is not a festival month
        codes = set(res.data_quality["Issue_Code"])
        self.assertIn("CALENDAR_FESTIVAL_MISMATCH", codes)
        self.assertIn("CALENDAR_RULE_DISAGREEMENT", codes)
        self.assertEqual(self.row(res, "A")["seasonal_uplift_pct"], 25.0)  # documented rule governs


class TestFilesAndContracts(EngineTestCase):
    def test_21_empty_input_files(self):
        base = Fixture().sku("A", "Low", on_hand=300)
        for key, header in (("sku_master_path", fe.SKU_COLUMNS), ("sales_path", fe.SALES_COLUMNS),
                            ("inventory_path", fe.INVENTORY_COLUMNS)):
            with self.subTest(file=key, kind="header only"):
                paths = base.write(self.root)
                paths[key].write_text(",".join(header) + "\n")
                with self.assertRaises(fe.UnrecoverableDataError):
                    fe.run_freshroots_demand_engine(**paths, evaluation_date=base.eval_date, output_dir=None, print_report=False)
            with self.subTest(file=key, kind="zero bytes"):
                paths = base.write(self.root)
                paths[key].write_text("")
                with self.assertRaises(fe.UnrecoverableDataError):
                    fe.run_freshroots_demand_engine(**paths, evaluation_date=base.eval_date, output_dir=None, print_report=False)

    def test_missing_file_and_missing_column(self):
        paths = Fixture().sku("A", "Low", on_hand=300).write(self.root)
        with self.assertRaises(fe.InputFileError):
            fe.run_freshroots_demand_engine(**{**paths, "sales_path": self.root / "nope.csv"},
                                            evaluation_date=EVAL_NON_FESTIVAL, output_dir=None, print_report=False)
        paths["inventory_path"].write_text("SKU_ID,Location,As_Of_Date\nA,Pune DC,2026-07-14\n")
        with self.assertRaises(fe.SchemaValidationError):
            fe.run_freshroots_demand_engine(**paths, evaluation_date=EVAL_NON_FESTIVAL, output_dir=None, print_report=False)

    def test_22_deterministic_repeated_runs(self):
        fx = (Fixture().sku("A", "Low", on_hand=300).sku("B", "High", weekly=[80] * 8 + [140] * 4, on_hand=100)
              .sku("C", "Low", weekly=[None] * 3 + [50] * 9, on_hand=10))
        first = self.run_engine(fx, write=True)
        out = self.root / "out"
        csv1 = (out / "reorder_recommendations.csv").read_bytes()
        json1 = (out / "executive_summary.json").read_bytes()
        second = self.run_engine(fx, write=True)
        pd.testing.assert_frame_equal(first.recommendations, second.recommendations)
        pd.testing.assert_frame_equal(first.data_quality, second.data_quality)
        self.assertEqual(csv1, (out / "reorder_recommendations.csv").read_bytes())
        self.assertEqual(json1, (out / "executive_summary.json").read_bytes())

    def test_required_columns_and_one_row_per_sku(self):
        fx = Fixture().sku("A", "Low", on_hand=300).sku("B", "High", locations=[("Pune DC", 10), ("Goa DC", 20)])
        res = self.run_engine(fx, write=True)
        for col in fe.REQUIRED_OUTPUT_COLUMNS:
            self.assertIn(col, res.recommendations.columns)
        self.assertFalse(res.recommendations["SKU_ID"].duplicated().any())
        for name in ("reorder_recommendations.csv", "data_quality_report.csv", "executive_summary.json"):
            self.assertTrue((self.root / "out" / name).is_file())
        self.assertTrue(res.recommendations["Explanation"].str.len().gt(0).all())

    def test_refuses_to_overwrite_inputs(self):
        paths = Fixture().sku("A", "Low", on_hand=300).write(self.root)
        target = self.root / "reorder_recommendations.csv"
        paths["sku_master_path"].rename(target)
        paths["sku_master_path"] = target
        with self.assertRaises(fe.ConfigurationError):
            fe.run_freshroots_demand_engine(**paths, evaluation_date=EVAL_NON_FESTIVAL,
                                            output_dir=self.root, print_report=False)

    def test_financials_not_invented_without_costs(self):
        res = self.run_engine(Fixture().sku("A", "Low", on_hand=300))
        fin = res.summary["financial_estimates"]
        self.assertEqual(fin["status"], "NOT_AVAILABLE")
        self.assertIsNone(fin["inventory_value_inr"])
        scen = res.summary["illustrative_prevention_scenarios"]["scenarios"]
        self.assertEqual(scen[0]["quarterly_loss_reduction_inr_lakh"], [2.8, 3.4])

    def test_config_rejects_unknown_keys_and_bad_values(self):
        with self.assertRaises(fe.ConfigurationError):
            fe.EngineConfig.from_dict({"surge_threshold": 1.3})
        with self.assertRaises(fe.ConfigurationError):
            fe.EngineConfig(low_perish_stockout_weeks=20)


if __name__ == "__main__":
    unittest.main()
