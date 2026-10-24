#!/usr/bin/env python3
"""Draw the Reorder Desk components map (Actor x Trigger/Input/Context/Processing/AI/Output).

Writes deliverables/components_map.svg and .html; render a PNG with headless Chrome:
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
    --screenshot=deliverables/components_map.png --window-size=2000,1225 deliverables/components_map.html
"""
from __future__ import annotations

import textwrap
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "deliverables"

W, TITLE_H, HEAD_Y, HEAD_H = 2000, 95, 95, 70
ACTOR_X, ACTOR_W = 24, 234
COLS = ["Trigger", "Input", "Context", "Processing", "AI", "Output"]
COL_W = (W - 24 - (ACTOR_X + ACTOR_W)) / len(COLS)
ROW_H = 148
BOX_W, BOX_H = 244, 110
NAVY = "#1f2a44"
RED = "#c62828"  # red alerts: critical issues escalated to people the same day
LEGEND_H = 46

ROWS = [  # name, subtitle, lane tint, box fill, box stroke
    ("Data Analyst", "(Priya, SAP export)", "#eef0fd", "#e3e5fb", "#5b5fd6"),
    ("System", "(Reorder Desk on Vercel)", "#fff8e6", "#fff0c2", "#d9a300"),
    ("AI Model", "(Gemini Flash)", "#e9f8ef", "#d7f3e1", "#2fa35a"),
    ("Services", "(Neon, Slack/Telegram, Zoho)", "#fdecf2", "#fbdbe8", "#d6467e"),
    ("Procurement", "(PO approver)", "#fff0ea", "#ffe0d4", "#ec7a4a"),
    ("Planner", "(Raghav)", "#ebf2fd", "#dde9fb", "#4a7fd6"),
    ("Head of Ops", "(Deepa, monthly review)", "#f3effc", "#e7e0f8", "#7a5bd6"),
]
R = {name: i for i, (name, *_rest) in enumerate(ROWS)}
C = {name: i for i, name in enumerate(COLS)}

BOXES = {  # (row, col): text, at most four lines
    ("Data Analyst", "Trigger"): "Monday and Thursday: IT's SAP export is ready",
    ("Data Analyst", "Input"): "Uploads 5 CSVs: SKUs, stock, weekly sales, calendar, distributors",
    ("System", "Context"): "Rules config, festival calendar, distributors, previous run to compare",
    ("System", "Processing"): "Validates every row, applies the rules: one decision per SKU. Flags conflicts, drift, red alerts",
    ("System", "Output"): "Needs-attention banner, number-guarded brief, scenario comparison; all logged",
    ("AI Model", "AI"): "Drafts the planner brief; answers rulebook questions with citations. Never sets a quantity",
    ("Services", "Output"): "Neon: runs, decisions, logs. Slack / Telegram: run alert, and red alerts the same day",
    ("Procurement", "Output"): "Confirms each approval (no approve-all); edits with a reason; exports POs to Zoho",
    ("Planner", "Trigger"): "What-if: a new SKU, a festival that moved, a distributor change",
    ("Planner", "Input"): "Scenario on a copy of the tables; blind shadow call for each SKU",
    ("Planner", "Context"): "Owns the rules and the rulebook: why each rule exists, edge cases, owners",
    ("Planner", "Output"): "Decides held SKUs; sees the shadow reveal and gives a reason for each disagreement",
    ("Head of Ops", "Output"): "Oversight: outcomes per run, 80% kill criterion, conflict and warning logs",
}


def cell(row: str, col: str):
    x0 = ACTOR_X + ACTOR_W + C[col] * COL_W
    y0 = HEAD_Y + HEAD_H + R[row] * ROW_H
    return x0, y0


def box(row: str, col: str):
    x0, y0 = cell(row, col)
    x, y = x0 + (COL_W - BOX_W) / 2, y0 + (ROW_H - BOX_H) / 2
    return x, y, x + BOX_W, y + BOX_H  # left, top, right, bottom


def mid_y(row: str) -> float:
    return HEAD_Y + HEAD_H + R[row] * ROW_H + ROW_H / 2


def arrow(points, label: str | None = None, label_at: int = 0, color: str = NAVY, at: float = 0.5) -> str:
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in points)
    red = color == RED
    out = (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{2.6 if red else 2}" stroke-dasharray="{"9 5" if red else "7 6"}" '
           f'marker-end="url(#{"head-red" if red else "head"})"/>')
    if label:
        (x1, y1), (x2, y2) = points[label_at], points[label_at + 1]
        lx, ly = x1 + (x2 - x1) * at, y1 + (y2 - y1) * at
        tw = len(label) * 7.4 + 14
        out += (f'<rect x="{lx - tw / 2:.1f}" y="{ly - 12:.1f}" width="{tw:.1f}" height="22" rx="11" fill="{"#fdecea" if red else "#ffffff"}" stroke="{color}" stroke-opacity="{".7" if red else ".25"}"/>'
                f'<text x="{lx:.1f}" y="{ly + 4.5:.1f}" text-anchor="middle" font-size="13" font-style="italic" font-weight="{"700" if red else "400"}" fill="{color}">{escape(label)}</text>')
    return out


