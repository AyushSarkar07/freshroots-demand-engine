"use client";
import { useCallback, useMemo, useState } from "react";
import { Bento, type Filter } from "./Bento";
import { DecisionDesk } from "./DecisionDesk";
import { SkuDrawer } from "./SkuDrawer";
import type { EngineConfig } from "@/lib/engine/config";
import type { Recommendation } from "@/lib/engine/engine";
import type { Freshness } from "@/lib/insights";
import type { DecisionRecord, PlannerBrief } from "@/lib/types";

/** Shared state for the overview and the desk: the active filter and the open SKU (mirrored to ?sku=). */
export function ControlRoom(props: {
  runId: string;
  recs: Recommendation[];
  decisions: DecisionRecord[];
  config: EngineConfig;
  history: Record<string, { week: string; units: number }[]>;
  distributors: Record<string, { name: string; status: string }>;
  brief: PlannerBrief | null;
  fresh: Freshness;
  calendarAgrees: boolean | null;
  stats: { actionable: number; decided: number; pendingReorders: number; pendingReviews: number; approvedUnits: number };
  initialSku: string | null;
}) {
  const { runId, recs, decisions, config, history } = props;
  const pending = recs.some((r) => (r.Action === "IMMEDIATE_REORDER" || r.Action === "MANUAL_REVIEW") && !decisions.some((d) => d.sku_id === r.SKU_ID));
  const [filter, setFilter] = useState<Filter>(pending ? "todo" : "all");
  const [selected, setSelected] = useState<string | null>(props.initialSku && recs.some((r) => r.SKU_ID === props.initialSku) ? props.initialSku : null);

  const syncUrl = (sku: string | null) => {
    const url = new URL(window.location.href);
    if (sku) url.searchParams.set("sku", sku);
    else url.searchParams.delete("sku");
    window.history.replaceState(window.history.state, "", url);
  };
  const open = useCallback((sku: string) => {
    setSelected(sku);
    syncUrl(sku);
  }, []);
  const close = useCallback(() => {
    setSelected(null);
    syncUrl(null);
  }, []);
  const jumpTo = useCallback((f: Filter) => {
    setFilter(f);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("desk")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, []);

  const approvedBySku = useMemo(
    () => Object.fromEntries(decisions.filter((d) => d.decision === "order").map((d) => [d.sku_id, d.qty])),
    [decisions],
  );
  const rec = selected ? recs.find((r) => r.SKU_ID === selected) : undefined;

  return (
    <>
      <Bento runId={runId} recs={recs} config={config} history={history} brief={props.brief} fresh={props.fresh}
        calendarAgrees={props.calendarAgrees} stats={props.stats} approvedBySku={approvedBySku} onFilter={jumpTo} onOpen={open} />
      <div className="mt-6">
        <DecisionDesk runId={runId} recs={recs} decisions={decisions} config={config} filter={filter} setFilter={setFilter} selected={selected} onOpen={open} />
      </div>
      {rec && (
        <SkuDrawer key={rec.SKU_ID} runId={runId} rec={rec} decision={decisions.find((d) => d.sku_id === rec.SKU_ID) ?? null}
          history={history[rec.SKU_ID] ?? []} config={config} distributor={props.distributors[rec.Distributor_ID]} onClose={close} />
      )}
    </>
  );
}
