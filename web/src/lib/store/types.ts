import type { DecisionRecord, EventRecord, PlannerBrief, RunRecord, RunSummary } from "../types";

export interface Store {
  listRuns(): Promise<RunSummary[]>;
  getRun(id: string): Promise<RunRecord | null>;
  /** Latest real run: scenarios are never the default view. */
  latestRunId(): Promise<string | null>;
  createRun(run: RunRecord): Promise<void>;
  setBrief(runId: string, brief: PlannerBrief): Promise<void>;
  listDecisions(runId: string): Promise<DecisionRecord[]>;
  upsertDecision(d: DecisionRecord): Promise<void>;
  clearDecision(runId: string, skuId: string): Promise<void>;
  addEvent(e: Omit<EventRecord, "id">): Promise<void>;
  listEvents(runId: string, skuId?: string): Promise<EventRecord[]>;
  /** Events of the given kinds across all runs, newest first (the oversight logs). */
  listEventsByKind(kinds: EventRecord["kind"][], limit?: number): Promise<EventRecord[]>;
  listDecisionsForRuns(runIds: string[]): Promise<DecisionRecord[]>;
}

export function summarise(run: RunRecord): RunSummary {
  const dq = run.result.summary.data_quality;
  return {
    id: run.id, created_at: run.created_at, created_by: run.created_by, source: run.source, label: run.label, base_run_id: run.base_run_id ?? null,
    evaluation_date: run.evaluation_date, kpis: run.result.summary.operational_kpis,
    sales_cutoff_week: run.result.sales_cutoff_week, dq_errors: dq.errors, dq_warnings: dq.warnings,
  };
}
