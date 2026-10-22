# Freshroots Demand Planning Engine

- **Evaluation Date:** 2026-10-22
- **Inventory Snapshot:** 2026-10-20
- **Sales Cutoff Week:** 2026-W42
- **SKUs Evaluated:** 11
- **Data Quality:** ISSUES - 2 SKU(s) held for review, 3 error(s), 0 warning(s)
- **Calendar Festivals (recent/next 4 wks):** 2026-W43 Diwali build-up; 2026-W45 Diwali

## SKU decisions

| SKU_ID | SKU_Name | Category | Perishability | Units_On_Hand | Weeks_Of_Stock | Flags | Action | Recommended_Order_Qty |
|---|---|---|---|---:|---:|---|---|---:|
| FR-BEV-001 | Kokum Sherbet 750ml | Beverage | Low | 450 | 3.6 | STOCKOUT_RISK | IMMEDIATE_REORDER | 600 |
| FR-BEV-002 | Aam Panna 1L | Beverage | Low | 2,400 | 19.2 | OVERSTOCK_RISK;HIGH_DEMAND_SPURT | PAUSE_ORDER | 0 |
| FR-BEV-003 | Solkadhi 500ml | Beverage | High | n/a | n/a | DATA_QUALITY_HOLD | MANUAL_REVIEW | 0 |
| FR-DAL-001 | Oat Milk 1L | Dairy Alt | High | 150 | 1.5 | STOCKOUT_RISK_HIGH | IMMEDIATE_REORDER | 250 |
| FR-DAL-002 | Almond Curd 400g | Dairy Alt | High | 400 | 6.4 | OVERSTOCK_RISK_HIGH | PAUSE_ORDER | 0 |
| FR-DAL-003 | Soy Paneer 200g | Dairy Alt | High | 175 | 3.5 | OPTIMAL_LEVEL | MAINTAIN | 0 |
| FR-SNK-001 | Bhakarwadi 200g | Snack | Low | 650 | 8.7 | OPTIMAL_LEVEL | MAINTAIN | 0 |
| FR-SNK-002 | Banana Chips 150g | Snack | Low | 120 | 1.9 | STOCKOUT_RISK;HIGH_DEMAND_SPURT | IMMEDIATE_REORDER | 500 |
| FR-SNK-003 | Millet Puffs 80g | Snack | Low | 90 | 1.6 | DATA_QUALITY_HOLD | MANUAL_REVIEW | 0 |
| FR-STP-001 | Kolhapuri Masala 100g | Staple | Low | 600 | 16.0 | OVERSTOCK_RISK | PAUSE_ORDER | 0 |
| FR-STP-002 | Kala Masala 50g | Staple | Low | 300 | n/a | ZERO_DEMAND | MANUAL_REVIEW | 0 |

## Executive summary

| Metric | Value |
|---|---|
| Total SKUs in master | 11 |
| SKUs with valid recommendations | 8 |
| SKUs requiring manual review | 3 |
| Stockout-risk SKUs | 3 |
| Overstock-risk SKUs | 3 |
| High-demand-spurt SKUs | 2 |
| SKUs recommended for immediate reorder | 3 |
| Total recommended order quantity | 1,350 units (sum of IMMEDIATE_REORDER quantities) |
| Estimated inventory exposure | Not available - no unit cost in inputs |
| Estimated financial impact | Not calculated from inputs (see business baseline and scenarios below) |
| Data-quality exceptions | 4 (3 errors, 0 warnings, 1 info) |

## Business baseline (case study, company-wide)

Reported quarterly planning losses: INR 28-34 lakh (stockouts 18-22, overstock 10-12). Not attributed to the SKUs above.

Illustrative scenarios (not forecasts): 10% -> INR 2.8-3.4 lakh/qtr; 20% -> INR 5.6-6.8 lakh/qtr; 30% -> INR 8.4-10.2 lakh/qtr.

## Why

