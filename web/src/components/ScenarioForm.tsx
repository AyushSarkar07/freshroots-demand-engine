"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useApprover } from "./approver";
import { useToast } from "./toast";
import { Button } from "./ui";

interface Props {
  runs: { id: string; label: string; evaluation_date: string }[];
  skus: Record<string, { id: string; name: string; distributor: string }[]>;
  distributors: Record<string, string[]>;
  defaultRun: string;
}

/**
 * The database simulation exercise. Defaults reproduce the class brief: SKU009 loses its
 * sales history and moves to a brand-new distributor. The SQL preview updates as you choose.
 */
export function ScenarioForm({ runs, skus, distributors, defaultRun }: Props) {
  const router = useRouter();
  const toast = useToast();
  const name = useApprover();
  const [base, setBase] = useState(defaultRun);
  const list = skus[base] ?? [];
  const [sku, setSku] = useState(list.find((s) => s.id === "SKU009")?.id ?? list[0]?.id ?? "");
  const [removeHistory, setRemoveHistory] = useState(true);
  const [addDist, setAddDist] = useState(true);
  const [distId, setDistId] = useState("DIST005");
  const [distName, setDistName] = useState("Konkan Fresh Supply");
  const [region, setRegion] = useState("Goa");
  const [remap, setRemap] = useState(true);
  const [upliftOff, setUpliftOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = list.find((s) => s.id === sku);
  const remapTo = addDist ? distId.trim().toUpperCase() : (distributors[base] ?? []).find((d) => d !== current?.distributor) ?? "";
  const ops = useMemo(() => {
    const o: string[] = [];
    if (removeHistory) o.push(`DELETE FROM weekly_sales WHERE sku_id = '${sku}';`);
    if (addDist) o.push(`INSERT INTO distributor_master VALUES ('${distId.trim().toUpperCase()}', '${distName.trim()}', '${region.trim()}', 'Active');`);
    if (remap && remapTo) o.push(`UPDATE sku_master SET distributor_id = '${remapTo}' WHERE sku_id = '${sku}';  -- was ${current?.distributor ?? "?"}`);
    if (upliftOff) o.push("-- override: festival uplift off for this scenario");
    return o;
  }, [removeHistory, addDist, remap, upliftOff, sku, distId, distName, region, remapTo, current]);

  async function run() {
    if (name.trim().length < 2) return setError("Add your name in the sidebar first.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/scenarios", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        base_run_id: base, sku_id: sku, remove_history: removeHistory, created_by: name.trim(),
        new_distributor: addDist ? { id: distId, name: distName, region } : null,
        remap_to: remap ? remapTo : null, festival_uplift: upliftOff ? "off" : "rule",
      }),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { id?: string; error?: string }) : {};
    setBusy(false);
    if (!res?.ok || !body.id) return setError(body.error ?? "The scenario couldn't run. Nothing was stored.");
    toast({ tone: "success", title: "Scenario run complete", body: "Opening the comparison with the original run." });
    router.push(`/compare?run=${body.id}`);
    router.refresh(); // the sidebar run list lives in the layout, which client navigation keeps
  }

  const box = "rounded-[var(--radius)] border border-line bg-paper px-3 py-2.5";
  const input = "h-8 w-full rounded-[var(--radius-sm)] border border-line-strong bg-paper-2 px-2 text-[13px]";
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="space-y-3 text-[13px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-ink-2">Base run (copied, never changed)</span>
            <select className={input} value={base} onChange={(e) => { setBase(e.target.value); setSku(skus[e.target.value]?.[0]?.id ?? ""); }}>
              {runs.map((r) => <option key={r.id} value={r.id}>{r.evaluation_date} · {r.label}</option>)}
            </select>
          </label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-ink-2">SKU to simulate</span>
            <select className={input} value={sku} onChange={(e) => setSku(e.target.value)}>
              {list.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}
            </select>
          </label>
        </div>
        <label className={`${box} flex items-start gap-2.5`}>
          <input type="checkbox" checked={removeHistory} onChange={(e) => setRemoveHistory(e.target.checked)} className="mt-0.5 accent-[var(--night)]" />
          <span><b className="font-semibold">Delete all sales history</b> for {sku}<span className="block text-[12px] text-muted">Makes it look like a new launch with no past data.</span></span>
        </label>
        <div className={box}>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={addDist} onChange={(e) => setAddDist(e.target.checked)} className="mt-0.5 accent-[var(--night)]" />
            <span><b className="font-semibold">Add a new distributor</b><span className="block text-[12px] text-muted">Inserted into a copy of the distributor table.</span></span>
          </label>
          {addDist && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <input className={input} value={distId} onChange={(e) => setDistId(e.target.value)} aria-label="Distributor ID" />
              <input className={input} value={distName} onChange={(e) => setDistName(e.target.value)} aria-label="Distributor name" />
              <input className={input} value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" />
            </div>
          )}
        </div>
        <label className={`${box} flex items-start gap-2.5`}>
          <input type="checkbox" checked={remap} onChange={(e) => setRemap(e.target.checked)} className="mt-0.5 accent-[var(--night)]" />
          <span><b className="font-semibold">Remap {sku} to {remapTo || "another distributor"}</b><span className="block text-[12px] text-muted">Currently {current?.distributor || "unassigned"}.</span></span>
        </label>
        <label className={`${box} flex items-start gap-2.5`}>
          <input type="checkbox" checked={upliftOff} onChange={(e) => setUpliftOff(e.target.checked)} className="mt-0.5 accent-[var(--night)]" />
          <span><b className="font-semibold">Override: festival uplift off</b><span className="block text-[12px] text-muted">For “what if the festival moved” checks. Applies to every SKU in the scenario.</span></span>
        </label>
      </div>
      <div className="flex flex-col">
        <div className="text-[12px] font-semibold text-ink-2">What will run</div>
        <pre className="mt-1 min-h-[132px] overflow-x-auto rounded-[var(--radius)] bg-night px-4 py-3 font-mono text-[12px] leading-relaxed text-cream">{ops.length ? ops.join("\n") : "-- pick at least one change"}</pre>
        <p className="mt-2 text-[12px] text-muted">The engine reruns on the changed copy and the result opens next to the original. Scenario runs never notify procurement and can&apos;t be approved or exported.</p>
        <div className="mt-3"><Button onClick={run} disabled={busy || !ops.length}>{busy ? "Running the scenario…" : "Run scenario and compare"}</Button></div>
        {error && <div role="alert" className="mt-2 rounded-[var(--radius)] bg-crit-soft px-3 py-2 text-[13px] text-crit">{error}</div>}
      </div>
    </div>
  );
}
