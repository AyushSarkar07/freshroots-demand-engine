import type { DecisionRecord, EventRecord, PlannerBrief, RunRecord, RunSummary } from "../types";

export interface Store {
  listRuns(): Promise<RunSummary[]>;
  getRun(id: string): Promise<RunRecord | null>;
  latestRunId(): Promise<string | null>;
  createRun(run: RunRecord): Promise<void>;
  setBrief(runId: string, brief: PlannerBrief): Promise<void>;
  listDecisions(runId: string): Promise<DecisionRecord[]>;
  upsertDecision(d: DecisionRecord): Promise<void>;
  clearDecision(runId: string, skuId: string): Promise<void>;
  addEvent(e: Omit<EventRecord, "id">): Promise<void>;
  listEvents(runId: string, skuId?: string): Promise<EventRecord[]>;
}

export function summarise(run: RunRecord): RunSummary {
  const dq = run.result.summary.data_quality;
  return {
    id: run.id, created_at: run.created_at, created_by: run.created_by, source: run.source, label: run.label,
    evaluation_date: run.evaluation_date, kpis: run.result.summary.operational_kpis,
    sales_cutoff_week: run.result.sales_cutoff_week, dq_errors: dq.errors, dq_warnings: dq.warnings,
  };
}