- **FR-BEV-001** (IMMEDIATE_REORDER): Demand: 4-wk avg 100.0 vs 12-wk avg 100.0 units/wk (ratio 1.00, no surge). Festival-month uplift +25% (Oct) -> baseline 125.0 units/wk. Cover: 450 units = 3.6 weeks vs low-perishability band 6-14 weeks. Below minimum cover -> IMMEDIATE_REORDER 600 units (standard quantity).
- **FR-BEV-002** (PAUSE_ORDER): Demand: 4-wk avg 140.0 vs 12-wk avg 100.0 units/wk (ratio 1.40 > 1.20: HIGH_DEMAND_SPURT, reorder qty x1.5). Festival-month uplift +25% (Oct) -> baseline 125.0 units/wk. Cover: 2,400 units = 19.2 weeks vs low-perishability band 6-14 weeks. Above maximum cover -> PAUSE_ORDER; no order.
- **FR-BEV-003** (MANUAL_REVIEW): Demand: 4-wk avg 90.0 vs 12-wk avg 90.0 units/wk (ratio 1.00, no surge). Festival-month uplift +25% (Oct) -> baseline 112.5 units/wk. Stock on hand unknown or unreliable. MANUAL_REVIEW: data-quality hold (MISSING_INVENTORY_VALUE).
- **FR-DAL-001** (IMMEDIATE_REORDER): Demand: 4-wk avg 80.0 vs 12-wk avg 80.0 units/wk (ratio 1.00, no surge). Festival-month uplift +25% (Oct) -> baseline 100.0 units/wk. Cover: 150 units = 1.5 weeks vs high-perishability band 3-4 weeks. Below minimum cover -> IMMEDIATE_REORDER 250 units (standard quantity).
- **FR-DAL-002** (PAUSE_ORDER): Demand: 4-wk avg 50.0 vs 12-wk avg 50.0 units/wk (ratio 1.00, no surge). Festival-month uplift +25% (Oct) -> baseline 62.5 units/wk. Cover: 400 units = 6.4 weeks vs high-perishability band 3-4 weeks. Above maximum cover -> PAUSE_ORDER; no order.
- **FR-SNK-002** (IMMEDIATE_REORDER): Demand: 4-wk avg 70.0 vs 12-wk avg 50.0 units/wk (ratio 1.40 > 1.20: HIGH_DEMAND_SPURT, reorder qty x1.5). Festival-month uplift +25% (Oct) -> baseline 62.5 units/wk. Cover: 120 units = 1.9 weeks vs low-perishability band 6-14 weeks. Below minimum cover -> IMMEDIATE_REORDER 500 units (333 x 1.5, ceil).
- **FR-SNK-003** (MANUAL_REVIEW): Demand: 4-wk avg 45.0 vs 12-wk avg 45.0 units/wk (ratio 1.00, no surge). Festival-month uplift +25% (Oct) -> baseline 56.2 units/wk. Cover: 90 units = 1.6 weeks vs low-perishability band 6-14 weeks. MANUAL_REVIEW: data-quality hold (INSUFFICIENT_HISTORY). Rules on available data would say IMMEDIATE_REORDER; not actioned until a planner confirms.
- **FR-STP-001** (PAUSE_ORDER): Demand: 4-wk avg 30.0 vs 12-wk avg 30.0 units/wk (ratio 1.00, no surge). Festival-month uplift +25% (Oct) -> baseline 37.5 units/wk. Cover: 600 units = 16.0 weeks vs low-perishability band 6-14 weeks. Above maximum cover -> PAUSE_ORDER; no order.
- **FR-STP-002** (MANUAL_REVIEW): Demand: 4-wk avg 0.0 vs 12-wk avg 0.0 units/wk (ratio undefined: zero 12-week demand). Festival-month uplift +25% (Oct) -> baseline 0.0 units/wk. 300 units on hand; cover undefined. MANUAL_REVIEW: zero demand in the 12-week baseline; cover undefined, check for delisting or supply interruption.

_Rule-based recommendations for planner approval. No purchase orders are sent. Supplier pack sizes, MOQs, lead times and safety stock are not modelled._
