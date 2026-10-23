import { coverState, gaugeScale, type CoverRange } from "@/lib/insights";
import { units } from "@/lib/format";
import { Tip } from "./ui";

const MARK: Record<string, { fill: string; text: string; word: string }> = {
  below: { fill: "var(--under)", text: "text-crit", word: "Below reorder point" },
  within: { fill: "var(--ok)", text: "text-ok", word: "In target range" },
  above: { fill: "var(--over)", text: "text-over-ink", word: "Above overstock limit" },
  unknown: { fill: "var(--mist)", text: "text-muted", word: "Cover unknown" },
};

/**
 * Stock-cover instrument: weeks of stock against the SKU's own range. Three zones
 * (reorder | target | overstock); the marker glides when the value changes.
 */
export function CoverGauge({ weeks, range, onHand, demand, size = "sm" }: {
  weeks: number | null; range: CoverRange; onHand?: number | null; demand?: number | null; size?: "sm" | "lg";
}) {
  const s = gaugeScale(weeks, range);
  const state = coverState(weeks, range);
  const m = MARK[state];
  const tip = weeks == null
    ? "Weeks of stock can't be computed for this SKU."
    : `${weeks.toFixed(2)} weeks of stock${onHand != null && demand ? ` (${units(onHand)} units ÷ ${demand.toFixed(1)}/wk)` : ""}. Reorder below ${range.lo} weeks; overstock above ${range.hi} weeks.`;
  const lg = size === "lg";

  return (
    <Tip label={tip} block>
      <div tabIndex={0} aria-label={`${m.word}. ${tip}`} className={`relative w-full rounded-sm ${lg ? "pb-6 pt-1" : "py-1"} ${lg ? "min-w-[260px]" : "min-w-[132px]"}`}>
        <div className={`relative flex w-full overflow-hidden rounded-full ${lg ? "h-3" : "h-2"}`}>
          <span className="h-full bg-crit-soft" style={{ width: `${s.lo}%` }} />
          <span className="h-full bg-ok-soft" style={{ width: `${s.hi - s.lo}%`, boxShadow: "inset 0 0 0 1px rgb(59 102 38 / 0.3)" }} />
          <span className="h-full flex-1 bg-over-soft" />
        </div>
        {/* boundary ticks */}
        {[s.lo, s.hi].map((p, i) => (
          <span key={i} aria-hidden className={`absolute w-px bg-line-strong ${lg ? "top-0 h-5" : "top-0.5 h-3"}`} style={{ left: `${p}%` }} />
        ))}
        {lg && (
          <div aria-hidden className="tnum pointer-events-none absolute inset-x-0 bottom-0 text-[11px] text-muted">
            <span className="absolute -translate-x-1/2" style={{ left: `${s.lo}%` }}>{range.lo}</span>
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${s.hi}%` }}>{range.hi} wks</span>
            <span className="absolute left-0">0</span>
          </div>
        )}
        {s.marker != null && (
          <span aria-hidden
            className={`absolute -translate-x-1/2 rounded-full border-2 border-paper-2 shadow-[0_1px_3px_rgb(27_17_32/0.35)] transition-[left] duration-300 ease-[var(--ease)] ${lg ? "top-[-3px] h-[18px] w-[18px]" : "top-0 h-4 w-4"}`}
            style={{ left: `${s.marker}%`, background: m.fill }} />
        )}
      </div>
    </Tip>
  );
}

export function coverWord(weeks: number | null, range: CoverRange) {
  const st = coverState(weeks, range);
  return { ...MARK[st], state: st };
}
