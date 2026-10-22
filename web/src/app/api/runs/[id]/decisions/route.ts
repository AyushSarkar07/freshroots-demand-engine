import { NextResponse, type NextRequest } from "next/server";
import { classify, KIND_LABEL, validateDecision } from "@/lib/decisions";
import { getStore } from "@/lib/store";

interface Body {
  sku_id?: string;
  decision?: "order" | "no_order";
  qty?: number;
  actor?: string;
  note?: string;
}

// A named person approves, edits or rejects one SKU's recommendation. Nothing is sent to a supplier.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/runs/[id]/decisions">) {
  const { id } = await ctx.params;
  const body = (await req.json()) as Body;
  const store = getStore();
  const run = await store.getRun(id);
  const rec = run?.result.recommendations.find((r) => r.SKU_ID === body.sku_id);
  if (!run || !rec) return NextResponse.json({ error: "Run or SKU not found." }, { status: 404 });

  const input = {
    decision: body.decision ?? "order",
    qty: body.decision === "no_order" ? 0 : Number(body.qty),
    actor: String(body.actor ?? "").trim(),
    note: String(body.note ?? "").trim(),
  };
  const error = validateDecision(rec, input);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const d = {
    run_id: id, sku_id: rec.SKU_ID, ...input, recommended_qty: rec.Recommended_Order_Qty,
    engine_action: rec.Action, decided_at: new Date().toISOString(),
  };
  await store.upsertDecision(d);
  await store.addEvent({
    run_id: id, sku_id: rec.SKU_ID, kind: "decision", actor: d.actor, at: d.decided_at,
    detail: { decision: d.decision, qty: d.qty, recommended_qty: d.recommended_qty, engine_action: d.engine_action, kind: KIND_LABEL[classify(d)], note: d.note },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/runs/[id]/decisions">) {
  const { id } = await ctx.params;
  const sku = req.nextUrl.searchParams.get("sku") ?? "";
  const actor = (req.nextUrl.searchParams.get("by") ?? "").trim();
  if (actor.length < 2) return NextResponse.json({ error: "Enter your name first." }, { status: 400 });
  const store = getStore();
  await store.clearDecision(id, sku);
  await store.addEvent({ run_id: id, sku_id: sku, kind: "decision_cleared", actor, at: new Date().toISOString(), detail: {} });
  return NextResponse.json({ ok: true });
}
