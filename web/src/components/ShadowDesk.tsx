"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { setApprover, useApprover } from "./approver";
import { IconCheck, IconClose } from "./icons";
import { useToast } from "./toast";
import { Button, StatusBadge, Tag } from "./ui";
import { units, weeks } from "@/lib/format";
import { ACTION_LABEL, PLANNER_ACTIONS, type PlannerAction } from "@/lib/shadow";

/** What the planner sees before deciding: raw inputs only, no engine verdict. */
export interface BlindSku {
  sku: string;
  name: string;
  category: string;
  perishability: string;
  onHand: number | null;
  avg12: number | null;
  avg4: number | null;
  stdQty: number | null;
}
/** Revealed only once a call exists for the SKU. */
export interface RevealedCall {
  planner_action: PlannerAction;
  planner_qty: number;
  engine_action: string;
  engine_qty: number;
  actionAgrees: boolean;
  qtyAgrees: boolean | null;
  actor: string;
  note: string;
}

function Row({ runId, sku, call }: { runId: string; sku: BlindSku; call: RevealedCall | null }) {
  const router = useRouter();
  const toast = useToast();
  const actor = useApprover();
  const [action, setAction] = useState<PlannerAction | null>(null);
  const [qty, setQty] = useState(String(sku.stdQty ?? ""));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(a: PlannerAction, q: number, n: string) {
    if (actor.trim().length < 2) return setError("Add your name in the sidebar first.");
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/runs/${runId}/shadow`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku_id: sku.sku, action: a, qty: q, actor: actor.trim(), note: n }),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { error?: string; actionAgrees?: boolean }) : {};
    setBusy(false);
    if (!res?.ok) return setError(body.error ?? "Not saved.");
    if (!call) toast({ tone: body.actionAgrees ? "success" : "info", title: body.actionAgrees ? `${sku.name}: you and the engine agree` : `${sku.name}: you and the engine differ`, body: body.actionAgrees ? undefined : "Add a reason so the rule can be reviewed." });
    else toast({ tone: "success", title: "Reason saved" });
    router.refresh();
  }

  return (
    <li className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] sm:px-6">
      <div>
        <div className="font-semibold">{sku.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <span className="font-mono">{sku.sku}</span>· {sku.category}{sku.perishability === "High" && <Tag tone="plain">Perishable</Tag>}
        </div>
        <dl className="tnum mt-2 grid grid-cols-4 gap-2 text-[12px]">
          {[["On hand", units(sku.onHand)], ["12-wk avg", weeks(sku.avg12)], ["4-wk avg", weeks(sku.avg4)], ["Std reorder", units(sku.stdQty)]].map(([k, v]) => (
            <div key={k}><dt className="text-muted">{k}</dt><dd className="text-[14px] font-semibold">{v}</dd></div>
          ))}
        </dl>
      </div>

      {call ? (
        <div className={`rounded-[var(--radius-lg)] border p-3 text-[13px] ${call.actionAgrees && call.qtyAgrees !== false ? "border-ok/30 bg-ok-soft/50" : "border-warn/30 bg-warn-soft/60"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 font-semibold ${call.actionAgrees && call.qtyAgrees !== false ? "text-ok" : "text-warn"}`}>
              {call.actionAgrees && call.qtyAgrees !== false ? <IconCheck width={15} height={15} strokeWidth={2.4} /> : <IconClose width={15} height={15} strokeWidth={2.4} />}
              {call.actionAgrees ? (call.qtyAgrees === false ? "Same action, different quantity" : "Agree") : "Differ"}
            </span>
            <span className="text-ink-2">You: <b className="font-semibold text-ink">{ACTION_LABEL[call.planner_action]}{call.planner_action === "REORDER" ? ` ${units(call.planner_qty)}` : ""}</b></span>
            <span className="text-ink-2">Engine:</span><StatusBadge action={call.engine_action} size="sm" />
            {call.engine_action === "IMMEDIATE_REORDER" && <span className="tnum font-semibold">{units(call.engine_qty)}</span>}
          </div>
          {call.engine_action === "MANUAL_REVIEW" && <p className="mt-1 text-[12px] text-muted">The rules don&apos;t decide this SKU, so it isn&apos;t counted in the agreement rate.</p>}
          {(!call.actionAgrees || call.qtyAgrees === false) && (
            call.note ? <p className="mt-1.5 text-ink-2">Your reason: “{call.note}”</p> : (
              <div className="mt-2 space-y-2">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Why did your call differ? This is what the monthly review uses to refine the rules."
                  className="w-full rounded-[var(--radius-sm)] border border-line-strong bg-paper-2 px-2 py-1.5 text-[12.5px]" />
                <Button size="sm" variant="dark" disabled={busy || note.trim().length < 3} onClick={() => save(call.planner_action, call.planner_qty, note)}>Save reason</Button>
              </div>
            )
          )}
          <div className="mt-1 text-[11.5px] text-muted">Recorded by {call.actor}</div>
          {error && <div role="alert" className="mt-1 text-crit">{error}</div>}
        </div>
      ) : (
        <div className="space-y-2 text-[12.5px]">
          {actor.trim().length < 2 && <input placeholder="Your name (required)" onChange={(e) => setApprover(e.target.value)} className="h-8 w-full rounded-[var(--radius-sm)] border border-warn bg-paper-2 px-2" aria-label="Your name" />}
          <div role="radiogroup" aria-label={`Your call for ${sku.name}`} className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {PLANNER_ACTIONS.map((a) => (
              <button key={a.value} role="radio" aria-checked={action === a.value} onClick={() => setAction(a.value)}
                className={`rounded-[var(--radius)] border px-2 py-2 text-left transition-colors ${action === a.value ? "border-night bg-night text-cream" : "border-line-strong bg-paper-2 hover:bg-paper-3"}`}>
                <span className="block text-[13px] font-semibold">{a.label}</span>
                <span className={`block text-[11px] ${action === a.value ? "text-mist" : "text-muted"}`}>{a.hint}</span>
              </button>
            ))}
          </div>
          {action === "REORDER" && (
            <label className="flex items-center gap-2">
              <span className="text-ink-2">Quantity you would order</span>
              <input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className="tnum h-8 w-24 rounded-[var(--radius-sm)] border border-line-strong bg-paper-2 px-2 text-right" />
            </label>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!action || busy} onClick={() => action && save(action, Number(qty), "")}>{busy ? "Saving…" : "Record my call and reveal"}</Button>
            <span className="text-[11.5px] text-muted">The engine&apos;s answer appears only after you record yours.</span>
          </div>
          {error && <div role="alert" className="text-crit">{error}</div>}
        </div>
      )}
    </li>
  );
}

export function ShadowDesk({ runId, skus, calls }: { runId: string; skus: BlindSku[]; calls: Record<string, RevealedCall> }) {
  const [onlyOpen, setOnlyOpen] = useState(false);
  const shown = onlyOpen ? skus.filter((s) => !calls[s.sku]) : skus;
  return (
    <section className="rounded-[var(--radius-xl)] border border-line bg-paper-2 shadow-[var(--shadow-1)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-display text-[20px] font-semibold tracking-tight">Your call, SKU by SKU</h2>
          <p className="text-[12.5px] text-muted">Decide as you would in Excel, from the raw numbers. The engine stays hidden until you commit.</p>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} className="accent-[var(--night)]" /> Only SKUs I haven&apos;t called
        </label>
      </header>
      <ul className="divide-y divide-line">
        {shown.map((s) => <Row key={s.sku} runId={runId} sku={s} call={calls[s.sku] ?? null} />)}
        {!shown.length && <li className="px-6 py-10 text-center text-[13px] text-muted">Every SKU in this run has your call.</li>}
      </ul>
    </section>
  );
}
