import "server-only";
import postgres from "postgres";
import type { DecisionRecord, EventRecord, PlannerBrief, RunRecord } from "../types";
import { summarise, type Store } from "./types";

// prepare:false keeps it compatible with Neon's and Supabase's poolers.
const g = globalThis as unknown as { __freshrootsSql?: postgres.Sql; __freshrootsSchema?: Promise<void> };
const sql = () => (g.__freshrootsSql ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, idle_timeout: 20 }));

const SCHEMA = `
create table if not exists runs (
  id text primary key,
  created_at timestamptz not null default now(),
  created_by text not null,
  source text not null,
  label text not null,
  evaluation_date date not null,
  inputs jsonb not null,
  input_meta jsonb not null,
  result jsonb not null,
  brief jsonb
);
create table if not exists decisions (
  run_id text not null references runs(id) on delete cascade,
  sku_id text not null,
  decision text not null check (decision in ('order','no_order')),
  qty integer not null check (qty >= 0),
  recommended_qty integer not null,
  engine_action text not null,
  actor text not null,
  note text not null default '',
  decided_at timestamptz not null default now(),
  primary key (run_id, sku_id)
);
create table if not exists events (
  id bigserial primary key,
  run_id text not null references runs(id) on delete cascade,
  sku_id text,
  kind text not null,
  actor text not null,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);
create index if not exists events_run_idx on events (run_id, at desc);
create index if not exists events_kind_idx on events (kind, at desc);
alter table runs add column if not exists base_run_id text;
alter table runs add column if not exists scenario jsonb;
`;

async function db() {
  g.__freshrootsSchema ??= sql().unsafe(SCHEMA).then(() => undefined);
  await g.__freshrootsSchema;
  return sql();
}

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const json = (v: unknown) => sql().json(v as never);

const toRun = (r: Row): RunRecord => ({
  id: r.id as string,
  created_at: iso(r.created_at),
  created_by: r.created_by as string,
  source: r.source as RunRecord["source"],
  label: r.label as string,
  evaluation_date: day(r.evaluation_date),
  inputs: r.inputs as RunRecord["inputs"],
  input_meta: r.input_meta as RunRecord["input_meta"],
  result: r.result as RunRecord["result"],
  brief: (r.brief as PlannerBrief) ?? null,
  base_run_id: (r.base_run_id as string) ?? null,
  scenario: (r.scenario as RunRecord["scenario"]) ?? null,
});
const toDecision = (r: Row): DecisionRecord => ({
  run_id: r.run_id as string, sku_id: r.sku_id as string, decision: r.decision as DecisionRecord["decision"],
  qty: Number(r.qty), recommended_qty: Number(r.recommended_qty), engine_action: r.engine_action as string,
  actor: r.actor as string, note: r.note as string, decided_at: iso(r.decided_at),
});
const toEvent = (r: Row): EventRecord => ({
  id: Number(r.id), run_id: r.run_id as string, sku_id: (r.sku_id as string) ?? null, kind: r.kind as EventRecord["kind"],
  actor: r.actor as string, detail: (r.detail as Record<string, unknown>) ?? {}, at: iso(r.at),
});

export class PostgresStore implements Store {
  async listRuns() {
    const s = await db();
    const rows = await s`select * from runs order by created_at desc limit 100`;
    return rows.map((r) => summarise(toRun(r)));
  }
  async getRun(id: string) {
    const s = await db();
    const [r] = await s`select * from runs where id = ${id}`;
    return r ? toRun(r) : null;
  }
  async latestRunId() {
    const s = await db();
    const [r] = await s`select id from runs where source <> 'scenario' order by created_at desc limit 1`;
    return (r?.id as string) ?? null;
  }
  async createRun(run: RunRecord) {
    const s = await db();
    await s`insert into runs (id, created_at, created_by, source, label, evaluation_date, inputs, input_meta, result, brief, base_run_id, scenario)
      values (${run.id}, ${run.created_at}, ${run.created_by}, ${run.source}, ${run.label}, ${run.evaluation_date},
              ${json(run.inputs)}, ${json(run.input_meta)}, ${json(run.result)}, ${run.brief ? json(run.brief) : null},
              ${run.base_run_id ?? null}, ${run.scenario ? json(run.scenario) : null})
      on conflict (id) do nothing`;
  }
  async setBrief(runId: string, brief: PlannerBrief) {
    const s = await db();
    await s`update runs set brief = ${json(brief)} where id = ${runId}`;
  }
  async listDecisions(runId: string) {
    const s = await db();
    return (await s`select * from decisions where run_id = ${runId}`).map(toDecision);
  }
  async upsertDecision(d: DecisionRecord) {
    const s = await db();
    await s`insert into decisions (run_id, sku_id, decision, qty, recommended_qty, engine_action, actor, note, decided_at)
      values (${d.run_id}, ${d.sku_id}, ${d.decision}, ${d.qty}, ${d.recommended_qty}, ${d.engine_action}, ${d.actor}, ${d.note}, ${d.decided_at})
      on conflict (run_id, sku_id) do update set decision = excluded.decision, qty = excluded.qty, actor = excluded.actor,
        note = excluded.note, decided_at = excluded.decided_at`;
  }
  async clearDecision(runId: string, skuId: string) {
    const s = await db();
    await s`delete from decisions where run_id = ${runId} and sku_id = ${skuId}`;
  }
  async addEvent(e: Omit<EventRecord, "id">) {
    const s = await db();
    await s`insert into events (run_id, sku_id, kind, actor, detail, at) values (${e.run_id}, ${e.sku_id}, ${e.kind}, ${e.actor}, ${json(e.detail)}, ${e.at})`;
  }
  async listEvents(runId: string, skuId?: string) {
    const s = await db();
    const rows = skuId == null
      ? await s`select * from events where run_id = ${runId} order by at desc, id desc limit 200`
      : await s`select * from events where run_id = ${runId} and sku_id = ${skuId} order by at desc, id desc`;
    return rows.map(toEvent);
  }
  async listEventsByKind(kinds: EventRecord["kind"][], limit = 500) {
    const s = await db();
    return (await s`select * from events where kind = any(${kinds}) order by at desc, id desc limit ${limit}`).map(toEvent);
  }
  async listDecisionsForRuns(runIds: string[]) {
    if (!runIds.length) return [];
    const s = await db();
    return (await s`select * from decisions where run_id = any(${runIds})`).map(toDecision);
  }
}
