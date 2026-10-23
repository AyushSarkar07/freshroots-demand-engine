import { demandTrend, TREND_LABEL } from "@/lib/insights";
import type { Recommendation } from "@/lib/engine/engine";

const TREND_TONE: Record<string, string> = {
  surge: "bg-crit-soft text-crit",
  rising: "bg-warn-soft text-warn",
  stable: "bg-ok-soft text-ok",
  falling: "bg-paper-3 text-ink-2",
  unavailable: "bg-paper-3 text-muted",
};

/**
 * Demand pulse: the last 12 weekly sales (real history), the 12-week average across the
 * window and the 4-week average across its last 4 weeks. The ratio and surge flag are the
 * engine's own values. With fewer than 12 weeks it says so instead of drawing a partial line.
 */
export function DemandPulse({ rec, history, threshold, longWeeks = 12, shortWeeks = 4, dark = false, height = 72 }: {
  rec: Pick<Recommendation, "avg_12w_sales" | "avg_4w_sales" | "demand_ratio" | "demand_spurt_flag">;
  history: { week: string; units: number }[];
  threshold: number;
  longWeeks?: number;
  shortWeeks?: number;
  dark?: boolean;
  height?: number;
}) {
  const pts = history.slice(-longWeeks);
  const trend = demandTrend(rec);
  const tone = dark ? "text-mist" : "text-muted";

  if (pts.length < longWeeks || rec.avg_12w_sales == null || rec.avg_4w_sales == null) {
    return (
      <div className={`rounded-[var(--radius)] border border-dashed ${dark ? "border-night-line text-mist" : "border-line-strong text-muted"} px-3 py-4 text-center text-[12.5px]`}>
        Not enough weekly history to compare the last {shortWeeks} weeks with a {longWeeks}-week baseline ({pts.length} of {longWeeks} weeks available).
      </div>
    );
  }

  const W = 300, H = height, P = 6;
  const max = Math.max(...pts.map((p) => p.units), rec.avg_12w_sales, rec.avg_4w_sales) * 1.08 || 1;
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.units).toFixed(1)}`).join(" ");
  const recentStart = pts.length - shortWeeks;
  const recent = pts.slice(recentStart).map((p, i) => `${i ? "L" : "M"}${x(recentStart + i).toFixed(1)},${y(p.units).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - P} L${x(0).toFixed(1)},${H - P} Z`;
  const base = dark ? "var(--mist)" : "var(--series)";
  const hot = dark ? "var(--spice)" : trend === "surge" ? "var(--crit)" : "var(--night)";

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img"
        aria-label={`Weekly units sold, ${pts[0].week} to ${pts[pts.length - 1].week}. 12-week average ${rec.avg_12w_sales.toFixed(1)}, 4-week average ${rec.avg_4w_sales.toFixed(1)}, ratio ${rec.demand_ratio?.toFixed(2)}.`}>
        <rect x={x(recentStart) - 4} y={0} width={W - x(recentStart) + 4} height={H} fill={dark ? "rgb(245 180 39 / 0.09)" : "var(--series-soft)"} rx={4} />
        <path d={area} fill={dark ? "rgb(199 181 196 / 0.10)" : "rgb(90 61 92 / 0.06)"} />
        <line x1={x(0)} x2={x(pts.length - 1)} y1={y(rec.avg_12w_sales)} y2={y(rec.avg_12w_sales)} stroke={base} strokeOpacity={0.7} strokeWidth={1} />
        <line x1={x(recentStart)} x2={x(pts.length - 1)} y1={y(rec.avg_4w_sales)} y2={y(rec.avg_4w_sales)} stroke={hot} strokeWidth={1.5} />
        <path d={line} fill="none" stroke={base} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        <path d={recent} fill="none" stroke={hot} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].units)} r={3.5} fill={hot} stroke={dark ? "var(--night-2)" : "var(--paper-2)"} strokeWidth={2} />
      </svg>
      <figcaption className={`mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11.5px] ${tone}`}>
        <span className="tnum">{pts[0].week.slice(5)}–{pts[pts.length - 1].week.slice(5)} · 12-wk avg {rec.avg_12w_sales.toFixed(1)} · 4-wk avg {rec.avg_4w_sales.toFixed(1)}</span>
        <span className={`tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${dark ? (trend === "surge" ? "bg-under/20 text-under" : "bg-night-3 text-cream") : TREND_TONE[trend]}`}
          title={trend === "surge" ? `Above the ${threshold.toFixed(2)} surge line: reorder is sized ×1.5` : "Rising/falling = ±5% or more; only the surge line changes a decision"}>
          {rec.demand_ratio != null ? `${rec.demand_ratio.toFixed(2)}×` : ""} {TREND_LABEL[trend]}
        </span>
      </figcaption>
    </figure>
  );
}
