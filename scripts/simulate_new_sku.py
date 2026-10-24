#!/usr/bin/env python3
"""Database simulation exercise, on the CSV tables.

Simulates a new SKU with no history without adding a new SKU:
  1. delete all of SKU009's rows from weekly_sales
  2. add a new distributor to distributor_master
  3. remap SKU009 to that distributor in sku_master
then reruns the engine and compares the new recommendation with the original.

Usage: .venv/bin/python scripts/simulate_new_sku.py [SKU] [NEW_DISTRIBUTOR_ID]
Writes the changed tables to data_scenarios/<sku>_new_launch/ (the originals in data/ are untouched).
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import freshroots_engine as fe  # noqa: E402

EVAL_DATE = "2026-10-22"


def run(folder: Path) -> pd.DataFrame:
    return fe.run_freshroots_demand_engine(
        folder / "sku_master.csv", folder / "current_inventory.csv", folder / "weekly_sales.csv",
        folder / "calendar.csv", folder / "distributor_master.csv",
        evaluation_date=EVAL_DATE, output_dir=None, print_report=False,
    ).recommendations.set_index("SKU_ID")


def main() -> None:
    sku = (sys.argv[1] if len(sys.argv) > 1 else "SKU009").upper()
    new_id = (sys.argv[2] if len(sys.argv) > 2 else "DIST005").upper()
    src = ROOT / "data"
    dst = ROOT / "data_scenarios" / f"{sku.lower()}_new_launch"
    dst.mkdir(parents=True, exist_ok=True)
    for f in ("sku_master.csv", "current_inventory.csv", "weekly_sales.csv", "calendar.csv", "distributor_master.csv"):
        shutil.copy(src / f, dst / f)

    sales = pd.read_csv(dst / "weekly_sales.csv", dtype=str, keep_default_na=False)
    before_rows = len(sales)
    sales = sales[sales["SKU_ID"].str.strip().str.upper() != sku]
    sales.to_csv(dst / "weekly_sales.csv", index=False)
    print(f"DELETE FROM weekly_sales WHERE sku_id = '{sku}';  -- {before_rows - len(sales)} rows")

    dist = pd.read_csv(dst / "distributor_master.csv", dtype=str, keep_default_na=False)
    if new_id in set(dist["Distributor_ID"]):
        raise SystemExit(f"{new_id} already exists")
    dist.loc[len(dist)] = {"Distributor_ID": new_id, "Distributor_Name": "Konkan Fresh Supply", "Region": "Goa", "Status": "Active"}
    dist.to_csv(dst / "distributor_master.csv", index=False)
    print(f"INSERT INTO distributor_master VALUES ('{new_id}', 'Konkan Fresh Supply', 'Goa', 'Active');")

    master = pd.read_csv(dst / "sku_master.csv", dtype=str, keep_default_na=False)
    was = master.loc[master["SKU_ID"] == sku, "Distributor_ID"].iloc[0]
    master.loc[master["SKU_ID"] == sku, "Distributor_ID"] = new_id
    master.to_csv(dst / "sku_master.csv", index=False)
    print(f"UPDATE sku_master SET distributor_id = '{new_id}' WHERE sku_id = '{sku}';  -- was {was}\n")

    before, after = run(src), run(dst)
    cols = ["Action", "Recommended_Order_Qty", "weeks_observed_12w", "Distributor_ID", "Data_Quality_Status"]
    changed = [s for s in before.index if not before.loc[s, cols].equals(after.loc[s, cols])]
    print(f"{'SKU':<8}{'':<2}{'Action':<18}{'Qty':>5}{'Hist':>6}  {'Distributor':<12}DQ")
    for s in changed:
        for tag, df in (("before", before), ("after", after)):
            r = df.loc[s]
            print(f"{s:<8}{tag[0]:<2}{r['Action']:<18}{int(r['Recommended_Order_Qty']):>5}{int(r['weeks_observed_12w']):>6}  {r['Distributor_ID']:<12}{r['Data_Quality_Status']}")
    print(f"\n{len(changed)} SKU changed; the other {len(before) - len(changed)} kept the same decision.")
    print(f"After: {after.loc[sku, 'Review_Reasons']}")
    print(f"Notes: {after.loc[sku, 'Data_Quality_Notes']}")
    print(f"\nScenario tables written to {dst.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
