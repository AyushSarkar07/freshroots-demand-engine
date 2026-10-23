"use client";
import { useState } from "react";

/**
 * Weekly units sold. Weeks inside the 12-week baseline window are full colour; older weeks
 * are faded. Reference lines: the 12-week average across its window, the 4-week average
 * across its window, and the seasonally adjusted baseline used for cover.
 */
export function SalesChart({ history, avg12, avg4, baseline, longWeeks = 12, shortWeeks = 4 }: {
  history: { week: string; units: number }[];
  avg12: number | null;
  avg4: number | null;
  baseline: number | null;
  longWeeks?: number;
  shortWeeks?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!history.length) return <div className="py-10 text-center text-[13px] text-muted">No sales history.</div>;

  const W = 680, H = 240, L = 40, R = 118, T = 12, B = 28;
  const pw = W - L - R, ph = H - T - B;
  const rawMax = Math.max(...history.map((h) => h.units), avg12 ?? 0, avg4 ?? 0, baseline ?? 0, 1);
  const step = niceStep(rawMax / 4);
  const yMax = Math.ceil(rawMax / step) * step;
  const y = (v: number) => T + ph - (v / yMax) * ph;
  const slot = pw / history.length;
  const bw = Math.min(24, slot - 2);
  const x = (i: number) => L + i * slot + (slot - bw) / 2;
  const n = history.length;
  const longStart = Math.max(0, n - longWeeks);
  const shortStart = Math.max(0, n - shortWeeks);
  const ticks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step);

  // Reference lines, with right-edge labels spaced at least 13px apart and tied back by a leader.
  const refs = [
    { v: avg12, from: longStart, label: "12-wk avg", color: "var(--ink-2)" },
    { v: avg4, from: shortStart, label: "4-wk avg", color: "var(--ink)" },
    ...(baseline != null && avg12 != null && Math.abs(baseline - avg12) > 0.05 ? [{ v: baseline, from: longStart, label: "Baseline", color: "var(--warn)" }] : []),
  ].filter((l): l is { v: number; from: number; label: string; color: string } => l.v != null)
    .map((l) => ({ ...l, ly: y(l.v) }))
    .sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < refs.length; i++) refs[i].ly = Math.max(refs[i].ly, refs[i - 1].ly + 13);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Weekly units sold for ${n} weeks. 12-week average ${avg12?.toFixed(1)}, 4-week average ${avg4?.toFixed(1)}.`}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={L + pw} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} fontSize={10.5} textAnchor="end" fill="var(--muted)" className="tnum">{t >= 1000 ? `${t / 1000}K` : t}</text>
          </g>
        ))}
        <rect x={L + shortStart * slot} y={T} width={(n - shortStart) * slot} height={ph} fill="var(--series-soft)" />
        {history.map((h, i) => {
          const top = y(h.units);
          const height = T + ph - top;
          const r = Math.min(4, height);
          return (
            <g key={h.week} onMouseEnter={() => setHover(i)}>
              <rect x={L + i * slot} y={T} width={slot} height={ph} fill="transparent" />
              <path
                d={`M${x(i)},${T + ph} V${top + r} Q${x(i)},${top} ${x(i) + r},${top} H${x(i) + bw - r} Q${x(i) + bw},${top} ${x(i) + bw},${top + r} V${T + ph} Z`}
                fill="var(--series)" opacity={i < longStart ? 0.35 : hover === i ? 0.8 : 1}
              />
            </g>
          );
        })}
        <line x1={L} x2={L + pw} y1={T + ph} y2={T + ph} stroke="var(--axis)" strokeWidth={1} />
        {refs.map((l) => (
          <g key={l.label}>
            <line x1={L + l.from * slot} x2={L + pw} y1={y(l.v)} y2={y(l.v)} stroke={l.color} strokeWidth={2} strokeLinecap="round" />
            <line x1={L + pw + 1} x2={L + pw + 8} y1={y(l.v)} y2={l.ly} stroke={l.color} strokeWidth={1} />
            <rect x={L + pw + 10} y={l.ly - 2} width={8} height={2} fill={l.color} />
            <text x={L + pw + 22} y={l.ly + 4} fontSize={11} fill="var(--ink-2)" className="tnum">{l.label} {l.v.toFixed(1)}</text>
          </g>
        ))}
        {history.map((h, i) => (i % 2 === (n - 1) % 2 ? (
          <text key={h.week} x={L + i * slot + slot / 2} y={H - 8} fontSize={10.5} textAnchor="middle" fill="var(--muted)">{h.week.slice(5)}</text>
        ) : null))}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-line bg-paper-2 px-2 py-1 text-[12px] shadow-[var(--shadow-2)]"
          style={{ left: `${((L + hover * slot + slot / 2) / W) * 100}%`, top: 0 }}>
          <div className="font-medium">{history[hover].week}</div>
          <div className="tnum text-ink-2">{history[hover].units.toLocaleString("en-IN")} units</div>
          {hover < longStart && <div className="text-muted">outside the 12-wk window</div>}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
        <span>Bars: units sold per week (faded = before the 12-week window)</span>
        <span>Shaded: last 4 weeks</span>
      </div>
    </div>
  );
}

function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
