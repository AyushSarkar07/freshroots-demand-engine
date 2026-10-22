#!/usr/bin/env python3
"""Write a small, deterministic synthetic dataset to sample_data/.

Each SKU is built to exercise one rule or data-quality path. Evaluation date
for the demo is 2026-10-22, so the latest complete week is 2026-W42 and the
October festival uplift applies.
"""
from __future__ import annotations

import csv
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent / "sample_data"
CUTOFF = date.fromisocalendar(2026, 42, 1)
WEEKS = [CUTOFF - timedelta(weeks=k) for k in range(11, -1, -1)]  # oldest -> newest


def week_id(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def flat(level: int) -> list:
    return [level] * 12


def surge(base: int, recent: int) -> list:
    return [base] * 8 + [recent] * 4


SKUS = [
    # id, name, category, perishability, std qty, uom, distributor, weekly sales, inventory rows
    ("FR-BEV-001", "Kokum Sherbet 750ml", "Beverage", "Low", 600, "Units", "D01", flat(100), [("Pune DC", 450)]),
    ("FR-BEV-002", "Aam Panna 1L", "Beverage", "Low", 500, "Units", "D01", surge(80, 140), [("Pune DC", 2400)]),
    ("FR-SNK-001", "Bhakarwadi 200g", "Snack", "Low", 400, "Units", "D02", flat(60), [("Pune DC", 500), ("Goa DC", 150)]),
    ("FR-SNK-002", "Banana Chips 150g", "Snack", "Low", 333, "Units", "D02", surge(40, 70), [("Mumbai DC", 120)]),
    ("FR-STP-001", "Kolhapuri Masala 100g", "Staple", "Low", 300, "Units", "D03", flat(30), [("Pune DC", 600)]),
    ("FR-DAL-001", "Oat Milk 1L", "Dairy Alt", "High", 250, "Units", "D04", flat(80), [("Mumbai DC", 150)]),
    ("FR-DAL-002", "Almond Curd 400g", "Dairy Alt", "High", 200, "Units", "D04", flat(50), [("Mumbai DC", 400)]),
    ("FR-DAL-003", "Soy Paneer 200g", "Dairy Alt", "High", 150, "Units", "D04", flat(40), [("Mumbai DC", 175)]),
    ("FR-SNK-003", "Millet Puffs 80g", "Snack", "Low", 250, "Units", "D02", [None] * 7 + [45] * 5, [("Pune DC", 90)]),
    ("FR-STP-002", "Kala Masala 50g", "Staple", "Low", 200, "Units", "D03", flat(0), [("Pune DC", 300)]),
    ("FR-BEV-003", "Solkadhi 500ml", "Beverage", "High", 300, "Units", "D01", flat(90), [("Goa DC", "")]),
]


def main() -> None:
    OUT.mkdir(exist_ok=True)
    with (OUT / "sku_master.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID"])
        for s in SKUS:
            w.writerow(s[:7])

    with (OUT / "weekly_sales.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["SKU_ID", "Week", "Units_Sold"])
        for s in SKUS:
            for wk, units in zip(WEEKS, s[7]):
                if units is not None:
                    w.writerow([s[0], week_id(wk), units])
        w.writerow(["FR-XXX-999", week_id(CUTOFF), 10])  # unknown SKU -> quarantined

    with (OUT / "current_inventory.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"])
        for s in SKUS:
            for loc, units in s[8]:
                w.writerow([s[0], loc, units, "2026-10-20"])

    with (OUT / "distributor_master.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Distributor_ID", "Distributor_Name", "Region"])
        w.writerows([["D01", "Konkan Traders", "Mumbai"], ["D02", "Deccan Foods", "Pune"],
                     ["D03", "Sahyadri Distributors", "Kolhapur"], ["D04", "Coastal Cold Chain", "Goa"]])

    festivals = {date(2026, 10, 19): "Diwali build-up", date(2026, 11, 2): "Diwali", date(2026, 8, 24): "Ganesh Chaturthi"}
    with (OUT / "calendar.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["Week", "Month", "Festival"])
        for k in range(-20, 10):
            wk = CUTOFF + timedelta(weeks=k)
            w.writerow([week_id(wk), wk.strftime("%b"), festivals.get(wk, "")])
    print(f"Wrote synthetic data to {OUT}")


if __name__ == "__main__":
    main()
