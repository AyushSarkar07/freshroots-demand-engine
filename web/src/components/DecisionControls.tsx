"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setApprover, useApprover } from "./approver";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconCheck, IconUndo } from "./icons";
import { useToast } from "./toast";
import { Button } from "./ui";
import { classify, KIND_LABEL, validateDecision } from "@/lib/decisions";
import type { Recommendation } from "@/lib/engine/engine";
import { fmtDateTime, units } from "@/lib/format";
import { shortName } from "@/lib/insights";
import type { DecisionRecord } from "@/lib/types";

type Mode = null | "edit" | "reject" | "order" | "no_order";

/**
 * Approve, edit or reject one SKU. The engine's quantity is the default; any change needs a
 * reason. Success is only announced after the server has stored the decision.
 */
export function DecisionControls({ runId, rec, decision, compact = false }: {
  runId: string; rec: Recommendation; decision: DecisionRecord | null; compact?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const actor = useApprover();
  const [mode, setMode] = useState<Mode>(null);
  const [qty, setQty] = useState(String(rec.Recommended_Order_Qty || rec.effective_reorder_qty || rec.Standard_Reorder_Qty || ""));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const name = shortName(rec.SKU_Name);

  async function remove(by: string) {
    const res = await fetch(`/api/runs/${runId}/decisions?sku=${encodeURIComponent(rec.SKU_ID)}&by=${encodeURIComponent(by)}`, { method: "DELETE" });
    if (!res.ok) {
      toast({ tone: "error", title: "Couldn't undo", body: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Server answered ${res.status}` });
      return false;
    }
    toast({ tone: "info", title: `Decision on ${name} undone`, body: "It's back in the queue." });
    router.refresh();
    return true;
  }

  async function submit(d: "order" | "no_order", q: number, n: string) {
    const input = { decision: d, qty: d === "no_order" ? 0 : q, actor: actor.trim(), note: n.trim() };
    const problem = validateDecision(rec, input);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${runId}/decisions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku_id: rec.SKU_ID, ...input }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const msg = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Server answered ${res.status}` : "Network error: nothing was saved.";
      setError(msg);
      toast({ tone: "error", title: "Decision not saved", body: msg });
      return;
    }
    setMode(null);
    setNote("");
    const by = input.actor;
    toast({
      tone: "success",
      title: d === "order" ? `${units(input.qty)} units of ${name} approved` : `${name}: no order`,
      body: `Recorded for ${by}.`,
      action: { label: "Undo", run: () => void remove(by) },
    });
    router.refresh();
  }

  if (decision) {
    const kind = classify(decision);
    const ordered = decision.decision === "order";
    return (
      <div className="text-[12.5px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${ordered ? "bg-lime text-forest" : "bg-paper-3 text-ink-2"}`}>
            {ordered ? <IconCheck width={13} height={13} strokeWidth={2.4} /> : null}
            {ordered ? `${units(decision.qty)} approved` : "No order"}
          </span>
          <button onClick={() => (actor.trim().length < 2 ? setError("Enter your name first.") : setConfirmUndo(true))}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-ink-2 hover:bg-paper-3">
            <IconUndo width={13} height={13} /> Undo
          </button>
        </div>
        <div className="mt-1 text-muted">{KIND_LABEL[kind]} · {decision.actor}{compact ? "" : ` · ${fmtDateTime(decision.decided_at)}`}</div>
        {!compact && decision.note && <div className="mt-1 text-ink-2">“{decision.note}”</div>}
        {error && <div className="mt-1 text-crit">{error}</div>}
        <ConfirmDialog open={confirmUndo} title={`Undo the decision on ${name}?`} confirmLabel="Undo decision" busy={busy}
          onCancel={() => setConfirmUndo(false)}
          onConfirm={async () => { setBusy(true); const ok = await remove(actor.trim()); setBusy(false); if (ok) setConfirmUndo(false); }}>
          {ordered ? `The approval of ${units(decision.qty)} units by ${decision.actor} is removed and the SKU goes back to “Needs a decision”.` : `${decision.actor}'s “no order” is removed and the SKU goes back to “Needs a decision”.`} The undo is logged under your name.
        </ConfirmDialog>
      </div>
    );
  }

  const nameMissing = actor.trim().length < 2;
  const isReorder = rec.Action === "IMMEDIATE_REORDER";
  const isReview = rec.Action === "MANUAL_REVIEW";
  if (!isReorder && !isReview && compact) return <span className="text-[12.5px] text-muted">No order needed</span>;

  const form = (label: string, d: "order" | "no_order", withQty: boolean, placeholder: string) => (
    <div className="space-y-2 text-[12.5px]" onClick={(e) => e.stopPropagation()}>
      {nameMissing && (
        <input placeholder="Your name (required)" onChange={(e) => setApprover(e.target.value)} aria-label="Your name"
          className="h-8 w-full rounded-[var(--radius-sm)] border border-warn bg-paper-2 px-2" />
      )}
      {withQty && (
        <label className="flex items-center gap-2">
          <span className="text-ink-2">Quantity</span>
          <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus
            className="tnum h-8 w-24 rounded-[var(--radius-sm)] border border-line-strong bg-paper-2 px-2 text-right" />
          <span className="text-muted">units{rec.Recommended_Order_Qty ? ` · engine says ${units(rec.Recommended_Order_Qty)}` : ""}</span>
        </label>
      )}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={placeholder} autoFocus={!withQty}
        className="w-full rounded-[var(--radius-sm)] border border-line-strong bg-paper-2 px-2 py-1.5" />
      <div className="flex gap-2">
        <Button size="sm" variant={d === "no_order" ? "dark" : "primary"} disabled={busy} onClick={() => submit(d, Number(qty), note)}>{busy ? "Saving…" : label}</Button>
        <Button size="sm" variant="quiet" onClick={() => { setMode(null); setError(null); }}>Cancel</Button>
      </div>
      {error && <div role="alert" className="text-crit">{error}</div>}
    </div>
  );

  if (mode === "edit") return form("Approve edited quantity", "order", true, "Why change the quantity? (required)");
  if (mode === "reject") return form("Reject: no order", "no_order", false, "Why not order? (required)");
  if (mode === "order") return form("Place order", "order", true, isReview ? "Planner's reasoning (required)" : "Why order against the rules? (required)");
  if (mode === "no_order") return form("Confirm no order", "no_order", false, "Planner's reasoning (required)");

  return (
    <div className="text-[12.5px]" onClick={(e) => e.stopPropagation()}>
      {nameMissing && <div className="mb-1.5 text-[11.5px] font-medium text-warn">Add your name in the sidebar to decide.</div>}
      <div className="flex flex-wrap gap-1.5">
        {isReorder && (
          <>
            <Button size="sm" disabled={busy || nameMissing} onClick={() => submit("order", rec.Recommended_Order_Qty, "")}>
              {busy ? "Saving…" : <>Approve {units(rec.Recommended_Order_Qty)}</>}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("edit")}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("reject")}>Reject</Button>
          </>
        )}
        {isReview && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setMode("order")}>Order…</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("no_order")}>No order</Button>
          </>
        )}
        {!isReorder && !isReview && <Button size="sm" variant="ghost" onClick={() => setMode("order")}>Order anyway…</Button>}
      </div>
      {error && <div role="alert" className="mt-1 text-crit">{error}</div>}
    </div>
  );
}
