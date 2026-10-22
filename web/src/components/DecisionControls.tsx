"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setApprover, useApprover } from "./approver";
import { classify, KIND_LABEL, validateDecision } from "@/lib/decisions";
import type { Recommendation } from "@/lib/engine/engine";
import { fmtDateTime, units } from "@/lib/format";
import type { DecisionRecord } from "@/lib/types";

type Mode = null | "edit" | "reject" | "order" | "no_order";

const btn = "rounded-md px-2.5 py-1 text-[12.5px] font-medium disabled:opacity-50";
const primary = `${btn} bg-accent text-white hover:opacity-90 dark:text-page`;
const ghost = `${btn} border border-line-strong text-ink-2 hover:bg-page`;

/**
 * Approve, edit or reject one SKU. The engine's quantity is the default; any change needs a reason.
 * Decisions are recorded with the person's name; nothing is sent to a supplier from here.
 */
export function DecisionControls({ runId, rec, decision, compact = false }: {
  runId: string; rec: Recommendation; decision: DecisionRecord | null; compact?: boolean;
}) {
  const router = useRouter();
  const actor = useApprover();
  const [mode, setMode] = useState<Mode>(null);
  const [qty, setQty] = useState(String(rec.Recommended_Order_Qty || rec.effective_reorder_qty || rec.Standard_Reorder_Qty || ""));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(d: "order" | "no_order", q: number, n: string) {
    const input = { decision: d, qty: d === "no_order" ? 0 : q, actor: actor.trim(), note: n.trim() };
    const problem = validateDecision(rec, input);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${runId}/decisions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku_id: rec.SKU_ID, ...input }),
    });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save.");
    setMode(null);
    setNote("");
    router.refresh();
  }

  async function undo() {
    if (actor.trim().length < 2) return setError("Enter your name in the top bar first.");
    setBusy(true);
    await fetch(`/api/runs/${runId}/decisions?sku=${encodeURIComponent(rec.SKU_ID)}&by=${encodeURIComponent(actor.trim())}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  if (decision) {
    const kind = classify(decision);
    const ordered = decision.decision === "order";
    return (
      <div className="text-[12.5px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${ordered ? "bg-good-soft text-good" : "bg-page text-ink-2 border border-line"}`}>
            <span aria-hidden>{ordered ? "✓" : "–"}</span>
            {ordered ? `${units(decision.qty)} approved` : "No order"}
          </span>
          <button onClick={undo} disabled={busy} className="text-[12px] text-accent hover:underline">Undo</button>
        </div>
        <div className="mt-1 text-muted">
          {KIND_LABEL[kind]} · {decision.actor}{compact ? "" : ` · ${fmtDateTime(decision.decided_at)}`}
        </div>
        {!compact && decision.note && <div className="mt-1 text-ink-2">“{decision.note}”</div>}
        {error && <div className="mt-1 text-bad">{error}</div>}
      </div>
    );
  }

  const nameMissing = actor.trim().length < 2;
  const isReorder = rec.Action === "IMMEDIATE_REORDER";
  const isReview = rec.Action === "MANUAL_REVIEW";
  if (!isReorder && !isReview && compact) return <span className="text-[12px] text-muted">No order needed</span>;

  const nameField = nameMissing && (
    <input
      placeholder="Your name (required)"
      onChange={(e) => setApprover(e.target.value)}
      className="mb-2 w-full rounded-md border border-warn bg-page px-2 py-1 text-[12.5px]"
      aria-label="Your name"
    />
  );

  const form = (label: string, d: "order" | "no_order", withQty: boolean, notePlaceholder: string) => (
    <div className="space-y-2 text-[12.5px]" onClick={(e) => e.stopPropagation()}>
      {nameField}
      {withQty && (
        <label className="flex items-center gap-2">
          <span className="text-ink-2">Quantity</span>
          <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)}
            className="tnum w-24 rounded-md border border-line-strong bg-page px-2 py-1" />
          <span className="text-muted">units</span>
        </label>
      )}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={notePlaceholder}
        className="w-full rounded-md border border-line-strong bg-page px-2 py-1" />
      <div className="flex gap-2">
        <button className={primary} disabled={busy} onClick={() => submit(d, Number(qty), note)}>{label}</button>
        <button className={ghost} onClick={() => { setMode(null); setError(null); }}>Cancel</button>
      </div>
      {error && <div className="text-bad">{error}</div>}
    </div>
  );

  if (mode === "edit") return form("Approve edited quantity", "order", true, "Why change the quantity? (required)");
  if (mode === "reject") return form("Reject: no order", "no_order", false, "Why not order? (required)");
  if (mode === "order") return form("Place order", "order", true, isReview ? "Planner's reasoning (required)" : "Why order against the rules? (required)");
  if (mode === "no_order") return form("Confirm no order", "no_order", false, "Planner's reasoning (required)");

  return (
    <div className="text-[12.5px]" onClick={(e) => e.stopPropagation()}>
      {nameMissing && <div className="mb-1 text-[11.5px] text-warn">Enter your name in the top bar to decide.</div>}
      <div className="flex flex-wrap gap-1.5">
        {isReorder && (
          <>
            <button className={primary} disabled={busy || nameMissing} onClick={() => submit("order", rec.Recommended_Order_Qty, "")}>
              Approve {units(rec.Recommended_Order_Qty)}
            </button>
            <button className={ghost} onClick={() => setMode("edit")}>Edit</button>
            <button className={ghost} onClick={() => setMode("reject")}>Reject</button>
          </>
        )}
        {isReview && (
          <>
            <button className={ghost} onClick={() => setMode("order")}>Order…</button>
            <button className={ghost} onClick={() => setMode("no_order")}>No order</button>
          </>
        )}
        {!isReorder && !isReview && <button className={ghost} onClick={() => setMode("order")}>Order anyway…</button>}
      </div>
      {error && <div className="mt-1 text-bad">{error}</div>}
    </div>
  );
}