def build() -> str:
    H = HEAD_Y + HEAD_H + len(ROWS) * ROW_H + 24 + LEGEND_H
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif">',
         f'<defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{NAVY}"/></marker>'
         f'<marker id="head-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{RED}"/></marker></defs>',
         f'<rect width="{W}" height="{H}" fill="#ffffff"/>',
         f'<text x="{W / 2}" y="62" text-anchor="middle" font-size="36" font-weight="700" fill="{NAVY}">Freshroots · Reorder Desk — Components Map</text>']
    grid_top, grid_bottom = HEAD_Y + HEAD_H, HEAD_Y + HEAD_H + len(ROWS) * ROW_H
    # lanes
    for i, (name, sub, tint, *_r) in enumerate(ROWS):
        y = grid_top + i * ROW_H
        s.append(f'<rect x="{ACTOR_X + ACTOR_W}" y="{y}" width="{W - 24 - ACTOR_X - ACTOR_W}" height="{ROW_H}" fill="{tint}"/>')
        s.append(f'<rect x="{ACTOR_X}" y="{y}" width="{ACTOR_W}" height="{ROW_H}" fill="{NAVY}"/>')
        s.append(f'<text x="{ACTOR_X + ACTOR_W / 2}" y="{y + ROW_H / 2 - 4}" text-anchor="middle" font-size="22" font-weight="700" fill="#ffffff">{escape(name)}</text>')
        s.append(f'<text x="{ACTOR_X + ACTOR_W / 2}" y="{y + ROW_H / 2 + 22}" text-anchor="middle" font-size="15" fill="#c9d1e3">{escape(sub)}</text>')
        if i:
            s.append(f'<line x1="{ACTOR_X + 12}" x2="{ACTOR_X + ACTOR_W - 12}" y1="{y}" y2="{y}" stroke="#3a4766"/>')
    # header
    s.append(f'<rect x="{ACTOR_X}" y="{HEAD_Y}" width="{W - 48}" height="{HEAD_H}" rx="10" fill="{NAVY}"/>')
    s.append(f'<rect x="{ACTOR_X}" y="{HEAD_Y + HEAD_H - 12}" width="{W - 48}" height="12" fill="{NAVY}"/>')
    s.append(f'<text x="{ACTOR_X + ACTOR_W / 2}" y="{HEAD_Y + 43}" text-anchor="middle" font-size="22" fill="#ffffff">Actor</text>')
    for name, i in C.items():
        x = ACTOR_X + ACTOR_W + i * COL_W
        s.append(f'<text x="{x + COL_W / 2}" y="{HEAD_Y + 43}" text-anchor="middle" font-size="22" fill="#ffffff">{name}</text>')
        s.append(f'<line x1="{x}" x2="{x}" y1="{HEAD_Y + 10}" y2="{grid_bottom}" stroke="#d5dae4" stroke-width="1"/>')
    s.append(f'<line x1="{W - 24}" x2="{W - 24}" y1="{grid_top}" y2="{grid_bottom}" stroke="#d5dae4"/>')

    # arrows (drawn under boxes)
    b = box
    ai_l, ai_t, ai_r, ai_b = b("AI Model", "AI")
    pr_l, pr_t, pr_r, pr_b = b("System", "Processing")
    ctx_l, ctx_t, ctx_r, ctx_b = b("System", "Context")
    out_l, out_t, out_r, out_b = b("System", "Output")
    in_l, in_t, in_r, in_b = b("Data Analyst", "Input")
    tr_l, tr_t, tr_r, tr_b = b("Data Analyst", "Trigger")
    pt_l, pt_t, pt_r, pt_b = b("Planner", "Trigger")
    pi_l, pi_t, pi_r, pi_b = b("Planner", "Input")
    rc_l, rc_t, rc_r, rc_b = b("Planner", "Context")
    sv_l, sv_t, sv_r, sv_b = b("Services", "Output")
    pc_l, pc_t, pc_r, pc_b = b("Procurement", "Output")
    po_l, po_t, po_r, po_b = b("Planner", "Output")
    ho_l, ho_t, ho_r, ho_b = b("Head of Ops", "Output")
    cx = lambda l, r: (l + r) / 2  # noqa: E731
    gutter_ai = HEAD_Y + HEAD_H + R["AI Model"] * ROW_H  # boundary between the System and AI lanes
    s += [
        arrow([(tr_r, mid_y("Data Analyst")), (in_l - 4, mid_y("Data Analyst"))]),
        arrow([(cx(in_l, in_r), in_b), (cx(in_l, in_r), mid_y("System") - 22), (ctx_l - 4, mid_y("System") - 22)], "CSV upload", 1),
        arrow([(ctx_r, mid_y("System")), (pr_l - 4, mid_y("System"))]),
        # planner: what-if and shadow calls feed the engine, entering Processing at its left edge
        arrow([(pt_r, mid_y("Planner")), (pi_l - 4, mid_y("Planner"))]),
        arrow([(cx(pi_l, pi_r), pi_t), (cx(pi_l, pi_r), gutter_ai), (pr_l + 34, gutter_ai), (pr_l + 34, pr_b + 4)], "scenarios + shadow calls", 0, at=0.45),
        arrow([(cx(rc_l, rc_r) + 40, rc_t), (cx(rc_l, rc_r) + 40, ctx_b + 4)], "rules + rulebook", 0),
        arrow([(pr_l + 206, pr_b), (pr_l + 206, mid_y("AI Model")), (ai_l - 4, mid_y("AI Model"))], "engine facts only", 0, at=0.62),
        arrow([(cx(ai_l, ai_r), ai_t), (cx(ai_l, ai_r), mid_y("System")), (out_l - 4, mid_y("System"))], "draft brief", 1),
        arrow([(pr_l + 120, pr_b), (pr_l + 120, mid_y("Planner")), (po_l - 4, mid_y("Planner"))], "held SKUs + shadow reveal", 1),
        arrow([(cx(out_l, out_r) + 50, out_b), (cx(out_l, out_r) + 50, sv_t - 4)], "logs", 0, at=0.62),
        # red alerts: data hold, lost history, 50%+ order jump, overstock-to-stockout swing
        arrow([(cx(out_l, out_r) - 50, out_b), (cx(out_l, out_r) - 50, sv_t - 4)], "RED ALERT", 0, color=RED, at=0.38),
        arrow([(cx(sv_l, sv_r), sv_b), (cx(sv_l, sv_r), pc_t - 4)], "approval link", 0),
        arrow([(sv_l + 34, sv_b), (sv_l + 34, pc_t - 4)], None, color=RED),
        arrow([(sv_l, mid_y("Services") + 30), (sv_l - 140, mid_y("Services") + 30), (sv_l - 140, mid_y("Planner") - 28), (po_l - 4, mid_y("Planner") - 28)], "same day", 1, color=RED, at=0.4),
        # logs feed Oversight: down the right-hand gutter, past the procurement and planner boxes
        arrow([(sv_r, mid_y("Services") + 26), (sv_r + 12, mid_y("Services") + 26), (sv_r + 12, mid_y("Head of Ops")), (ho_r + 4, mid_y("Head of Ops"))]),
        # the monthly review closes the loop back into the rules
        arrow([(ho_l, mid_y("Head of Ops")), (cx(rc_l, rc_r) - 40, mid_y("Head of Ops")), (cx(rc_l, rc_r) - 40, rc_b + 4)], "monthly review refines rules", 1),
    ]
    # boxes
    for (row, col), text in BOXES.items():
        _n, _s, _t, fill, stroke = ROWS[R[row]]
        l, t, r_, bt = box(row, col)
        lines = textwrap.wrap(text, 30)
        assert len(lines) <= 4, f"box text too long: {text}"
        s.append(f'<rect x="{l}" y="{t}" width="{BOX_W}" height="{BOX_H}" rx="11" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')
        y0 = t + BOX_H / 2 - (len(lines) - 1) * 11 + 5
        for k, line in enumerate(lines):
            s.append(f'<text x="{(l + r_) / 2}" y="{y0 + k * 22}" text-anchor="middle" font-size="16" fill="#1b2333">{escape(line)}</text>')
    ly = grid_bottom + 24 + LEGEND_H / 2
    s.append(f'<line x1="{ACTOR_X + 8}" x2="{ACTOR_X + 58}" y1="{ly}" y2="{ly}" stroke="{NAVY}" stroke-width="2" stroke-dasharray="7 6"/>')
    s.append(f'<text x="{ACTOR_X + 68}" y="{ly + 5}" font-size="15" fill="{NAVY}">Data and decisions</text>')
    s.append(f'<line x1="{ACTOR_X + 248}" x2="{ACTOR_X + 298}" y1="{ly}" y2="{ly}" stroke="{RED}" stroke-width="2.6" stroke-dasharray="9 5"/>')
    s.append(f'<text x="{ACTOR_X + 308}" y="{ly + 5}" font-size="15" fill="{RED}" font-weight="700">Red alert</text>')
    s.append(f'<text x="{ACTOR_X + 386}" y="{ly + 5}" font-size="15" fill="{NAVY}">— a data hold, lost sales history, an order jump of 50%+ or an overstock-to-stockout swing is escalated to procurement and the planner the same day, not at the next monthly review.</text>')
    s.append("</svg>")
    return "\n".join(s)


def main() -> None:
    svg = build()
    OUT.mkdir(exist_ok=True)
    (OUT / "components_map.svg").write_text(svg + "\n")
    (OUT / "components_map.html").write_text(
        '<!doctype html><html><head><meta charset="utf-8"><title>Reorder Desk Components Map</title>'
        '<style>html,body{margin:0;background:#fff}</style></head><body>' + svg + "</body></html>\n")
    print("wrote", OUT / "components_map.svg")


if __name__ == "__main__":
    main()
