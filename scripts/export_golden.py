#!/usr/bin/env python3
"""Export the Python engine's results as golden JSON for the TypeScript parity test.

Usage: .venv/bin/python scripts/export_golden.py
Writes web/tests/golden/<case>.json for each dataset below.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import freshroots_engine as fe  # noqa: E402

CASES = {
    "real": (ROOT / "data", "2026-10-22"),
    "sample": (ROOT / "sample_data", "2026-10-22"),
    "messy": (ROOT / "web" / "tests" / "fixtures" / "messy", "2026-07-15"),
}


def clean(value):
    if isinstance(value, float) and math.isnan(value):
        return None
    if hasattr(value, "item"):  # numpy scalar
        return clean(value.item())
    return value


def main() -> None:
    out_dir = ROOT / "web" / "tests" / "golden"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, (folder, eval_date) in CASES.items():
        result = fe.run_freshroots_demand_engine(
            folder / "sku_master.csv", folder / "current_inventory.csv", folder / "weekly_sales.csv",
            folder / "calendar.csv", folder / "distributor_master.csv",
            evaluation_date=eval_date, output_dir=None, print_report=False)
        recs = [{k: clean(v) for k, v in row.items()} for row in result.recommendations.to_dict("records")]
        dq = [{k: clean(v) for k, v in row.items()} for row in result.data_quality.astype(object).to_dict("records")]
        for d in dq:
            if d["Row_Number"] is not None and not isinstance(d["Row_Number"], int):
                d["Row_Number"] = None if str(d["Row_Number"]) == "<NA>" else int(d["Row_Number"])
        golden = {
            "evaluation_date": eval_date,
            "sales_cutoff_week": result.summary["run"]["sales_cutoff_week"],
            "inventory_snapshot_dates": result.summary["run"]["inventory_snapshot_dates"],
            "recommendations": recs,
            "data_quality": dq,
            "operational_kpis": result.summary["operational_kpis"],
            "data_quality_summary": result.summary["data_quality"],
            "scenarios": result.summary["illustrative_prevention_scenarios"]["scenarios"],
        }
        path = out_dir / f"{name}.json"
        path.write_text(json.dumps(golden, indent=1, default=str) + "\n")
        print(f"{name}: {len(recs)} SKUs, {len(dq)} DQ records -> {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
