import Link from "next/link";
import { EmptyState, PageHeader, Panel, Tag } from "@/components/ui";
import { ALERT_LABEL, type Alert } from "@/lib/compare";
import { CONFLICT_LABEL, detectConflicts, type ConflictCode } from "@/lib/conflicts";
import { approvalStats } from "@/lib/decisions";
import { fmtDate, fmtDateTime, pct } from "@/lib/format";
import { ADOPTION, CONFLICT_POLICY, PEOPLE, PLAYBOOK } from "@/lib/governance";
import { ensureSeeded } from "@/lib/runs";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const who = (k: keyof typeof PEOPLE) => <span className="whitespace-nowrap"><b className="font-semibold text-ink">{PEOPLE[k].name}</b> <span className="text-muted">· {PEOPLE[k].role}</span></span>;

export default async function Oversight() {
  await ensureSeeded();
  const store = getStore();
  const summaries = await store.listRuns();
  const real = summaries.filter((r) => r.source !== "scenario");
  const runs = (await Promise.all(real.slice(0, 26).map((r) => store.getRun(r.id)))).filter((r) => r != null);
  const [decisions, warnings, drift] = await Promise.all([
    store.listDecisionsForRuns(runs.map((r) => r.id)),
    store.listEventsByKind(["early_warning"], 200),
    store.listEventsByKind(["drift"], 200),
  ]);

  // Outcomes per run (oldest first): stock position and how people used the recommendations.
  const outcomes = [...runs].reverse().map((r) => {
    const k = r.result.summary.operational_kpis;
    const s = approvalStats(r, decisions.filter((d) => d.run_id === r.id));
    return { id: r.id, date: r.evaluation_date, label: r.label, inRange: k.total_skus_in_master ? k.optimal_level_skus / k.total_skus_in_master : null,
      stockout: k.stockout_risk_skus, overstock: k.overstock_risk_skus, review: k.skus_requiring_manual_review, decided: `${s.decided}/${s.actionable}`, override: s.overrideRate };
  });

  // Conflict log: every instance in every real run, grouped by month for the monthly review.
  const conflicts = runs.flatMap((r) => detectConflicts(r.result).map((c) => ({ ...c, run: r })));
  const byMonth = new Map<string, typeof conflicts>();
  for (const c of conflicts) {
    const m = c.run.evaluation_date.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), c]);
  }

  return (
    <>
      <PageHeader eyebrow="Oversight" title="Is it still right? Is anyone still reading it?"
        sub="The monthly review in one place: outcomes over time, every early warning and rule conflict, what to do when the world changes, and who owns each piece." />

      <div className="mx-auto max-w-[1320px] space-y-6 px-4 py-8 sm:px-8 lg:px-10">
        <Panel eyebrow="Outcomes, not usage" title="Stock position and decisions, run by run"
          sub="Tracks what the business needs: SKUs in range, stockout and overstock risk, and how often people override the rules. It deliberately doesn't count logins, clicks or AI usage, which are easy to game.">
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.1em] text-muted">
                <th className="py-2 pl-6 font-semibold">Run</th><th className="px-3 py-2 text-right font-semibold">In range</th><th className="px-3 py-2 text-right font-semibold">Stockout risk</th>
                <th className="px-3 py-2 text-right font-semibold">Overstock</th><th className="px-3 py-2 text-right font-semibold">Planner review</th><th className="px-3 py-2 text-right font-semibold">Decided</th><th className="py-2 pl-3 pr-6 text-right font-semibold">Override rate</th>
              </tr></thead>
              <tbody>
                {outcomes.map((o) => (
                  <tr key={o.id} className="tnum border-b border-line last:border-0">
                    <td className="py-2.5 pl-6"><Link href={`/?run=${o.id}`} className="font-semibold hover:underline">{fmtDate(o.date)}</Link><div className="text-[12px] text-muted">{o.label}</div></td>
                    <td className="px-3 py-2.5 text-right font-semibold">{pct(o.inRange)}</td>
                    <td className="px-3 py-2.5 text-right">{o.stockout}</td><td className="px-3 py-2.5 text-right">{o.overstock}</td>
                    <td className="px-3 py-2.5 text-right">{o.review}</td><td className="px-3 py-2.5 text-right">{o.decided}</td>
                    <td className={`py-2.5 pl-3 pr-6 text-right font-semibold ${o.override != null && o.override > 0.3 ? "text-crit" : ""}`}>{pct(o.override)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] text-muted">{outcomes.length < 3 ? `Only ${outcomes.length} real run${outcomes.length === 1 ? "" : "s"} so far; a trend needs a few weeks of twice-weekly runs. ` : ""}An override rate above 30% is the kill-criterion signal from the decision memo: the written rules no longer match how planners decide.</p>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel eyebrow="Trust drift" title="Early-warning log" sub="Unusual shifts between consecutive runs, sent to procurement with the run alert. Scenario-run warnings are labelled as simulations.">
            {warnings.length ? (
              <ol className="space-y-3">
                {warnings.slice(0, 30).map((e) => {
                  const d = e.detail as unknown as Alert & { scenario?: boolean };
                  return (
                    <li key={e.id} className="text-[13px]">
                      <div className="flex flex-wrap items-center gap-2"><Tag tone={d.severity === "high" ? "crit" : "warn"}>{d.severity}</Tag>{d.scenario && <Tag tone="lime">simulation</Tag>}<b className="font-semibold">{d.name}</b><span className="text-muted">· {ALERT_LABEL[d.code] ?? d.code}</span></div>
                      <p className="mt-0.5 text-ink-2">{d.detail}</p>
                      <div className="text-[12px] text-muted">{fmtDateTime(e.at)} · <Link className="hover:underline" href={`/compare?run=${e.run_id}`}>comparison</Link></div>
                    </li>
                  );
                })}
              </ol>
            ) : <EmptyState title="No early warnings yet">They appear when a new export (or a scenario) shifts a recommendation sharply against the run before it.</EmptyState>}
          </Panel>

          <Panel eyebrow="Data drift" title="Drift log" sub="New or removed SKUs and distributors, and changed export columns: the assumptions that silently break a model.">
            {drift.length ? (
              <ul className="space-y-2 text-[13px]">
                {drift.slice(0, 30).map((e) => (
                  <li key={e.id} className="flex gap-2"><Tag tone={e.detail.scenario ? "lime" : "plain"}>{String(e.detail.code).replace(/_/g, " ").toLowerCase()}</Tag><span className="text-ink-2">{String(e.detail.detail)} <span className="text-muted">· {fmtDateTime(e.at)}</span></span></li>
                ))}
              </ul>
            ) : <EmptyState title="No drift recorded">Drift is checked every time a run follows another.</EmptyState>}
          </Panel>
        </div>

        <Panel eyebrow="Monthly review" title="Rule-conflict log"
          sub="Every place two rules pulled in different directions, in every real run, grouped by month. The engine applies the documented winner; the review decides whether a rule should change.">
          {conflicts.length ? (
            <div className="space-y-5">
              {[...byMonth.entries()].map(([month, list]) => (
                <div key={month}>
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })} · {list.length} instance{list.length === 1 ? "" : "s"}</div>
                  <ul className="divide-y divide-line rounded-[var(--radius-lg)] border border-line">
                    {list.map((c, i) => (
                      <li key={i} className="grid gap-x-4 gap-y-1 px-4 py-3 text-[13px] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                        <div><b className="font-semibold">{c.name}</b> <span className="text-muted">· {CONFLICT_LABEL[c.code]} · run of {fmtDate(c.run.evaluation_date)}</span><p className="text-ink-2">{c.detail}</p></div>
                        <div className="text-[12.5px] text-ink-2"><b className="font-semibold text-ink">Winner:</b> {CONFLICT_POLICY[c.code].winner}<br /><b className="font-semibold text-ink">Review:</b> {CONFLICT_POLICY[c.code].review}<br /><span className="text-muted">Owner: {PEOPLE[CONFLICT_POLICY[c.code].owner].name}</span></div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No conflicts">No two rules have disagreed in any run so far.</EmptyState>}
          <p className="mt-4 text-[12px] text-muted">Known conflict types and their precedence are written into the rulebook ({(Object.keys(CONFLICT_POLICY) as ConflictCode[]).length} mapped before go-live). <Link href="/rules#rulebook" className="font-semibold text-ok hover:underline">Open the conflict map →</Link></p>
        </Panel>

        <Panel eyebrow="When the world doesn't match the model" title="Failure playbook"
          sub="Each failure has a signal in the app, a safe automatic behaviour, an override decided in advance, and a named owner.">
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[900px] text-[12.5px]">
              <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.1em] text-muted">
                <th className="py-2 pl-6 font-semibold">Failure</th><th className="px-3 py-2 font-semibold">How it shows up</th><th className="px-3 py-2 font-semibold">What the system does</th><th className="px-3 py-2 font-semibold">Override</th><th className="py-2 pl-3 pr-6 font-semibold">Owner</th>
              </tr></thead>
              <tbody>
                {PLAYBOOK.map((p) => (
                  <tr key={p.scenario} className="border-b border-line align-top last:border-0">
                    <td className="py-3 pl-6 font-semibold">{p.scenario}</td><td className="px-3 py-3 text-ink-2">{p.signal}</td><td className="px-3 py-3 text-ink-2">{p.automatic}</td>
                    <td className="px-3 py-3 text-ink-2">{p.override}</td><td className="py-3 pl-3 pr-6">{who(p.owner)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel eyebrow="Adoption" title="Who owns what">
            <dl className="space-y-3 text-[13px]">
              <div><dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Champion</dt><dd>{who(ADOPTION.champion.person)}<p className="text-ink-2">{ADOPTION.champion.why}</p></dd></div>
              <div><dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Sponsor</dt><dd>{who(ADOPTION.sponsor.person)}<p className="text-ink-2">{ADOPTION.sponsor.why}</p></dd></div>
              <div><dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Accountable for</dt>
                <dd><ul className="mt-1 space-y-1.5">{ADOPTION.accountability.map((a) => <li key={a.who}>{who(a.who)}<span className="text-ink-2">: {a.for}</span></li>)}</ul></dd></div>
            </dl>
          </Panel>
          <Panel eyebrow="Adoption" title="Incentives and people">
            <h3 className="text-[13px] font-semibold">Measure outcomes, and don&apos;t punish the AI-assisted way of working</h3>
            <ul className="mt-1.5 space-y-1.5 text-[13px] text-ink-2">{ADOPTION.incentives.map((t) => <li key={t} className="flex gap-2"><span aria-hidden className="mt-2 h-1 w-3 shrink-0 rounded-full bg-spice-deep" />{t}</li>)}</ul>
            <h3 className="mt-4 text-[13px] font-semibold">What changes for people</h3>
            <ul className="mt-1.5 space-y-1.5 text-[13px] text-ink-2">{ADOPTION.people.map((t) => <li key={t} className="flex gap-2"><span aria-hidden className="mt-2 h-1 w-3 shrink-0 rounded-full bg-spice-deep" />{t}</li>)}</ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
