import type { EngineInputs, EngineResult } from "./engine/engine";

export interface InputFileMeta {
  name: string;
  file: string;
  bytes: number;
  sha256: string;
}

export interface PlannerBrief {
  headline: string;
  bullets: string[];
  watch: string[];
  source: "gemini" | "template";
  model: string | null;
  /** Why a Gemini draft was replaced by the template, if it was. */
  fallback_reason?: string | null;
}

/** What a simulation changed, recorded with the scenario run so it can be explained and replayed. */
export interface ScenarioSpec {
  sku_id: string;
  remove_history: boolean;
  new_distributor: { id: string; name: string; region: string } | null;
  remap_to: string | null;
  festival_uplift: "rule" | "off";
  /** The operations as a DBA would write them, shown in the UI. */
  operations: string[];
}

export interface RunRecord {
  id: string;
  created_at: string;
  created_by: string;
  /** Scenario runs are simulations: never the default view, never approvable, never exported. */
  source: "case_export" | "upload" | "scenario";
  base_run_id?: string | null;
  scenario?: ScenarioSpec | null;
  label: string;
  evaluation_date: string;
  inputs: EngineInputs;
  input_meta: InputFileMeta[];
  result: EngineResult;
  brief: PlannerBrief | null;
}

export type RunSummary = Pick<RunRecord, "id" | "created_at" | "created_by" | "source" | "label" | "evaluation_date" | "base_run_id"> & {
  kpis: EngineResult["summary"]["operational_kpis"];
  sales_cutoff_week: string;
  dq_errors: number;
  dq_warnings: number;
};

/** A person's decision on one SKU in one run. "order" with a quantity, or "no_order". */
export interface DecisionRecord {
  run_id: string;
  sku_id: string;
  decision: "order" | "no_order";
  qty: number;
  recommended_qty: number;
  engine_action: string;
  actor: string;
  note: string;
  decided_at: string;
}

export interface EventRecord {
  id?: number;
  run_id: string;
  sku_id: string | null;
  kind:
    | "run_created" | "brief_generated" | "brief_fallback" | "notification" | "decision" | "decision_cleared" | "po_exported"
    | "early_warning" | "rule_conflict" | "drift";
  actor: string;
  detail: Record<string, unknown>;
  at: string;
}
