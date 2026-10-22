import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateBrief } from "./brief";
import { getConfig } from "./config";
import { type EngineInputs, runEngine } from "./engine/engine";
import { notifyRun } from "./notify";
import { getStore } from "./store";
import type { InputFileMeta, RunRecord } from "./types";

export const INPUT_FILES: { key: keyof EngineInputs; file: string; label: string; required: boolean }[] = [
  { key: "sku_master", file: "sku_master.csv", label: "SKU master", required: true },
  { key: "current_inventory", file: "current_inventory.csv", label: "Current inventory", required: true },
  { key: "weekly_sales", file: "weekly_sales.csv", label: "Weekly sales", required: true },
  { key: "calendar", file: "calendar.csv", label: "Calendar", required: false },
  { key: "distributor_master", file: "distributor_master.csv", label: "Distributor master", required: false },
];

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newId = () => `r_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;

/** Engine run -> stored run -> AI brief -> procurement notification. The engine throws FreshrootsError on unusable input. */
export async function createRun(opts: {
  inputs: EngineInputs;
  fileNames?: Partial<Record<keyof EngineInputs, string>>;
  evaluationDate: string;
  createdBy: string;
  source: RunRecord["source"];
  label: string;
  id?: string;
}): Promise<RunRecord> {
  const result = runEngine(opts.inputs, opts.evaluationDate);
  const input_meta: InputFileMeta[] = INPUT_FILES.filter((f) => opts.inputs[f.key] != null).map((f) => ({
    name: f.key, file: opts.fileNames?.[f.key] ?? f.file, bytes: Buffer.byteLength(opts.inputs[f.key]!), sha256: sha256(opts.inputs[f.key]!),
  }));
  const run: RunRecord = {
    id: opts.id ?? newId(), created_at: new Date().toISOString(), created_by: opts.createdBy, source: opts.source,
    label: opts.label, evaluation_date: result.evaluation_date, inputs: opts.inputs, input_meta, result, brief: null,
  };
  const store = getStore();
  await store.createRun(run);
  const k = result.summary.operational_kpis;
  await store.addEvent({
    run_id: run.id, sku_id: null, kind: "run_created", actor: opts.createdBy, at: new Date().toISOString(),
    detail: { evaluation_date: run.evaluation_date, sales_cutoff_week: result.sales_cutoff_week, reorder: k.immediate_reorder_skus, units: k.total_recommended_order_units, review: k.skus_requiring_manual_review, dq_errors: result.summary.data_quality.errors },
  });

  run.brief = await generateBrief(result);
  await store.setBrief(run.id, run.brief);
  await store.addEvent({
    run_id: run.id, sku_id: null, kind: run.brief.fallback_reason ? "brief_fallback" : "brief_generated", actor: run.brief.source === "gemini" ? `Gemini (${run.brief.model})` : "Template",
    at: new Date().toISOString(), detail: { headline: run.brief.headline, reason: run.brief.fallback_reason ?? null },
  });

  const sent = await notifyRun(run);
  await store.addEvent({
    run_id: run.id, sku_id: null, kind: "notification", actor: "System", at: new Date().toISOString(),
    detail: { channel: sent.channel, live: sent.live, error: sent.error ?? null, text: sent.text },
  });
  return run;
}

/** On first use, load the bundled SAP sample export so the app opens on real data. */
let seeding: Promise<void> | null = null;
export async function ensureSeeded(): Promise<void> {
  seeding ??= (async () => {
    const store = getStore();
    if (await store.latestRunId()) return;
    const dir = path.join(process.cwd(), "data");
    const inputs = Object.fromEntries(
      await Promise.all(INPUT_FILES.map(async (f) => [f.key, await readFile(path.join(dir, f.file), "utf8")])),
    ) as unknown as EngineInputs;
    const evaluationDate = getConfig().caseEvaluationDate;
    await createRun({
      inputs, evaluationDate, createdBy: "Case export", source: "case_export",
      label: "SAP sample export (case data)", id: `case-${evaluationDate}`,
    });
  })().catch((e) => {
    seeding = null;
    throw e;
  });
  return seeding;
}

export async function loadRun(runId?: string | null): Promise<RunRecord | null> {
  await ensureSeeded();
  const store = getStore();
  const id = runId || (await store.latestRunId());
  return id ? store.getRun(id) : null;
}
