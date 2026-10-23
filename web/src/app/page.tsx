import Link from "next/link";
import { ControlRoom } from "@/components/ControlRoom";
import { OrbitCore } from "@/components/OrbitCore";
import { EmptyState, StatusDot, buttonClass } from "@/components/ui";
import { approvalStats } from "@/lib/decisions";
import { fmtDate } from "@/lib/format";
import { freshness, groups, shortName } from "@/lib/insights";
import { loadRun } from "@/lib/runs";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Decisions({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const run = await loadRun(typeof sp.run === "string" ? sp.run : null);
  if (!run) {
    return (
      <div className="px-5 py-16 sm:px-8 lg:px-10">
        <EmptyState title="No runs yet" action={<Link className={buttonClass()} href="/data">Upload an SAP export</Link>}>
          Upload the five SAP exports and the engine will recommend a decision for every SKU.
        </EmptyState>
      </div>
    );
  }

  const decisions = await getStore().listDecisions(run.id);
  const r = run.result;
  const stats = approvalStats(run, decisions);
  const fresh = freshness(r);
  const g = groups(r.recommendations);
  const uplift = r.recommendations[0]?.seasonal_uplift_pct ?? 0;
  const cal = r.calendar;
  const calendarAgrees = cal.evaluation_month_calendar_festival == null ? null : cal.evaluation_month_calendar_festival === cal.evaluation_month_rule_festival;
  const names = (xs: typeof g.reorder) => xs.map((x) => shortName(x.SKU_Name));

  return (
    <>
      <section className="on-dark relative overflow-hidden bg-forest text-ivory">
        <div aria-hidden className="coord-grid pointer-events-none absolute inset-0" />
        <div aria-hidden className="pointer-events-none absolute right-[-10%] top-[-30%] h-[620px] w-[620px] rounded-full bg-[radial-gradient(circle,rgb(201_243_106/0.13),transparent_62%)]" />
        <div className="relative mx-auto grid max-w-[1320px] items-center gap-6 px-5 pb-20 pt-8 sm:px-8 sm:pb-24 sm:pt-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:px-10 lg:pb-28 lg:pt-14">
          <div>
            <div className="reveal reveal-1 text-[11.5px] font-semibold uppercase tracking-[0.22em] text-sage">Freshroots / Reorder intelligence</div>
            <h1 className="reveal reveal-2 mt-4 font-display text-[clamp(46px,7vw,92px)] font-semibold leading-[0.92] tracking-[-0.035em]">
              Demand moves.<br /><span className="text-lime">Stay ahead.</span>
            </h1>
            <p className="reveal reveal-3 mt-5 max-w-[46ch] text-[16px] leading-relaxed text-sage sm:text-[17px]">
              Every SKU has a signal. See what needs action before it becomes a supply problem.
            </p>
            <dl className="reveal reveal-4 mt-7 flex flex-wrap gap-x-6 gap-y-3 text-[12.5px]">
              <div>
                <dt className="sr-only">System status</dt>
                <dd><StatusDot tone={fresh.status}>{fresh.statusText}</StatusDot></dd>
              </div>
              <div className="flex gap-1.5"><dt className="text-sage">Evaluated</dt><dd className="tnum font-semibold">{fmtDate(run.evaluation_date)}</dd></div>
              <div className="flex gap-1.5"><dt className="text-sage">Stock as of</dt><dd className="tnum font-semibold">{fresh.snapshot ? fmtDate(fresh.snapshot) : "—"}{fresh.snapshotAgeDays != null && <span className="font-normal text-sage"> ({fresh.snapshotAgeDays}d before)</span>}</dd></div>
              <div className="flex gap-1.5"><dt className="text-sage">Sales through</dt><dd className="tnum font-semibold">{r.sales_cutoff_week}</dd></div>
              <div className="flex gap-1.5"><dt className="text-sage">Seasonal</dt><dd className="font-semibold">{uplift ? <span className="text-lime">+{uplift}% festival uplift</span> : "No uplift"}</dd></div>
            </dl>
          </div>
          <div className="reveal reveal-5 relative mx-auto -mb-4 w-full max-w-[240px] [--orbit-size:400px] sm:mb-0 sm:max-w-[300px] lg:max-w-[400px]">
            <OrbitCore reorder={names(g.reorder)} within={names(g.within)} pause={names(g.pause)} review={names(g.review)} />
          </div>
        </div>
      </section>

      <div className="relative z-10 mx-auto -mt-16 max-w-[1320px] px-4 pb-12 sm:px-8 lg:px-10">
        <ControlRoom runId={run.id} recs={r.recommendations} decisions={decisions} config={r.config} history={r.history}
          distributors={r.distributors} brief={run.brief} fresh={fresh} calendarAgrees={calendarAgrees}
          stats={stats} initialSku={typeof sp.sku === "string" ? sp.sku : null} />
      </div>
    </>
  );
}
