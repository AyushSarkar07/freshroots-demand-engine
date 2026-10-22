import { ACTION_META } from "./ui";

/**
 * Weeks of stock against the SKU's allowed range. The shaded band is the range the
 * rules treat as healthy; the dot is current cover, coloured by the resulting action.
 */
export function CoverBar({ cover, lo, hi, action, width = 150, labels = false }: {
  cover: number | null; lo: number; hi: number; action: string; width?: number; labels?: boolean;
}) {
  const max = Math.max(hi * 1.6, (cover ?? 0) * 1.08, 1);
  const x = (v: number) => 6 + (Math.min(v, max) / max) * (width - 12);
  const tone = ACTION_META[action]?.tone ?? "good";
  const h = labels ? 34 : 18;
  return (
    <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} role="img"
      aria-label={cover == null ? "Cover unknown" : `${cover.toFixed(1)} weeks of stock; allowed range ${lo} to ${hi} weeks`}>
      <rect x={6} y={6} width={width - 12} height={6} rx={3} fill="var(--grid)" />
      <rect x={x(lo)} y={6} width={x(hi) - x(lo)} height={6} fill="var(--good-soft)" stroke="var(--good)" strokeOpacity={0.35} strokeWidth={1} />
      {cover != null && <circle cx={x(cover)} cy={9} r={5} fill={`var(--${tone})`} stroke="var(--card)" strokeWidth={2} />}
      {labels && (
        <g fontSize={10.5} fill="var(--muted)" className="tnum">
          <text x={x(lo)} y={30} textAnchor="middle">{lo}</text>
          <text x={x(hi)} y={30} textAnchor="middle">{hi} wks</text>
        </g>
      )}
    </svg>
  );
}
