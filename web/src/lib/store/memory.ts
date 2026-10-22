import "server-only";
import type { DecisionRecord, EventRecord, RunRecord } from "../types";
import { summarise, type Store } from "./types";

interface Data {
  runs: RunRecord[];
  decisions: DecisionRecord[];
  events: EventRecord[];
}
// Kept on globalThis so dev-server reloads don't wipe it. Without DATABASE_URL, data lives only as long as the process.
const g = globalThis as unknown as { __freshrootsMem?: Data };
const data = () => (g.__freshrootsMem ??= { runs: [], decisions: [], events: [] });

export class MemoryStore implements Store {
  async listRuns() {
    return [...data().runs].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(summarise);
  }
  async getRun(id: string) {
    return data().runs.find((r) => r.id === id) ?? null;
  }
  async latestRunId() {
    return (await this.listRuns())[0]?.id ?? null;
  }
  async createRun(run: RunRecord) {
    if (!data().runs.some((r) => r.id === run.id)) data().runs.push(run);
  }
  async setBrief(runId: string, brief: RunRecord["brief"]) {
    const run = data().runs.find((r) => r.id === runId);
    if (run) run.brief = brief;
  }
  async listDecisions(runId: string) {
    return data().decisions.filter((d) => d.run_id === runId);
  }
  async upsertDecision(d: DecisionRecord) {
    const all = data().decisions;
    const i = all.findIndex((x) => x.run_id === d.run_id && x.sku_id === d.sku_id);
    if (i >= 0) all[i] = d;
    else all.push(d);
  }
  async clearDecision(runId: string, skuId: string) {
    const d = data();
    d.decisions = d.decisions.filter((x) => !(x.run_id === runId && x.sku_id === skuId));
  }
  async addEvent(e: Omit<EventRecord, "id">) {
    const d = data();
    d.events.push({ ...e, id: d.events.length + 1 });
  }
  async listEvents(runId: string, skuId?: string) {
    return data().events.filter((e) => e.run_id === runId && (skuId == null || e.sku_id === skuId)).sort((a, b) => b.at.localeCompare(a.at) || b.id! - a.id!);
  }
}
