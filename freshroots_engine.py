#!/usr/bin/env python3
"""Freshroots demand planning & reorder intelligence engine.

Deterministic, rule-based decision support. It turns the planner's documented
replenishment rules into code, explains every recommendation, and routes
anything it cannot trust to a human. It never sends purchase orders.

Pipeline:
    load_input_files -> validate_input_data -> prepare_weekly_sales
    -> calculate_demand_metrics -> apply_seasonality -> detect_demand_surges
    -> calculate_stock_cover -> classify_inventory_risk
    -> generate_recommendations -> calculate_financial_summary
    -> format_executive_report

Entry point: run_freshroots_demand_engine()
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sys
import textwrap
from dataclasses import asdict, dataclass, field, fields
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple, Union

import numpy as np
import pandas as pd

ENGINE_VERSION = "1.0.0"
LOGGER = logging.getLogger("freshroots")

PathLike = Union[str, Path]

# --------------------------------------------------------------------------- #
# Exceptions
# --------------------------------------------------------------------------- #


class FreshrootsError(Exception):
    """Base class for engine errors."""


class InputFileError(FreshrootsError):
    """A required input file is missing or unreadable."""


class SchemaValidationError(FreshrootsError):
    """An input file does not have the required columns."""


class UnrecoverableDataError(FreshrootsError):
    """Data is too broken for any SKU to receive a reliable recommendation."""


class ConfigurationError(FreshrootsError):
    """The engine configuration is invalid."""


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #


@dataclass
class EngineConfig:
    """All business rules and thresholds in one place.

    Defaults reproduce the planner's documented rules. Override via
    EngineConfig.from_json() or EngineConfig.from_dict().
    """

    # Demand windows (calendar weeks ending at the sales cutoff week).
    long_window_weeks: int = 12
    short_window_weeks: int = 4
    # Minimum observed weeks in each window for an automatic recommendation.
    # No partial-history fallback is applied: below these, the SKU goes to review.
    min_observed_weeks_long: int = 12
    min_observed_weeks_short: int = 4

    # Seasonality: uplift applied when the evaluation month is a festival month.
    festival_months: Tuple[int, ...] = (10, 11, 3)
    seasonal_uplift_pct: float = 25.0

    # Surge detection: strictly greater than the threshold triggers the multiplier.
    surge_ratio_threshold: float = 1.20
    surge_reorder_multiplier: float = 1.5

    # Cover bands in weeks. Stockout is strictly below the lower bound,
    # overstock strictly above the upper bound; both bounds are inclusive "optimal".
    low_perish_stockout_weeks: float = 6.0
    low_perish_overstock_weeks: float = 14.0
    high_perish_stockout_weeks: float = 3.0
    high_perish_overstock_weeks: float = 4.0

    # Fractional quantities from the surge multiplier: "ceil" | "floor" | "round_half_up".
    reorder_rounding: str = "ceil"

    # Multi-warehouse policy: "sum_locations" (one SKU decision on total stock,
    # because sales are only available at SKU level) or "require_single_location"
    # (SKUs held in more than one location go to manual review).
    inventory_aggregation: str = "sum_locations"

    # Inventory snapshot older than this many days before evaluation -> warning.
    stale_inventory_days: int = 7
    # Latest complete sales week more than this many weeks before the
    # evaluation week -> global warning.
    max_sales_lag_weeks: int = 2
    # Optional explicit sales cutoff (e.g. "2026-W40"). Default: the latest
    # complete week present in the sales file on or before the evaluation date.
    sales_cutoff_week: Optional[str] = None

    # Condiment appears in the real SAP export although the brief lists only four.
    # Category drives no rule, so an unlisted category is a warning, not a block.
    valid_categories: Tuple[str, ...] = ("Beverage", "Snack", "Staple", "Dairy Alt", "Condiment")
    valid_perishability: Tuple[str, ...] = ("Low", "High")
    expected_unit_of_measure: str = "Units"

    # Covers and ratios are rounded to this many decimals before comparing with
    # thresholds so floating-point noise cannot flip an exact boundary.
    comparison_decimals: int = 9

    # Case-study business baseline (INR lakh per quarter), reported separately.
    baseline_quarterly_stockout_loss_lakh: Tuple[float, float] = (18.0, 22.0)
    baseline_quarterly_overstock_loss_lakh: Tuple[float, float] = (10.0, 12.0)
    baseline_quarterly_total_loss_lakh: Tuple[float, float] = (28.0, 34.0)
    prevention_scenarios_pct: Tuple[float, ...] = (10.0, 20.0, 30.0)

    def __post_init__(self) -> None:
        # JSON gives lists; normalise to tuples so the config stays hashable/immutable-ish.
        for f in fields(self):
            value = getattr(self, f.name)
            if isinstance(value, list):
                setattr(self, f.name, tuple(value))
        self.validate()

    def validate(self) -> None:
        problems: List[str] = []
        if self.reorder_rounding not in ("ceil", "floor", "round_half_up"):
            problems.append(f"reorder_rounding must be ceil|floor|round_half_up, got {self.reorder_rounding!r}")
        if self.inventory_aggregation not in ("sum_locations", "require_single_location"):
            problems.append(f"inventory_aggregation must be sum_locations|require_single_location, got {self.inventory_aggregation!r}")
        if not 0 < self.short_window_weeks <= self.long_window_weeks:
            problems.append("short_window_weeks must be >0 and <= long_window_weeks")
        if not 0 < self.min_observed_weeks_long <= self.long_window_weeks:
            problems.append("min_observed_weeks_long must be within 1..long_window_weeks")
        if not 0 < self.min_observed_weeks_short <= self.short_window_weeks:
            problems.append("min_observed_weeks_short must be within 1..short_window_weeks")
        if not self.low_perish_stockout_weeks < self.low_perish_overstock_weeks:
            problems.append("low_perish_stockout_weeks must be < low_perish_overstock_weeks")
        if not self.high_perish_stockout_weeks < self.high_perish_overstock_weeks:
            problems.append("high_perish_stockout_weeks must be < high_perish_overstock_weeks")
        if any(m not in range(1, 13) for m in self.festival_months):
            problems.append("festival_months must contain month numbers 1..12")
        if self.seasonal_uplift_pct < 0 or self.surge_reorder_multiplier <= 0 or self.surge_ratio_threshold <= 0:
            problems.append("uplift must be >=0; surge threshold and multiplier must be >0")
        if problems:
            raise ConfigurationError("; ".join(problems))

    @classmethod
    def from_dict(cls, values: Dict[str, Any]) -> "EngineConfig":
        known = {f.name for f in fields(cls)}
        unknown = sorted(set(values) - known)
        if unknown:
            raise ConfigurationError(f"Unknown configuration key(s): {unknown}")
        return cls(**values)

    @classmethod
    def from_json(cls, path: PathLike) -> "EngineConfig":
        p = Path(path)
        if not p.is_file():
            raise ConfigurationError(f"Config file not found: {p}")
        with p.open(encoding="utf-8") as fh:
            values = json.load(fh)
        values = {k: v for k, v in values.items() if not k.startswith("_")}  # allow _comment keys
        return cls.from_dict(values)

    def to_dict(self) -> Dict[str, Any]:
        return {k: (list(v) if isinstance(v, tuple) else v) for k, v in asdict(self).items()}


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #

SKU_COLUMNS = ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID"]
INVENTORY_COLUMNS = ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"]
SALES_COLUMNS = ["SKU_ID", "Week", "Units_Sold"]

REQUIRED_OUTPUT_COLUMNS = [
    "SKU_ID", "SKU_Name", "Category", "Perishability", "Units_On_Hand",
    "avg_12w_sales", "avg_4w_sales", "seasonal_uplift_pct", "baseline_demand",
    "demand_ratio", "demand_spurt_flag", "weeks_of_stock", "Flags", "Action",
    "Standard_Reorder_Qty", "effective_reorder_qty", "Recommended_Order_Qty",
    "Data_Quality_Status", "Data_Quality_Notes", "Review_Required", "Explanation",
]
EXTRA_OUTPUT_COLUMNS = [
    "Distributor_ID", "Location_Count", "Locations", "weeks_observed_12w", "weeks_observed_4w",
    "reorder_multiplier", "Inventory_Flag", "Indicative_Action", "Review_Reasons",
    "Evaluation_Date", "Inventory_As_Of_Date", "Sales_Cutoff_Week",
]

ACTION_REORDER = "IMMEDIATE_REORDER"
ACTION_PAUSE = "PAUSE_ORDER"
ACTION_MAINTAIN = "MAINTAIN"
ACTION_REVIEW = "MANUAL_REVIEW"
FLAG_SPURT = "HIGH_DEMAND_SPURT"
STOCKOUT_FLAGS = ("STOCKOUT_RISK", "STOCKOUT_RISK_HIGH")
OVERSTOCK_FLAGS = ("OVERSTOCK_RISK", "OVERSTOCK_RISK_HIGH")

SEVERITY_ERROR = "ERROR"
SEVERITY_WARNING = "WARNING"
SEVERITY_INFO = "INFO"

_WEEK_RE = re.compile(r"^(\d{4})-?W(\d{1,2})$", re.IGNORECASE)
_DATE_FORMATS = ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d", "%d-%b-%Y", "%d %b %Y")


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #


def parse_iso_week(value: Any) -> Optional[date]:
    """'2026-W27' -> Monday of that ISO week; None if invalid."""
    match = _WEEK_RE.match(str(value).strip())
    if not match:
        return None
    try:
        return date.fromisocalendar(int(match.group(1)), int(match.group(2)), 1)
    except ValueError:
        return None


def format_iso_week(monday: date) -> str:
    year, week, _ = monday.isocalendar()
    return f"{year}-W{week:02d}"


def _normalise_id(series: pd.Series) -> pd.Series:
    """Trim whitespace, collapse internal runs of spaces, upper-case. Meaning is preserved."""
    return series.fillna("").astype(str).str.strip().str.replace(r"\s+", " ", regex=True).str.upper()


def _to_number(series: pd.Series) -> pd.Series:
    """Strict numeric parse: thousands separators allowed, anything else -> NaN."""
    cleaned = series.fillna("").astype(str).str.strip().str.replace(",", "", regex=False)
    return pd.to_numeric(cleaned.where(cleaned != ""), errors="coerce")


def _parse_dates(series: pd.Series) -> pd.Series:
    """Parse with an explicit list of accepted formats (ISO first, then day-first)."""
    result = pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")
    text = series.fillna("").astype(str).str.strip()
    for fmt in _DATE_FORMATS:
        missing = result.isna() & (text != "")
        if not missing.any():
            break
        result.loc[missing] = pd.to_datetime(text[missing], format=fmt, errors="coerce")
    return result


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fmt_num(value: Any, decimals: int = 1) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "n/a"
    return f"{value:,.{decimals}f}"


# --------------------------------------------------------------------------- #
# Data-quality log
# --------------------------------------------------------------------------- #


@dataclass
class DataQualityLog:
    """Every rejected, collapsed, or suspicious record, with the reason.

    blocks_sku=True means the issue prevents that SKU from receiving an
    automatic recommendation (it is routed to MANUAL_REVIEW).
    """

    records: List[Dict[str, Any]] = field(default_factory=list)

    COLUMNS = ["Source_File", "Row_Number", "SKU_ID", "Severity", "Issue_Code", "Detail", "Disposition", "Blocks_SKU"]

    def add(self, source: str, code: str, detail: str, severity: str = SEVERITY_WARNING, sku_id: str = "",
            row: Optional[int] = None, disposition: str = "KEPT", blocks_sku: bool = False) -> None:
        self.records.append({
            "Source_File": source, "Row_Number": row, "SKU_ID": sku_id, "Severity": severity,
            "Issue_Code": code, "Detail": detail, "Disposition": disposition, "Blocks_SKU": bool(blocks_sku),
        })

    def add_rows(self, rows: pd.DataFrame, source: str, code: str, detail: Union[str, Callable[[Dict[str, Any]], str]],
                 severity: str = SEVERITY_WARNING, disposition: str = "KEPT", blocks_sku: bool = False) -> None:
        for rec in rows.to_dict("records"):
            text = detail(rec) if callable(detail) else detail
            self.add(source, code, text, severity, str(rec.get("SKU_ID", "")), rec.get("_row"), disposition, blocks_sku)

    def blocked_skus(self) -> set:
        return {r["SKU_ID"] for r in self.records if r["Blocks_SKU"] and r["SKU_ID"]}

    def to_frame(self) -> pd.DataFrame:
        df = pd.DataFrame(self.records, columns=self.COLUMNS)
        df["Row_Number"] = df["Row_Number"].astype("Int64")
        df["Blocks_SKU"] = df["Blocks_SKU"].astype(bool)
        return df

    def global_issues(self) -> List[Dict[str, Any]]:
        return [r for r in self.records if r["Source_File"] == "run"]


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #


@dataclass
class InputPaths:
    sku_master: Path
    inventory: Path
    sales: Path
    calendar: Optional[Path] = None
    distributors: Optional[Path] = None

    def items(self) -> Iterable[Tuple[str, Optional[Path]]]:
        return [("sku_master", self.sku_master), ("current_inventory", self.inventory), ("weekly_sales", self.sales),
                ("calendar", self.calendar), ("distributor_master", self.distributors)]


def _read_csv(path: Optional[Path], name: str, required: bool) -> Optional[pd.DataFrame]:
    if path is None:
        return None
    if not path.is_file():
        if required:
            raise InputFileError(f"Required input file '{name}' not found at {path}")
        LOGGER.warning("Optional input %s not found at %s; continuing without it", name, path)
        return None
    try:
        df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    except pd.errors.EmptyDataError:
        df = pd.DataFrame()
    except (UnicodeDecodeError, pd.errors.ParserError) as exc:
        raise InputFileError(f"Could not parse {name} at {path}: {exc}") from exc
    df.columns = [str(c).strip() for c in df.columns]
    for col in df.columns:
        df[col] = df[col].astype(str).str.strip()
    df["_row"] = np.arange(len(df)) + 2  # CSV line number (header is line 1)
    LOGGER.info("Loaded %s: %d rows, columns=%s", name, len(df), [c for c in df.columns if c != "_row"])
    return df


def load_input_files(paths: InputPaths) -> Dict[str, Optional[pd.DataFrame]]:
    """Read all inputs as text. Typing happens in validation so bad values are reported, not lost."""
    return {
        "sku_master": _read_csv(paths.sku_master, "sku_master", required=True),
        "inventory": _read_csv(paths.inventory, "current_inventory", required=True),
        "sales": _read_csv(paths.sales, "weekly_sales", required=True),
        "calendar": _read_csv(paths.calendar, "calendar", required=False),
        "distributors": _read_csv(paths.distributors, "distributor_master", required=False),
    }


def _require_schema(df: pd.DataFrame, required: List[str], name: str) -> pd.DataFrame:
    """Map headers case-insensitively onto canonical names; fail loudly if any are missing."""
    if df is None or len([c for c in df.columns if c != "_row"]) == 0:
        raise UnrecoverableDataError(f"{name} is empty (no header row).")
    lookup = {c.lower().replace(" ", "_"): c for c in df.columns}
    rename, missing = {}, []
    for col in required:
        if col in df.columns:
            continue
        source = lookup.get(col.lower())
        if source is None:
            missing.append(col)
        else:
            rename[source] = col
    if missing:
        found = [c for c in df.columns if c != "_row"]
        raise SchemaValidationError(f"{name} is missing required column(s) {missing}. Found columns: {found}")
    df = df.rename(columns=rename)
    if df.empty:
        raise UnrecoverableDataError(f"{name} has a header but no data rows.")
    return df


def _find_column(df: pd.DataFrame, *candidates: str) -> Optional[str]:
    lookup = {c.lower().replace(" ", "_"): c for c in df.columns}
    for cand in candidates:
        if cand.lower() in lookup:
            return lookup[cand.lower()]
    return None


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #


@dataclass
class ValidatedInputs:
    sku_master: pd.DataFrame          # one row per SKU_ID
    inventory_rows: pd.DataFrame      # valid, de-duplicated location rows
    inventory: pd.DataFrame           # one row per SKU_ID (aggregated)
    sales: pd.DataFrame               # valid sales rows with week_start
    calendar_info: Dict[str, Any]
    dq: DataQualityLog
    evaluation_date: date


def _validate_sku_master(raw: pd.DataFrame, config: EngineConfig, dq: DataQualityLog,
                         distributor_ids: Optional[set]) -> pd.DataFrame:
    src = "sku_master"
    df = _require_schema(raw, SKU_COLUMNS, src).copy()
    df["SKU_ID"] = _normalise_id(df["SKU_ID"])
    df["Distributor_ID"] = _normalise_id(df["Distributor_ID"])

    blank = df["SKU_ID"] == ""
    dq.add_rows(df[blank], src, "BLANK_SKU_ID", "Row has no SKU_ID", SEVERITY_ERROR, "QUARANTINED")
    df = df[~blank]

    exact = df.duplicated(SKU_COLUMNS, keep="first")
    dq.add_rows(df[exact], src, "DUPLICATE_SKU_ROW", "Identical duplicate master row collapsed", SEVERITY_WARNING, "COLLAPSED")
    df = df[~exact]
    conflict = df.duplicated("SKU_ID", keep=False)
    dq.add_rows(df[conflict], src, "CONFLICTING_SKU_MASTER",
                "SKU_ID appears more than once with different attributes; first row shown, SKU held for review",
                SEVERITY_ERROR, "SKU_BLOCKED", blocks_sku=True)
    df = df.drop_duplicates("SKU_ID", keep="first")

    cat_map = {c.lower(): c for c in config.valid_categories}
    canon_cat = df["Category"].str.lower().map(cat_map)
    dq.add_rows(df[canon_cat.isna()], src, "UNKNOWN_CATEGORY",
                lambda r: f"Category '{r['Category']}' is not one of {list(config.valid_categories)}; "
                          "kept (category does not affect the reorder rules)",
                SEVERITY_WARNING)
    df["Category"] = canon_cat.fillna(df["Category"])

    per_map = {p.lower(): p for p in config.valid_perishability}
    canon_per = df["Perishability"].str.lower().map(per_map)
    dq.add_rows(df[canon_per.isna()], src, "INVALID_PERISHABILITY",
                lambda r: f"Perishability '{r['Perishability']}' is not one of {list(config.valid_perishability)}",
                SEVERITY_ERROR, "SKU_BLOCKED", blocks_sku=True)
    df["Perishability"] = canon_per.fillna(df["Perishability"])

    qty = _to_number(df["Standard_Reorder_Qty"])
    bad_qty = qty.isna() | (qty <= 0) | (qty != np.floor(qty))
    dq.add_rows(df[bad_qty], src, "INVALID_REORDER_QTY",
                lambda r: f"Standard_Reorder_Qty '{r['Standard_Reorder_Qty']}' is not a positive whole number",
                SEVERITY_ERROR, "SKU_BLOCKED", blocks_sku=True)
    df["Standard_Reorder_Qty"] = qty.where(~bad_qty)

    uom = df["Unit_of_Measure"].str.lower()
    expected = config.expected_unit_of_measure.lower()
    dq.add_rows(df[uom == ""], src, "MISSING_UOM",
                f"Unit_of_Measure blank; treated as '{config.expected_unit_of_measure}' (sales and inventory carry no unit)",
                SEVERITY_WARNING)
    dq.add_rows(df[(uom != "") & (uom != expected)], src, "UNSUPPORTED_UOM",
                lambda r: f"Unit_of_Measure '{r['Unit_of_Measure']}' differs from '{config.expected_unit_of_measure}'; "
                          "cover cannot be computed in consistent units",
                SEVERITY_ERROR, "SKU_BLOCKED", blocks_sku=True)

    dq.add_rows(df[df["SKU_Name"] == ""], src, "MISSING_SKU_NAME", "SKU_Name is blank", SEVERITY_WARNING)
    dq.add_rows(df[df["Distributor_ID"] == ""], src, "MISSING_DISTRIBUTOR", "Distributor_ID is blank", SEVERITY_WARNING)
    if distributor_ids is not None:
        unknown = (df["Distributor_ID"] != "") & ~df["Distributor_ID"].isin(distributor_ids)
        dq.add_rows(df[unknown], src, "UNKNOWN_DISTRIBUTOR",
                    lambda r: f"Distributor_ID '{r['Distributor_ID']}' not in distributor_master", SEVERITY_WARNING)

    cost_col = _find_column(df, "Unit_Cost", "Unit_Cost_INR", "Cost_Per_Unit")
    if cost_col:
        cost = _to_number(df[cost_col])
        bad_cost = cost.isna() | (cost < 0)
        dq.add_rows(df[bad_cost], src, "INVALID_UNIT_COST",
                    lambda r: f"{cost_col} '{r[cost_col]}' is not a valid non-negative number; excluded from value estimates",
                    SEVERITY_WARNING)
        df["Unit_Cost"] = cost.where(~bad_cost)
    else:
        df["Unit_Cost"] = np.nan

    return df.sort_values("SKU_ID").reset_index(drop=True)


def _validate_inventory(raw: pd.DataFrame, master_ids: set, evaluation_date: date, config: EngineConfig,
                        dq: DataQualityLog) -> Tuple[pd.DataFrame, pd.DataFrame]:
    src = "current_inventory"
    df = _require_schema(raw, INVENTORY_COLUMNS, src).copy()
    df["SKU_ID"] = _normalise_id(df["SKU_ID"])
    df["Location"] = df["Location"].str.replace(r"\s+", " ", regex=True)

    blank = df["SKU_ID"] == ""
    dq.add_rows(df[blank], src, "BLANK_SKU_ID", "Row has no SKU_ID", SEVERITY_ERROR, "QUARANTINED")
    unknown = ~blank & ~df["SKU_ID"].isin(master_ids)
    dq.add_rows(df[unknown], src, "UNKNOWN_SKU", lambda r: f"SKU_ID '{r['SKU_ID']}' not in sku_master",
                SEVERITY_ERROR, "QUARANTINED")
    df = df[~blank & ~unknown]

    df["on_hand"] = _to_number(df["Units_On_Hand"])
    df["as_of"] = _parse_dates(df["As_Of_Date"])

    # Duplicates on SKU + Location: identical rows collapse; differing rows are a conflict.
    key = ["SKU_ID", "Location"]
    exact = df.duplicated(key + ["Units_On_Hand", "As_Of_Date"], keep="first")
    dq.add_rows(df[exact], src, "DUPLICATE_INVENTORY_ROW", "Identical duplicate snapshot collapsed",
                SEVERITY_WARNING, "COLLAPSED")
    df = df[~exact]
    conflict = df.duplicated(key, keep=False)
    dq.add_rows(df[conflict], src, "CONFLICTING_INVENTORY_SNAPSHOT",
                lambda r: f"More than one differing snapshot for {r['SKU_ID']} at '{r['Location']}' "
                          f"(Units_On_Hand={r['Units_On_Hand']!r}, As_Of_Date={r['As_Of_Date']!r})",
                SEVERITY_ERROR, "SKU_BLOCKED", blocks_sku=True)

    checks = [
        (df["Location"] == "", "BLANK_LOCATION", "Location is blank"),
        (df["Units_On_Hand"] == "", "MISSING_INVENTORY_VALUE", "Units_On_Hand is blank (not assumed to be zero)"),
        ((df["Units_On_Hand"] != "") & df["on_hand"].isna(), "INVALID_NUMERIC", None),
        (df["on_hand"] < 0, "NEGATIVE_INVENTORY", None),
        (df["as_of"].isna(), "INVALID_AS_OF_DATE", None),
        (df["as_of"] > pd.Timestamp(evaluation_date), "FUTURE_SNAPSHOT", None),
    ]
    invalid = pd.Series(False, index=df.index)
    for mask, code, text in checks:
        mask = mask.fillna(False) & ~invalid  # report the first problem per row
        detail = text or (lambda r, c=code: {
            "INVALID_NUMERIC": f"Units_On_Hand '{r['Units_On_Hand']}' is not numeric",
            "NEGATIVE_INVENTORY": f"Units_On_Hand {r['Units_On_Hand']} is negative",
            "INVALID_AS_OF_DATE": f"As_Of_Date '{r['As_Of_Date']}' is missing or not a recognised date",
            "FUTURE_SNAPSHOT": f"As_Of_Date {r['As_Of_Date']} is after evaluation date {evaluation_date}",
        }[c])
        dq.add_rows(df[mask], src, code, detail, SEVERITY_ERROR, "SKU_BLOCKED", blocks_sku=True)
        invalid |= mask
    invalid |= conflict

    frac = ~invalid & (df["on_hand"] != np.floor(df["on_hand"]))
    dq.add_rows(df[frac], src, "FRACTIONAL_INVENTORY", lambda r: f"Units_On_Hand {r['Units_On_Hand']} is fractional",
                SEVERITY_WARNING)
    age_days = (pd.Timestamp(evaluation_date) - df["as_of"]).dt.days
    stale = ~invalid & (age_days > config.stale_inventory_days)
    dq.add_rows(df[stale], src, "STALE_INVENTORY",
                lambda r: f"Snapshot {r['As_Of_Date']} is more than {config.stale_inventory_days} days before evaluation date {evaluation_date}",
                SEVERITY_WARNING)

    df["row_valid"] = ~invalid
    valid = df[df["row_valid"]]

    # Aggregate per SKU (explicit policy). Any invalid row for a SKU makes its
    # total unknown: partial sums are not presented as stock on hand.
    agg = valid.groupby("SKU_ID", sort=True).agg(
        Units_On_Hand=("on_hand", "sum"),
        Location_Count=("Location", "nunique"),
        Locations=("Location", lambda s: "; ".join(sorted(s))),
        as_of_min=("as_of", "min"),
        as_of_max=("as_of", "max"),
    )
    any_invalid = df.groupby("SKU_ID")["row_valid"].apply(lambda s: not s.all())
    agg = agg.reindex(sorted(set(df["SKU_ID"])))
    agg["inventory_valid"] = ~any_invalid.reindex(agg.index).fillna(True).astype(bool)
    agg.loc[~agg["inventory_valid"], "Units_On_Hand"] = np.nan

    mixed_dates = agg["inventory_valid"] & (agg["as_of_min"] != agg["as_of_max"])
    for sku in agg.index[mixed_dates]:
        dq.add(src, "MIXED_SNAPSHOT_DATES",
               f"Locations report different snapshot dates ({agg.at[sku, 'as_of_min'].date()} to {agg.at[sku, 'as_of_max'].date()}); summed as-is",
               SEVERITY_WARNING, sku)
    if config.inventory_aggregation == "require_single_location":
        for sku in agg.index[agg["inventory_valid"] & (agg["Location_Count"] > 1)]:
            dq.add(src, "MULTIPLE_LOCATIONS",
                   f"Held in {int(agg.at[sku, 'Location_Count'])} locations; policy require_single_location needs review",
                   SEVERITY_ERROR, sku, disposition="SKU_BLOCKED", blocks_sku=True)
    elif config.inventory_aggregation == "sum_locations":
        for sku in agg.index[agg["inventory_valid"] & (agg["Location_Count"] > 1)]:
            dq.add(src, "LOCATIONS_SUMMED",
                   f"Stock summed across {int(agg.at[sku, 'Location_Count'])} locations ({agg.at[sku, 'Locations']})",
                   SEVERITY_INFO, sku)

    for sku in sorted(master_ids - set(agg.index)):
        dq.add(src, "MISSING_INVENTORY", "No inventory record for this SKU (not assumed to be zero)",
               SEVERITY_ERROR, sku, disposition="SKU_BLOCKED", blocks_sku=True)

    agg.index.name = "SKU_ID"
    return valid.drop(columns=["row_valid"]), agg.reset_index()


def _validate_sales(raw: pd.DataFrame, master_ids: set, evaluation_date: date, dq: DataQualityLog) -> pd.DataFrame:
    src = "weekly_sales"
    df = _require_schema(raw, SALES_COLUMNS, src).copy()
    df["SKU_ID"] = _normalise_id(df["SKU_ID"])

    blank = df["SKU_ID"] == ""
    dq.add_rows(df[blank], src, "BLANK_SKU_ID", "Row has no SKU_ID", SEVERITY_ERROR, "QUARANTINED")
    unknown = ~blank & ~df["SKU_ID"].isin(master_ids)
    dq.add_rows(df[unknown], src, "UNKNOWN_SKU", lambda r: f"SKU_ID '{r['SKU_ID']}' not in sku_master",
                SEVERITY_ERROR, "QUARANTINED")
    df = df[~blank & ~unknown].copy()

    df["week_start"] = df["Week"].map(parse_iso_week)
    bad_week = df["week_start"].isna()
    dq.add_rows(df[bad_week], src, "INVALID_WEEK", lambda r: f"Week '{r['Week']}' is not a valid ISO week (YYYY-Www)",
                SEVERITY_ERROR, "QUARANTINED")
    df = df[~bad_week].copy()
    df["Week"] = df["week_start"].map(format_iso_week)

    df["units"] = _to_number(df["Units_Sold"])
    missing = df["Units_Sold"] == ""
    invalid = ~missing & df["units"].isna()
    negative = df["units"] < 0
    dq.add_rows(df[missing], src, "MISSING_SALES_VALUE", lambda r: f"Units_Sold blank for {r['Week']} (treated as missing, not zero)",
                SEVERITY_ERROR, "QUARANTINED")
    dq.add_rows(df[invalid], src, "INVALID_NUMERIC", lambda r: f"Units_Sold '{r['Units_Sold']}' for {r['Week']} is not numeric",
                SEVERITY_ERROR, "QUARANTINED")
    dq.add_rows(df[negative], src, "NEGATIVE_SALES", lambda r: f"Units_Sold {r['Units_Sold']} for {r['Week']} is negative",
                SEVERITY_ERROR, "QUARANTINED")
    df = df[~(missing | invalid | negative)].copy()

    key = ["SKU_ID", "week_start"]
    exact = df.duplicated(key + ["units"], keep="first")
    dq.add_rows(df[exact], src, "DUPLICATE_SALES_ROW", lambda r: f"Identical duplicate for {r['Week']} collapsed",
                SEVERITY_WARNING, "COLLAPSED")
    df = df[~exact]
    conflict = df.duplicated(key, keep=False)
    dq.add_rows(df[conflict], src, "CONFLICTING_SALES_ROWS",
                lambda r: f"{r['Week']} has differing Units_Sold values; week treated as missing",
                SEVERITY_ERROR, "QUARANTINED")
    df = df[~conflict]

    # A week counts only once it is complete (its Sunday is on/before the evaluation date).
    week_end = df["week_start"].map(lambda d: d + timedelta(days=6))
    future = week_end > evaluation_date
    dq.add_rows(df[future], src, "WEEK_AFTER_EVALUATION",
                lambda r: f"{r['Week']} is not complete as of {evaluation_date}; excluded",
                SEVERITY_INFO, "EXCLUDED")
    df = df[~future]

    frac = df["units"] != np.floor(df["units"])
    dq.add_rows(df[frac], src, "FRACTIONAL_SALES", lambda r: f"Units_Sold {r['Units_Sold']} for {r['Week']} is fractional",
                SEVERITY_WARNING)

    return df[["SKU_ID", "Week", "week_start", "units", "_row"]].rename(columns={"units": "Units_Sold"}).reset_index(drop=True)


def _inspect_calendar(raw: Optional[pd.DataFrame], dq: DataQualityLog) -> Dict[str, Any]:
    """Detect calendar columns from content, not assumed names.

    Returns the detected week column, any festival/month columns, and a
    week -> {column: value} lookup for reporting.
    """
    info: Dict[str, Any] = {"available": False}
    if raw is None:
        return info
    cols = [c for c in raw.columns if c != "_row"]
    if not cols or raw.empty:
        dq.add("calendar", "EMPTY_CALENDAR", "calendar file is empty; calendar checks skipped", SEVERITY_WARNING)
        return info
    week_col = None
    for c in cols:
        values = raw[c][raw[c] != ""]
        if len(values) and values.map(lambda v: parse_iso_week(v) is not None).mean() >= 0.9:
            week_col = c
            break
    festival_col = next((c for c in cols if "festiv" in c.lower() or "holiday" in c.lower() or "event" in c.lower()), None)
    festival_is_flag = bool(festival_col) and raw[festival_col].str.lower().isin(_TRUE_WORDS | _FALSE_WORDS).all()
    info.update({"available": True, "columns": cols, "week_column": week_col,
                 "festival_column": festival_col, "festival_is_flag": festival_is_flag})
    if week_col is None:
        months = _calendar_months(raw, cols)
        if months is None:
            dq.add("calendar", "UNRECOGNISED_CALENDAR",
                   f"No ISO-week or year-month columns detected in calendar (columns: {cols}); calendar checks skipped",
                   SEVERITY_WARNING)
            return info
        info["granularity"] = "month"
        flags = raw[festival_col].str.lower().isin(_TRUE_WORDS) if festival_is_flag else None
        bad = months.isna()
        dq.add_rows(raw[bad].assign(SKU_ID=""), "calendar", "INVALID_MONTH",
                    "Calendar row has no valid year/month", SEVERITY_WARNING, "IGNORED")
        info["months"] = {m: (bool(flags[i]) if flags is not None else None)
                          for i, m in months[~bad].items()}
        return info
    info["granularity"] = "week"
    cal = raw.copy()
    cal["week_start"] = cal[week_col].map(parse_iso_week)
    bad = cal["week_start"].isna()
    dq.add_rows(cal[bad].assign(SKU_ID=""), "calendar", "INVALID_WEEK",
                lambda r: f"Calendar week '{r[week_col]}' is not a valid ISO week", SEVERITY_WARNING, "IGNORED")
    cal = cal[~bad]
    dups = cal.duplicated("week_start", keep="first")
    if dups.any():
        dq.add("calendar", "DUPLICATE_CALENDAR_WEEK", f"{int(dups.sum())} duplicate calendar week row(s); first kept",
               SEVERITY_WARNING)
    cal = cal[~dups]
    info["weeks"] = {
        row["week_start"]: {c: row[c] for c in cols if c != week_col}
        for row in cal.to_dict("records")
    }
    return info


_TRUE_WORDS = {"true", "yes", "y", "1"}
_FALSE_WORDS = {"false", "no", "n", "0", ""}


def _calendar_months(raw: pd.DataFrame, cols: List[str]) -> Optional[pd.Series]:
    """(year, month) per row from a 'YYYY-MM' column or separate Year and Month columns; None if neither exists."""
    ym_col = next((c for c in cols if c.lower().replace(" ", "_") in ("year_month", "yearmonth", "month_id")), None)
    if ym_col:
        parsed = pd.to_datetime(raw[ym_col], format="%Y-%m", errors="coerce")
    else:
        year_col, month_col = _find_column(raw, "Year"), _find_column(raw, "Month")
        if not (year_col and month_col):
            return None
        year, month = _to_number(raw[year_col]), _to_number(raw[month_col])
        ok = year.notna() & month.between(1, 12)
        parsed = pd.to_datetime(
            year.where(ok).astype("Int64").astype(str) + "-" + month.where(ok).astype("Int64").astype(str),
            format="%Y-%m", errors="coerce")
    return parsed.map(lambda t: (t.year, t.month) if pd.notna(t) else None)


def _check_calendar_months(info: Dict[str, Any], sales: pd.DataFrame, evaluation_date: date,
                           config: EngineConfig, dq: DataQualityLog) -> None:
    """Cross-check a monthly calendar against the festival-month rule and the sales period.

    The rule itself always uses config.festival_months (the planner's documented
    rule); the calendar is evidence that the rule and the business calendar agree.
    """
    months = info.get("months")
    if not months:
        return
    eval_key = (evaluation_date.year, evaluation_date.month)
    rule_says = evaluation_date.month in config.festival_months
    info["evaluation_month"] = f"{eval_key[0]}-{eval_key[1]:02d}"
    info["evaluation_month_rule_festival"] = rule_says
    if eval_key not in months:
        dq.add("run", "CALENDAR_MISSING_EVAL_MONTH",
               f"Calendar has no row for {info['evaluation_month']}; festival rule applied from configuration only",
               SEVERITY_WARNING)
    elif months[eval_key] is not None:
        info["evaluation_month_calendar_festival"] = months[eval_key]
        if months[eval_key] != rule_says:
            dq.add("run", "CALENDAR_FESTIVAL_MISMATCH",
                   f"Calendar marks {info['evaluation_month']} festival={months[eval_key]} but the configured rule says "
                   f"{rule_says}; the configured rule was applied - confirm with the planner", SEVERITY_WARNING)
    disagree = sorted(f"{y}-{m:02d}" for (y, m), flag in months.items()
                      if flag is not None and flag != (m in config.festival_months))
    if disagree:
        dq.add("calendar", "CALENDAR_RULE_DISAGREEMENT",
               f"Calendar festival flag differs from festival_months {list(config.festival_months)} for: {', '.join(disagree)}",
               SEVERITY_WARNING)
    sales_months = {(d.year, d.month) for d in sales["week_start"]}
    uncovered = sorted(f"{y}-{m:02d}" for y, m in sales_months - set(months))
    if uncovered:
        dq.add("calendar", "SALES_MONTH_NOT_IN_CALENDAR",
               f"Sales months absent from calendar: {', '.join(uncovered)}", SEVERITY_WARNING)


def validate_input_data(raw: Dict[str, Optional[pd.DataFrame]], evaluation_date: date,
                        config: EngineConfig) -> ValidatedInputs:
    """Type, normalise, and check every input; route problems to the DQ log."""
    dq = DataQualityLog()

    distributor_ids = None
    inactive_ids: set = set()
    if raw.get("distributors") is not None and not raw["distributors"].empty:
        dist = raw["distributors"]
        col = _find_column(dist, "Distributor_ID")
        if col:
            distributor_ids = set(_normalise_id(dist[col]))
            status_col = _find_column(dist, "Status")
            if status_col:
                inactive_ids = set(_normalise_id(dist.loc[dist[status_col].str.lower() != "active", col]))
        else:
            dq.add("distributor_master", "NO_DISTRIBUTOR_ID_COLUMN",
                   "distributor_master has no Distributor_ID column; distributor check skipped", SEVERITY_WARNING)

    sku = _validate_sku_master(raw["sku_master"], config, dq, distributor_ids)
    dq.add_rows(sku[sku["Distributor_ID"].isin(inactive_ids)], "sku_master", "INACTIVE_DISTRIBUTOR",
                lambda r: f"Distributor {r['Distributor_ID']} is not Active in distributor_master; confirm supplier before ordering",
                SEVERITY_WARNING)
    if sku.empty:
        raise UnrecoverableDataError("sku_master has no usable SKU rows after validation.")
    master_ids = set(sku["SKU_ID"])
    inv_rows, inventory = _validate_inventory(raw["inventory"], master_ids, evaluation_date, config, dq)
    sales = _validate_sales(raw["sales"], master_ids, evaluation_date, dq)
    calendar_info = _inspect_calendar(raw.get("calendar"), dq)
    _check_calendar_months(calendar_info, sales, evaluation_date, config, dq)

    if calendar_info.get("weeks"):
        known_weeks = set(calendar_info["weeks"])
        missing_weeks = sorted(set(sales["week_start"]) - known_weeks)
        if missing_weeks:
            dq.add("calendar", "SALES_WEEK_NOT_IN_CALENDAR",
                   f"{len(missing_weeks)} sales week(s) absent from calendar: "
                   + ", ".join(format_iso_week(w) for w in missing_weeks[:10]), SEVERITY_WARNING)

    return ValidatedInputs(sku, inv_rows, inventory, sales, calendar_info, dq, evaluation_date)


# --------------------------------------------------------------------------- #
# Calculations
# --------------------------------------------------------------------------- #


def prepare_weekly_sales(sales: pd.DataFrame, evaluation_date: date, config: EngineConfig,
                         dq: DataQualityLog) -> Tuple[pd.DataFrame, date]:
    """Pick one sales cutoff week for every SKU and drop anything after it."""
    if config.sales_cutoff_week:
        cutoff = parse_iso_week(config.sales_cutoff_week)
        if cutoff is None:
            raise ConfigurationError(f"sales_cutoff_week {config.sales_cutoff_week!r} is not a valid ISO week")
        if cutoff + timedelta(days=6) > evaluation_date:
            raise ConfigurationError(f"sales_cutoff_week {config.sales_cutoff_week} is not complete on {evaluation_date}")
    else:
        if sales.empty:
            raise UnrecoverableDataError("weekly_sales has no valid, complete weeks on or before the evaluation date.")
        cutoff = max(sales["week_start"])

    eval_week = date.fromisocalendar(*evaluation_date.isocalendar()[:2], 1)
    lag_weeks = (eval_week - cutoff).days // 7 - 1  # whole weeks between cutoff and the current week
    if lag_weeks > config.max_sales_lag_weeks:
        dq.add("run", "STALE_SALES_DATA",
               f"Latest sales week {format_iso_week(cutoff)} is {lag_weeks} complete week(s) before evaluation week "
               f"{format_iso_week(eval_week)}; demand may be out of date", SEVERITY_WARNING)

    prepared = sales[sales["week_start"] <= cutoff].sort_values(["SKU_ID", "week_start"]).reset_index(drop=True)
    LOGGER.info("Sales cutoff week %s (%d rows used)", format_iso_week(cutoff), len(prepared))
    return prepared, cutoff


def calculate_demand_metrics(sku_ids: List[str], sales: pd.DataFrame, cutoff: date, config: EngineConfig,
                             dq: DataQualityLog) -> pd.DataFrame:
    """12-week and 4-week means over observed weeks. Missing weeks are never zero-filled."""
    long_weeks = [cutoff - timedelta(weeks=k) for k in range(config.long_window_weeks)]
    short_weeks = set(long_weeks[: config.short_window_weeks])

    grid = pd.MultiIndex.from_product([sorted(sku_ids), long_weeks], names=["SKU_ID", "week_start"])
    frame = sales.set_index(["SKU_ID", "week_start"])["Units_Sold"].reindex(grid).reset_index()
    frame["in_short"] = frame["week_start"].isin(short_weeks)

    by_sku = frame.groupby("SKU_ID", sort=True)["Units_Sold"]
    short = frame[frame["in_short"]].groupby("SKU_ID", sort=True)["Units_Sold"]
    metrics = pd.DataFrame({
        "avg_12w_sales": by_sku.mean(),
        "weeks_observed_12w": by_sku.count(),
        "avg_4w_sales": short.mean(),
        "weeks_observed_4w": short.count(),
    })
    gaps = frame[frame["Units_Sold"].isna()].groupby("SKU_ID")["week_start"].apply(
        lambda s: ", ".join(format_iso_week(d) for d in sorted(s)))
    first_week = sales.groupby("SKU_ID")["week_start"].min()

    metrics["missing_weeks"] = gaps.reindex(metrics.index).fillna("")
    metrics["history_complete"] = ((metrics["weeks_observed_12w"] >= config.min_observed_weeks_long)
                                   & (metrics["weeks_observed_4w"] >= config.min_observed_weeks_short))
    window_start = long_weeks[-1]
    for sku in metrics.index[~metrics["history_complete"]]:
        observed = int(metrics.at[sku, "weeks_observed_12w"])
        starts = first_week.get(sku)
        if starts is None or starts > window_start:
            code = "INSUFFICIENT_HISTORY"
            since = f"history starts {format_iso_week(starts)}" if starts is not None else "no valid sales history"
            text = f"Only {observed} of {config.long_window_weeks} weeks in the baseline window ({since})"
        else:
            code = "MISSING_SALES_WEEKS"
            text = f"{observed} of {config.long_window_weeks} weeks observed; missing: {metrics.at[sku, 'missing_weeks']}"
        dq.add("weekly_sales", code, text, SEVERITY_ERROR, sku, disposition="SKU_BLOCKED", blocks_sku=True)

    metrics.index.name = "SKU_ID"
    return metrics.reset_index()


def apply_seasonality(df: pd.DataFrame, evaluation_date: date, config: EngineConfig) -> pd.DataFrame:
    out = df.copy()
    uplift = config.seasonal_uplift_pct if evaluation_date.month in config.festival_months else 0.0
    out["seasonal_uplift_pct"] = uplift
    out["baseline_demand"] = out["avg_12w_sales"] * (1.0 + uplift / 100.0)
    return out


def detect_demand_surges(df: pd.DataFrame, config: EngineConfig) -> pd.DataFrame:
    out = df.copy()
    avg12 = out["avg_12w_sales"]
    out["demand_ratio"] = np.where(avg12 > 0, out["avg_4w_sales"] / avg12.where(avg12 > 0), np.nan)
    ratio = out["demand_ratio"].round(config.comparison_decimals)
    out["demand_spurt_flag"] = (ratio > config.surge_ratio_threshold).fillna(False).astype(bool)
    out["reorder_multiplier"] = np.where(out["demand_spurt_flag"], config.surge_reorder_multiplier, 1.0)

    raw_qty = (out["Standard_Reorder_Qty"] * out["reorder_multiplier"]).round(config.comparison_decimals)
    if config.reorder_rounding == "ceil":
        qty = np.ceil(raw_qty)
    elif config.reorder_rounding == "floor":
        qty = np.floor(raw_qty)
    else:
        qty = np.floor(raw_qty + 0.5)
    out["effective_reorder_qty"] = qty
    return out


def calculate_stock_cover(df: pd.DataFrame) -> pd.DataFrame:
    """weeks_of_stock = Units_On_Hand / seasonally adjusted demand; undefined (NaN) when demand is 0 or unknown."""
    out = df.copy()
    demand = out["baseline_demand"]
    out["weeks_of_stock"] = np.where(demand > 0, out["Units_On_Hand"] / demand.where(demand > 0), np.nan)
    return out


def classify_inventory_risk(df: pd.DataFrame, config: EngineConfig) -> pd.DataFrame:
    """Apply the perishability bands. Bounds are inclusive in the optimal band."""
    out = df.copy()
    cover = out["weeks_of_stock"].round(config.comparison_decimals)
    low = out["Perishability"].eq("Low")
    high = out["Perishability"].eq("High")
    lo_min, lo_max = config.low_perish_stockout_weeks, config.low_perish_overstock_weeks
    hi_min, hi_max = config.high_perish_stockout_weeks, config.high_perish_overstock_weeks
    conditions = [
        low & (cover < lo_min), low & (cover > lo_max), low & (cover >= lo_min) & (cover <= lo_max),
        high & (cover < hi_min), high & (cover > hi_max), high & (cover >= hi_min) & (cover <= hi_max),
    ]
    out["Inventory_Flag"] = np.select(conditions, ["STOCKOUT_RISK", "OVERSTOCK_RISK", "OPTIMAL_LEVEL",
                                                   "STOCKOUT_RISK_HIGH", "OVERSTOCK_RISK_HIGH", "OPTIMAL_LEVEL"], default="")
    out["Rule_Action"] = np.select(conditions, [ACTION_REORDER, ACTION_PAUSE, ACTION_MAINTAIN,
                                                ACTION_REORDER, ACTION_PAUSE, ACTION_MAINTAIN], default="")
    return out


def _band_text(perishability: str, config: EngineConfig) -> str:
    if perishability == "High":
        return f"high-perishability band {config.high_perish_stockout_weeks:g}-{config.high_perish_overstock_weeks:g} weeks"
    if perishability == "Low":
        return f"low-perishability band {config.low_perish_stockout_weeks:g}-{config.low_perish_overstock_weeks:g} weeks"
    return "no valid perishability band"


def _explain(row: Dict[str, Any], config: EngineConfig, evaluation_date: date) -> str:
    parts: List[str] = []
    a12, a4, ratio = row["avg_12w_sales"], row["avg_4w_sales"], row["demand_ratio"]
    if pd.isna(a12):
        parts.append("No usable sales in the 12-week window.")
    else:
        trend = f"Demand: 4-wk avg {_fmt_num(a4)} vs 12-wk avg {_fmt_num(a12)} units/wk"
        if pd.isna(ratio):
            trend += " (ratio undefined: zero 12-week demand)."
        elif row["demand_spurt_flag"]:
            trend += (f" (ratio {ratio:.2f} > {config.surge_ratio_threshold:.2f}: {FLAG_SPURT}, "
                      f"reorder qty x{config.surge_reorder_multiplier:g}).")
        else:
            trend += f" (ratio {ratio:.2f}, no surge)."
        parts.append(trend)
        month = evaluation_date.strftime("%b")
        if row["seasonal_uplift_pct"] > 0:
            parts.append(f"Festival-month uplift +{row['seasonal_uplift_pct']:g}% ({month}) -> baseline {_fmt_num(row['baseline_demand'])} units/wk.")
        else:
            parts.append(f"No seasonal uplift ({month} is not a festival month).")

    band = _band_text(row["Perishability"], config)
    if pd.isna(row["Units_On_Hand"]):
        parts.append("Stock on hand unknown or unreliable.")
    elif pd.isna(row["weeks_of_stock"]):
        parts.append(f"{_fmt_num(row['Units_On_Hand'], 0)} units on hand; cover undefined.")
    else:
        parts.append(f"Cover: {_fmt_num(row['Units_On_Hand'], 0)} units = {row['weeks_of_stock']:.1f} weeks vs {band}.")

    action = row["Action"]
    if action == ACTION_REORDER:
        qty = int(row["Recommended_Order_Qty"])
        how = (f"{int(row['Standard_Reorder_Qty'])} x {row['reorder_multiplier']:g}, {config.reorder_rounding}"
               if row["demand_spurt_flag"] else "standard quantity")
        parts.append(f"Below minimum cover -> {ACTION_REORDER} {qty:,} units ({how}).")
    elif action == ACTION_PAUSE:
        parts.append(f"Above maximum cover -> {ACTION_PAUSE}; no order.")
    elif action == ACTION_MAINTAIN:
        parts.append(f"Within band -> {ACTION_MAINTAIN}; no order.")
    else:
        msg = f"{ACTION_REVIEW}: {row['Review_Reasons']}."
        if row["Indicative_Action"]:
            msg += f" Rules on available data would say {row['Indicative_Action']}; not actioned until a planner confirms."
        parts.append(msg)
    return " ".join(parts)


def generate_recommendations(sku_master: pd.DataFrame, inventory: pd.DataFrame, metrics: pd.DataFrame,
                             dq: DataQualityLog, evaluation_date: date, cutoff: date,
                             config: EngineConfig) -> pd.DataFrame:
    """One decision per SKU. Data-quality holds and zero demand route to MANUAL_REVIEW."""
    base = sku_master.merge(inventory, on="SKU_ID", how="left", validate="one_to_one")
    base = base.merge(metrics, on="SKU_ID", how="left", validate="one_to_one")
    base["Location_Count"] = base["Location_Count"].fillna(0).astype(int)
    base["Locations"] = base["Locations"].fillna("")

    df = apply_seasonality(base, evaluation_date, config)
    df = detect_demand_surges(df, config)
    df = calculate_stock_cover(df)
    df = classify_inventory_risk(df, config)

    blocked = df["SKU_ID"].isin(dq.blocked_skus())
    zero_demand = df["history_complete"].fillna(False).astype(bool) & (df["baseline_demand"] == 0)
    undefined_cover = df["weeks_of_stock"].isna()
    review = blocked | zero_demand | undefined_cover

    # Per-SKU data-quality status and notes (INFO entries are audit-only).
    dq_frame = dq.to_frame()
    sku_issues = dq_frame[(dq_frame["SKU_ID"] != "") & (dq_frame["Severity"] != SEVERITY_INFO)]
    notes = sku_issues.groupby("SKU_ID").apply(
        lambda g: " | ".join(f"{c}: {d}" for c, d in zip(g["Issue_Code"], g["Detail"])), include_groups=False
    ) if not sku_issues.empty else pd.Series(dtype=str)
    has_issue = df["SKU_ID"].isin(set(sku_issues["SKU_ID"]))
    df["Data_Quality_Status"] = np.where(blocked, "ERROR", np.where(has_issue, "WARNING", "OK"))
    df["Data_Quality_Notes"] = df["SKU_ID"].map(notes).fillna("")

    blocking = dq_frame.loc[dq_frame["Blocks_SKU"]].groupby("SKU_ID")["Issue_Code"].apply(
        lambda s: ", ".join(dict.fromkeys(s)))
    hold_text = "data-quality hold (" + df["SKU_ID"].map(blocking).fillna("") + ")"
    reasons = np.select(
        [blocked, zero_demand, undefined_cover],
        [hold_text,
         "zero demand in the 12-week baseline; cover undefined, check for delisting or supply interruption",
         "stock cover cannot be computed"],
        default="")
    df["Review_Reasons"] = reasons
    df["Review_Required"] = review.astype(bool)
    df["Action"] = np.where(review, ACTION_REVIEW, df["Rule_Action"])
    df["Indicative_Action"] = np.where(review, df["Rule_Action"], "")
    df["Recommended_Order_Qty"] = np.where(df["Action"] == ACTION_REORDER, df["effective_reorder_qty"], 0).astype(int)

    def flags(row: Dict[str, Any]) -> str:
        out = []
        if row["Inventory_Flag"] and not row["blocked"]:
            out.append(row["Inventory_Flag"])
        if row["demand_spurt_flag"]:
            out.append(FLAG_SPURT)
        if row["zero_demand"]:
            out.append("ZERO_DEMAND")
        if row["blocked"]:
            out.append("DATA_QUALITY_HOLD")
        return ";".join(out)

    df["blocked"], df["zero_demand"] = blocked, zero_demand
    df["Flags"] = [flags(r) for r in df[["Inventory_Flag", "demand_spurt_flag", "zero_demand", "blocked"]].to_dict("records")]
    df["Evaluation_Date"] = evaluation_date.isoformat()
    df["Inventory_As_Of_Date"] = df["as_of_max"].dt.strftime("%Y-%m-%d").fillna("")
    df["Sales_Cutoff_Week"] = format_iso_week(cutoff)
    df["Explanation"] = [_explain(r, config, evaluation_date) for r in df.to_dict("records")]

    out = df[REQUIRED_OUTPUT_COLUMNS + EXTRA_OUTPUT_COLUMNS].sort_values("SKU_ID").reset_index(drop=True)
    for col in ("weeks_observed_12w", "weeks_observed_4w"):
        out[col] = out[col].fillna(0).astype(int)
    out["effective_reorder_qty"] = out["effective_reorder_qty"].astype("Int64")
    return out


# --------------------------------------------------------------------------- #
# Financial summary
# --------------------------------------------------------------------------- #


def calculate_financial_summary(results: pd.DataFrame, sku_master: pd.DataFrame, dq: DataQualityLog,
                                config: EngineConfig) -> Dict[str, Any]:
    """Operational KPIs from the data; money only when unit costs are supplied and valid."""
    valid = results[~results["Review_Required"]]
    review = results[results["Review_Required"]]
    dq_frame = dq.to_frame()

    kpis = {
        "total_skus_in_master": int(len(results)),
        "skus_with_valid_recommendations": int(len(valid)),
        "skus_requiring_manual_review": int(len(review)),
        "stockout_risk_skus": int(valid["Flags"].str.contains("STOCKOUT_RISK").sum()),
        "overstock_risk_skus": int(valid["Flags"].str.contains("OVERSTOCK_RISK").sum()),
        "optimal_level_skus": int(valid["Flags"].str.contains("OPTIMAL_LEVEL").sum()),
        "high_demand_spurt_skus": int(results["demand_spurt_flag"].sum()),
        "immediate_reorder_skus": int((results["Action"] == ACTION_REORDER).sum()),
        "pause_order_skus": int((results["Action"] == ACTION_PAUSE).sum()),
        "total_recommended_order_units": int(results["Recommended_Order_Qty"].sum()),
        "total_recommended_order_units_definition": (
            "Sum of Recommended_Order_Qty across SKUs with an IMMEDIATE_REORDER action, in each SKU's "
            f"unit of measure ({config.expected_unit_of_measure}). A quantity, not a monetary value."),
        "recommended_order_units_by_category": {
            k: int(v) for k, v in results.groupby("Category")["Recommended_Order_Qty"].sum().sort_index().items()},
        "review_skus_with_indicative_stockout": int((review["Indicative_Action"] == ACTION_REORDER).sum()),
    }

    costs = sku_master.set_index("SKU_ID")["Unit_Cost"]
    financial: Dict[str, Any]
    if costs.notna().all() and len(costs):
        unit_cost = results["SKU_ID"].map(costs)
        inv_value = (results["Units_On_Hand"] * unit_cost)
        financial = {
            "status": "CALCULATED",
            "inventory_value_inr": round(float(inv_value.sum(skipna=True)), 2),
            "inventory_value_unknown_skus": int(inv_value.isna().sum()),
            "recommended_purchase_order_value_inr": round(float((results["Recommended_Order_Qty"] * unit_cost).sum()), 2),
            "overstock_inventory_value_inr": round(float(inv_value[results["Action"] == ACTION_PAUSE].sum()), 2),
            "note": "Valued at the Unit_Cost supplied in sku_master. Not a measure of profit, revenue, or savings.",
        }
    else:
        financial = {
            "status": "NOT_AVAILABLE",
            "inventory_value_inr": None,
            "recommended_purchase_order_value_inr": None,
            "reason": ("The four input files carry no unit cost, price, or margin for every SKU, so inventory "
                       "exposure and purchase-order value are not calculated. Add a Unit_Cost column to "
                       "sku_master to enable them."),
        }

    lo_total, hi_total = config.baseline_quarterly_total_loss_lakh
    baseline = {
        "label": "Business baseline reported in the Freshroots case study (company-wide, not attributed to flagged SKUs)",
        "quarterly_stockout_loss_inr_lakh": list(config.baseline_quarterly_stockout_loss_lakh),
        "quarterly_overstock_writeoff_inr_lakh": list(config.baseline_quarterly_overstock_loss_lakh),
        "quarterly_total_planning_loss_inr_lakh": list(config.baseline_quarterly_total_loss_lakh),
    }
    scenarios = [{
        "reduction_pct": pct,
        "quarterly_loss_reduction_inr_lakh": [round(lo_total * pct / 100, 2), round(hi_total * pct / 100, 2)],
        "annualised_inr_lakh": [round(lo_total * pct / 100 * 4, 2), round(hi_total * pct / 100 * 4, 2)],
    } for pct in config.prevention_scenarios_pct]

    sev = dq_frame["Severity"].value_counts()
    data_quality = {
        "issues_total": int(len(dq_frame)),
        "errors": int(sev.get(SEVERITY_ERROR, 0)),
        "warnings": int(sev.get(SEVERITY_WARNING, 0)),
        "info": int(sev.get(SEVERITY_INFO, 0)),
        "skus_blocked": int((results["Data_Quality_Status"] == "ERROR").sum()),
        "records_quarantined": int((dq_frame["Disposition"] == "QUARANTINED").sum()),
        "issues_by_code": {k: int(v) for k, v in dq_frame["Issue_Code"].value_counts().sort_index().items()},
        "global_issues": [r["Detail"] for r in dq.global_issues()],
    }
    return {
        "operational_kpis": kpis,
        "financial_estimates": financial,
        "business_baseline_reported": baseline,
        "illustrative_prevention_scenarios": {
            "label": "Illustrative scenarios against the reported baseline. Not forecasts and not realised savings.",
            "scenarios": scenarios,
        },
        "data_quality": data_quality,
    }


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #

RULE = "=" * 80
THIN = "-" * 80


def _overall_dq_status(summary: Dict[str, Any]) -> str:
    dq = summary["data_quality"]
    if dq["skus_blocked"]:
        return f"ISSUES - {dq['skus_blocked']} SKU(s) held for review, {dq['errors']} error(s), {dq['warnings']} warning(s)"
    if dq["warnings"] or dq["errors"]:
        return f"WARNINGS - {dq['errors']} error(s), {dq['warnings']} warning(s); no SKU blocked"
    return "OK"


def _table(results: pd.DataFrame, markdown: bool) -> List[str]:
    view = pd.DataFrame({
        "SKU_ID": results["SKU_ID"],
        "SKU_Name": results["SKU_Name"],
        "Category": results["Category"],
        "Perishability": results["Perishability"],
        "Units_On_Hand": results["Units_On_Hand"].map(lambda v: _fmt_num(v, 0)),
        "Weeks_Of_Stock": results["weeks_of_stock"].map(lambda v: _fmt_num(v, 1)),
        "Flags": results["Flags"].replace("", "-"),
        "Action": results["Action"],
        "Recommended_Order_Qty": results["Recommended_Order_Qty"].map(lambda v: f"{v:,}"),
    })
    numeric = {"Units_On_Hand", "Weeks_Of_Stock", "Recommended_Order_Qty"}
    if markdown:
        lines = ["| " + " | ".join(view.columns) + " |",
                 "|" + "|".join("---:" if c in numeric else "---" for c in view.columns) + "|"]
        lines += ["| " + " | ".join(str(v) for v in row) + " |" for row in view.itertuples(index=False)]
        return lines
    widths = {c: max(len(c), view[c].astype(str).str.len().max()) for c in view.columns}
    fmt = lambda c, v: str(v).rjust(widths[c]) if c in numeric else str(v).ljust(widths[c])
    lines = ["  ".join(fmt(c, c) for c in view.columns)]
    lines.append("  ".join("-" * widths[c] for c in view.columns))
    lines += ["  ".join(fmt(c, v) for c, v in zip(view.columns, row)) for row in view.itertuples(index=False)]
    return lines


def format_executive_report(results: pd.DataFrame, summary: Dict[str, Any], run_info: Dict[str, Any],
                            markdown: bool = False) -> str:
    k, fin = summary["operational_kpis"], summary["financial_estimates"]
    base = summary["business_baseline_reported"]
    dq = summary["data_quality"]
    snap = run_info["inventory_snapshot_dates"]
    snap_text = snap[0] if len(snap) == 1 else (f"{snap[0]} to {snap[-1]} (mixed)" if snap else "n/a")

    if fin["status"] == "CALCULATED":
        exposure = f"INR {fin['inventory_value_inr']:,.0f} inventory at cost; PO value INR {fin['recommended_purchase_order_value_inr']:,.0f}"
        impact = "Not estimated per SKU (no margin or lost-sales data)"
    else:
        exposure = "Not available - no unit cost in inputs"
        impact = "Not calculated from inputs (see business baseline and scenarios below)"
    lo, hi = base["quarterly_total_planning_loss_inr_lakh"]
    scen = "; ".join(f"{s['reduction_pct']:g}% -> INR {s['quarterly_loss_reduction_inr_lakh'][0]:g}-{s['quarterly_loss_reduction_inr_lakh'][1]:g} lakh/qtr"
                     for s in summary["illustrative_prevention_scenarios"]["scenarios"])

    summary_items = [
        ("Total SKUs in master", k["total_skus_in_master"]),
        ("SKUs with valid recommendations", k["skus_with_valid_recommendations"]),
        ("SKUs requiring manual review", k["skus_requiring_manual_review"]),
        ("Stockout-risk SKUs", k["stockout_risk_skus"]),
        ("Overstock-risk SKUs", k["overstock_risk_skus"]),
        ("High-demand-spurt SKUs", k["high_demand_spurt_skus"]),
        ("SKUs recommended for immediate reorder", k["immediate_reorder_skus"]),
        ("Total recommended order quantity", f"{k['total_recommended_order_units']:,} units (sum of IMMEDIATE_REORDER quantities)"),
        ("Estimated inventory exposure", exposure),
        ("Estimated financial impact", impact),
        ("Data-quality exceptions", f"{dq['issues_total']} ({dq['errors']} errors, {dq['warnings']} warnings, {dq['info']} info)"),
    ]

    header = [
        ("Evaluation Date", run_info["evaluation_date"]),
        ("Inventory Snapshot", snap_text),
        ("Sales Cutoff Week", run_info["sales_cutoff_week"]),
        ("SKUs Evaluated", k["total_skus_in_master"]),
        ("Data Quality", _overall_dq_status(summary)),
    ]
    cal = run_info.get("calendar", {})
    if "evaluation_month_calendar_festival" in cal:
        agrees = cal["evaluation_month_calendar_festival"] == cal["evaluation_month_rule_festival"]
        header.append(("Calendar Check", f"{cal['evaluation_month']} festival month = "
                       f"{cal['evaluation_month_calendar_festival']} ({'agrees with' if agrees else 'DIFFERS from'} the rule)"))
    festivals = cal.get("festivals_recent_and_next_4_weeks")
    if festivals:
        header.append(("Calendar Festivals (recent/next 4 wks)", "; ".join(f"{w} {n}" for w, n in festivals.items())))

    attention = results[results["Action"].isin([ACTION_REORDER, ACTION_REVIEW, ACTION_PAUSE]) | results["demand_spurt_flag"]]

    if markdown:
        lines = ["# Freshroots Demand Planning Engine", ""]
        lines += [f"- **{a}:** {b}" for a, b in header] + ["", "## SKU decisions", ""] + _table(results, True)
        lines += ["", "## Executive summary", "", "| Metric | Value |", "|---|---|"]
        lines += [f"| {a} | {b} |" for a, b in summary_items]
        lines += ["", "## Business baseline (case study, company-wide)", "",
                  f"Reported quarterly planning losses: INR {lo:g}-{hi:g} lakh "
                  f"(stockouts {base['quarterly_stockout_loss_inr_lakh'][0]:g}-{base['quarterly_stockout_loss_inr_lakh'][1]:g}, "
                  f"overstock {base['quarterly_overstock_writeoff_inr_lakh'][0]:g}-{base['quarterly_overstock_writeoff_inr_lakh'][1]:g}). "
                  "Not attributed to the SKUs above.", "",
                  f"Illustrative scenarios (not forecasts): {scen}.", "", "## Why", ""]
        lines += [f"- **{r['SKU_ID']}** ({r['Action']}): {r['Explanation']}" for r in attention.to_dict("records")]
        if dq["global_issues"]:
            lines += ["", "## Run-level warnings", ""] + [f"- {g}" for g in dq["global_issues"]]
        lines += ["", "_Rule-based recommendations for planner approval. No purchase orders are sent. "
                      "Supplier pack sizes, MOQs, lead times and safety stock are not modelled._"]
        return "\n".join(lines) + "\n"

    title = "FRESHROOTS DEMAND PLANNING ENGINE"
    lines = [RULE, title.center(80).rstrip(), RULE]
    lines += [f"{a}: {b}" for a, b in header]
    lines += [THIN, ""] + _table(results, False) + ["", THIN, "EXECUTIVE SUMMARY", ""]
    lines += [f"- {a}: {b}" for a, b in summary_items]
    lines += ["", "BUSINESS BASELINE (case study, company-wide; not attributed to the SKUs above)",
              f"- Reported quarterly planning losses: INR {lo:g}-{hi:g} lakh",
              f"- Illustrative scenarios (not forecasts): {scen}", "", THIN, "WHY (reorder, pause, review, or surge)", ""]
    for r in attention.to_dict("records"):
        lines += textwrap.wrap(f"{r['SKU_ID']} [{r['Action']}] {r['Explanation']}", 80, subsequent_indent="    ")
    if dq["global_issues"]:
        lines += ["", "RUN-LEVEL WARNINGS"] + [f"- {g}" for g in dq["global_issues"]]
    lines += ["", "Rule-based recommendations for planner approval. No purchase orders are sent.", RULE]
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


@dataclass
class EngineResult:
    recommendations: pd.DataFrame
    data_quality: pd.DataFrame
    summary: Dict[str, Any]
    report: str
    output_files: Dict[str, str] = field(default_factory=dict)


def _resolve_evaluation_date(value: Union[None, str, date, datetime]) -> date:
    if value is None:
        return date.today()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except ValueError as exc:
        raise ConfigurationError(f"evaluation_date must be YYYY-MM-DD, got {value!r}") from exc


def _display_frame(results: pd.DataFrame) -> pd.DataFrame:
    out = results.copy()
    for col in ("avg_12w_sales", "avg_4w_sales", "baseline_demand", "demand_ratio", "weeks_of_stock"):
        out[col] = out[col].round(4)
    return out


def run_freshroots_demand_engine(
    sku_master_path: PathLike = "data/sku_master.csv",
    inventory_path: PathLike = "data/current_inventory.csv",
    sales_path: PathLike = "data/weekly_sales.csv",
    calendar_path: Optional[PathLike] = "data/calendar.csv",
    distributor_path: Optional[PathLike] = "data/distributor_master.csv",
    evaluation_date: Union[None, str, date, datetime] = None,
    config: Union[None, EngineConfig, Dict[str, Any], PathLike] = None,
    output_dir: Optional[PathLike] = "output",
    print_report: bool = True,
) -> EngineResult:
    """Run the full pipeline and return results programmatically.

    Relative paths resolve against the current working directory. Set
    output_dir=None to skip writing files.
    """
    if config is None:
        cfg = EngineConfig()
    elif isinstance(config, EngineConfig):
        cfg = config
    elif isinstance(config, dict):
        cfg = EngineConfig.from_dict(config)
    else:
        cfg = EngineConfig.from_json(config)

    eval_date = _resolve_evaluation_date(evaluation_date)
    paths = InputPaths(
        Path(sku_master_path), Path(inventory_path), Path(sales_path),
        Path(calendar_path) if calendar_path else None,
        Path(distributor_path) if distributor_path else None,
    )
    LOGGER.info("Freshroots engine %s, evaluation date %s", ENGINE_VERSION, eval_date)

    raw = load_input_files(paths)
    validated = validate_input_data(raw, eval_date, cfg)
    dq = validated.dq
    sales, cutoff = prepare_weekly_sales(validated.sales, eval_date, cfg, dq)
    metrics = calculate_demand_metrics(list(validated.sku_master["SKU_ID"]), sales, cutoff, cfg, dq)
    results = generate_recommendations(validated.sku_master, validated.inventory, metrics, dq, eval_date, cutoff, cfg)
    summary = calculate_financial_summary(results, validated.sku_master, dq, cfg)

    snapshot_dates = sorted(validated.inventory_rows["as_of"].dt.strftime("%Y-%m-%d").unique().tolist())
    run_info = {
        "engine_version": ENGINE_VERSION,
        "evaluation_date": eval_date.isoformat(),
        "sales_cutoff_week": format_iso_week(cutoff),
        "inventory_snapshot_dates": snapshot_dates,
        "inventory_aggregation_policy": cfg.inventory_aggregation,
        "calendar": {k: v for k, v in validated.calendar_info.items() if k not in ("weeks", "months")},
        "input_files": {
            name: {"path": str(p), "sha256": _file_sha256(p)} for name, p in paths.items() if p is not None and p.is_file()
        },
        "config": cfg.to_dict(),
    }
    if (validated.calendar_info.get("weeks") and validated.calendar_info.get("festival_column")
            and not validated.calendar_info.get("festival_is_flag")):
        fest_col = validated.calendar_info["festival_column"]
        window = [cutoff - timedelta(weeks=k) for k in range(cfg.short_window_weeks)] + \
                 [date.fromisocalendar(*eval_date.isocalendar()[:2], 1) + timedelta(weeks=k) for k in range(0, 5)]
        upcoming = {format_iso_week(w): validated.calendar_info["weeks"][w][fest_col]
                    for w in sorted(set(window)) if w in validated.calendar_info["weeks"]
                    and str(validated.calendar_info["weeks"][w].get(fest_col, "")).strip() not in ("", "None", "nan", "-", "0", "No")}
        run_info["calendar"]["festivals_recent_and_next_4_weeks"] = upcoming
    summary = {"run": run_info, **summary}

    report = format_executive_report(results, summary, run_info)
    result = EngineResult(results, dq.to_frame(), summary, report)

    if output_dir is not None:
        result.output_files = _write_outputs(result, Path(output_dir), paths)
    if print_report:
        print(report)
    LOGGER.info("Run complete: %d SKUs, %d reorder, %d review",
                len(results), summary["operational_kpis"]["immediate_reorder_skus"],
                summary["operational_kpis"]["skus_requiring_manual_review"])
    return result


def _write_outputs(result: EngineResult, out_dir: Path, paths: InputPaths) -> Dict[str, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    targets = {
        "recommendations": out_dir / "reorder_recommendations.csv",
        "data_quality": out_dir / "data_quality_report.csv",
        "summary": out_dir / "executive_summary.json",
        "report_txt": out_dir / "executive_report.txt",
        "report_md": out_dir / "executive_report.md",
    }
    inputs = {p.resolve() for _, p in paths.items() if p is not None and p.exists()}
    clash = [str(t) for t in targets.values() if t.resolve() in inputs]
    if clash:
        raise ConfigurationError(f"Refusing to overwrite input file(s): {clash}")

    _display_frame(result.recommendations).to_csv(targets["recommendations"], index=False)
    result.data_quality.to_csv(targets["data_quality"], index=False)
    with targets["summary"].open("w", encoding="utf-8") as fh:
        json.dump(result.summary, fh, indent=2, sort_keys=False, default=str)
        fh.write("\n")
    targets["report_txt"].write_text(result.report, encoding="utf-8")
    targets["report_md"].write_text(
        format_executive_report(result.recommendations, result.summary, result.summary["run"], markdown=True),
        encoding="utf-8")
    LOGGER.info("Wrote outputs to %s", out_dir)
    return {k: str(v) for k, v in targets.items()}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Freshroots demand planning & reorder engine")
    parser.add_argument("--sku-master", default="data/sku_master.csv")
    parser.add_argument("--inventory", default="data/current_inventory.csv")
    parser.add_argument("--sales", default="data/weekly_sales.csv")
    parser.add_argument("--calendar", default="data/calendar.csv")
    parser.add_argument("--distributors", default="data/distributor_master.csv")
    parser.add_argument("--evaluation-date", help="YYYY-MM-DD; defaults to today")
    parser.add_argument("--config", help="JSON config file (see config.example.json)")
    parser.add_argument("--output-dir", default="output")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    args = parser.parse_args(argv)

    logging.basicConfig(level=args.log_level, stream=sys.stderr,
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        run_freshroots_demand_engine(
            args.sku_master, args.inventory, args.sales, args.calendar or None, args.distributors or None,
            args.evaluation_date, args.config, args.output_dir, print_report=True)
    except FreshrootsError as exc:
        LOGGER.error("%s: %s", type(exc).__name__, exc)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
