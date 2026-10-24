import Link from "next/link";
import { ShadowDesk, type BlindSku, type RevealedCall } from "@/components/ShadowDesk";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { fmtDate, pct } from "@/lib/format";
import { shortName } from "@/lib/insights";
import { loadRun } from "@/lib/runs";
import { agreement, compareCall, SHADOW } from "@/lib/shadow";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Shadow({ searchParams }: PageProps<"/shadow">) {
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  if (!run) return <div className="p-10"><EmptyState title="No runs yet">Upload an SAP export first.</EmptyState></div>;
  if (run.source === "scenario") {
    return <div className="p-10"><EmptyState title="Shadow calls need a real run" action={<Link href="/shadow" className="text-[13px] font-semibold text-ok hover:underline">Open the latest real run →</Link>}>This run is a simulation.</EmptyState></div>;
  }

  const store = getStore();
  const [runCalls, allCalls] = await Promise.all([store.listShadowCalls([run.id]), store.listShadowCalls()]);
  const byRun = agreement(runCalls);
  const overall = agreement(allCalls);
  const uplift = run.result.recommendations[0]?.seasonal_uplift_pct ?? 0;

  // Blind by construction: the engine's verdict is sent to the browser only for SKUs already called.
  const skus: BlindSku[] = run.result.recommendations.map((r) => ({
    sku: r.SKU_ID, name: shortName(r.SKU_Name), category: r.Category, perishability: r.Perishability,
    onHand: r.Units_On_Hand, avg12: r.avg_12w_sales, avg4: r.avg_4w_sales, stdQty: r.Standard_Reorder_Qty,
  }));
  const calls: Record<string, RevealedCall> = Object.fromEntries(runCalls.map((c) => {
    const cmp = compareCall(c);
    return [c.sku_id, { planner_action: c.planner_action, planner_qty: c.planner_qty, engine_action: c.engine_action, engine_qty: c.engine_qty, actionAgrees: cmp.actionAgrees, qtyAgrees: cmp.qtyAgrees, actor: c.actor, note: c.note }];
  }));

  return (
    <>
      <PageHeader eyebrow="Shadow mode · weeks 1–4" title="Does the engine plan like Raghav?"
        sub={<>Record your own call for each SKU before seeing the engine&apos;s. Agreement on the SKUs the rules cover is the decision memo&apos;s kill criterion: below {Math.round(SHADOW.killThreshold * 100)}%, the written rules aren&apos;t how you actually plan. Run evaluated {fmtDate(run.evaluation_date)} · sales through {run.result.sales_cutoff_week}{uplift ? ` · festival month (the rule adds +${uplift}%)` : ""}.</>} />
      <div className="mx-auto max-w-[1320px] space-y-6 px-4 py-8 sm:px-8 lg:px-10">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Your calls this run" value={`${runCalls.length}/${skus.length}`} note="Hold counts as a call" />
          <Stat label="Agreement this run" value={pct(byRun.rate)} note={`${byRun.agree} of ${byRun.covered} rule-covered SKUs`} tone={byRun.rate == null ? undefined : byRun.rate >= SHADOW.killThreshold ? "ok" : "crit"} />
          <Stat label="Agreement overall" value={pct(overall.rate)} note={`${overall.covered} rule-covered calls across all runs`} tone={overall.verdict === "kill" ? "crit" : overall.verdict === "on_track" ? "ok" : undefined} />
          <Stat label="Kill criterion" value={overall.verdict === "collecting" ? `${overall.covered}/${SHADOW.minSample}` : overall.verdict === "kill" ? "Triggered" : "Passed"}
            note={overall.verdict === "collecting" ? `Calls needed before a verdict` : overall.verdict === "kill" ? "Stop and redesign the rules" : `At or above ${Math.round(SHADOW.killThreshold * 100)}%`}
            tone={overall.verdict === "kill" ? "crit" : overall.verdict === "on_track" ? "ok" : "warn"} />
        </div>
        <ShadowDesk runId={run.id} skus={skus} calls={calls} />
        <p className="text-[12px] text-muted">
          Reorder quantities count as the same when within ±{Math.round(SHADOW.qtyTolerance * 100)}%. SKUs the engine holds for planner review aren&apos;t counted, because the rules don&apos;t decide them. Results and disagreement reasons are on <Link href="/oversight#shadow" className="font-semibold text-ok hover:underline">Oversight</Link>.
        </p>
      </div>
    </>
  );
}
