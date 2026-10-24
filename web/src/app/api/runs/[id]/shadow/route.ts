import { NextResponse, type NextRequest } from "next/server";
import { compareCall, validateShadow, type PlannerAction } from "@/lib/shadow";
import { getStore } from "@/lib/store";

interface Body { sku_id?: string; action?: string; qty?: number; actor?: string; note?: string }

// Shadow mode: the planner's own call for one SKU, recorded before he sees the engine's.
// The response reveals the engine's decision and whether they agree; nothing is ordered.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/runs/[id]/shadow">) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Body;
  const store = getStore();
  const run = await store.getRun(id);
  const rec = run?.result.recommendations.find((r) => r.SKU_ID === body.sku_id);
  if (!run || !rec) return NextResponse.json({ error: "Run or SKU not found." }, { status: 404 });
  if (run.source === "scenario") return NextResponse.json({ error: "Shadow calls are recorded on real runs, not simulations." }, { status: 409 });

  const input = { action: String(body.action ?? ""), qty: body.action === "REORDER" ? Number(body.qty) : 0, actor: String(body.actor ?? "").trim() };
  const error = validateShadow(rec, input);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const call = {
    run_id: id, sku_id: rec.SKU_ID, planner_action: input.action as PlannerAction, planner_qty: input.qty,
    engine_action: rec.Action, engine_qty: rec.Recommended_Order_Qty, actor: input.actor, note: String(body.note ?? "").trim().slice(0, 500),
    decided_at: new Date().toISOString(),
  };
  await store.upsertShadowCall(call);
  const cmp = compareCall(call);
  await store.addEvent({
    run_id: id, sku_id: rec.SKU_ID, kind: "shadow_call", actor: call.actor, at: call.decided_at,
    detail: { planner_action: call.planner_action, planner_qty: call.planner_qty, engine_action: call.engine_action, engine_qty: call.engine_qty, agrees: cmp.actionAgrees, qty_agrees: cmp.qtyAgrees, note: call.note },
  });
  return NextResponse.json({ ok: true, engine_action: rec.Action, engine_qty: rec.Recommended_Order_Qty, ...cmp, explanation: rec.Explanation });
}
