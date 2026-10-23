"use client";
import { useEffect, useRef, useState } from "react";

interface Ring {
  key: string;
  label: string;
  count: number;
  color: string;
  size: number; // % of stage
  period: number; // seconds per revolution
  reverse?: boolean;
  names: string[];
}

/**
 * The signature object. A lime demand core inside three tilted orbits; every point is one
 * SKU, placed on the orbit for what the engine decided (replenish, in range, overstock).
 * Pure CSS 3D: no library, no canvas. Paused off-screen; still under reduced motion.
 */
export function OrbitCore({ reorder, within, pause, review }: { reorder: string[]; within: string[]; pause: string[]; review: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setPaused(!e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const rings: Ring[] = [
    { key: "reorder", label: "Replenish", count: reorder.length, color: "var(--coral)", size: 46, period: 38, names: reorder },
    { key: "within", label: "In range", count: within.length, color: "var(--lime)", size: 70, period: 64, reverse: true, names: within },
    { key: "pause", label: "Overstock", count: pause.length, color: "var(--amber)", size: 94, period: 96, names: [...pause, ...review] },
  ];
  const summary = `Demand core with three orbits: ${reorder.length} SKUs to replenish, ${within.length} in range, ${pause.length} overstocked${review.length ? `, ${review.length} for planner review` : ""}.`;

  return (
    <div ref={ref} role="img" aria-label={summary} data-paused={paused || undefined}
      className="orbit relative mx-auto aspect-square w-[min(100%,var(--orbit-size,380px))] [container-type:inline-size] [perspective:1100px] [&[data-paused]_*]:[animation-play-state:paused]">
      {/* scene: the orbital plane, tilted towards the viewer */}
      <div className="absolute inset-0 [transform-style:preserve-3d] [transform:rotateX(64deg)_rotateZ(-22deg)]">
        {rings.map((r) => (
          <div key={r.key}
            className="absolute left-1/2 top-1/2 rounded-full border [transform-style:preserve-3d]"
            style={{
              width: `${r.size}%`, height: `${r.size}%`, marginLeft: `-${r.size / 2}%`, marginTop: `-${r.size / 2}%`,
              borderColor: "rgb(158 173 164 / 0.28)",
              animation: `${r.reverse ? "orbit-spin-rev" : "orbit-spin"} ${r.period}s linear infinite`,
            }}>
            {r.names.map((name, i) => {
              const a = (i / Math.max(r.names.length, 1)) * Math.PI * 2 + (r.size / 10);
              const isReview = r.key === "pause" && i >= pause.length;
              return (
                <span key={name + i} title={name}
                  className="absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: `${50 + 50 * Math.cos(a)}%`, top: `${50 + 50 * Math.sin(a)}%`,
                    background: isReview ? "transparent" : r.color,
                    border: isReview ? "1.5px solid var(--sage)" : "none",
                    boxShadow: isReview ? "none" : `0 0 12px ${r.color}`,
                  }} />
              );
            })}
          </div>
        ))}
        {/* the core faces the viewer: undo the plane's tilt */}
        <div className="absolute left-1/2 top-1/2 h-0 w-0 [transform-style:preserve-3d] [transform:rotateZ(22deg)_rotateX(-64deg)]">
          <div className="absolute left-0 top-0 h-[27cqw] w-[27cqw] rounded-full [animation:core-breathe_7s_ease-in-out_infinite]"
            style={{
              transform: "translate(-50%, -50%)",
              background: "radial-gradient(circle at 34% 30%, #f6ffdc 0%, #d9fb8a 18%, #c9f36a 42%, rgb(140 190 50 / 0.85) 68%, rgb(201 243 106 / 0.15) 100%)",
              boxShadow: "0 0 80px 10px rgb(201 243 106 / 0.28), inset -10px -14px 28px rgb(16 27 24 / 0.35)",
            }} />
        </div>
      </div>

      {/* 2D labels: tied to the orbits by position, not rotated with them */}
      <div aria-hidden className="tnum pointer-events-none absolute inset-0 text-[11px] font-semibold uppercase tracking-[0.12em]">
        <span className="absolute left-1/2 top-[57%] -translate-x-1/2 text-forest/70 mix-blend-normal">Demand</span>
        {rings.map((r, i) => (
          <span key={r.key} className="absolute flex items-center gap-1.5 text-sage"
            style={[{ right: "0%", top: "8%" }, { left: "0%", top: "14%" }, { right: "0%", bottom: "14%" }][i]}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
            {r.label} <span className="text-ivory">{r.count}</span>
          </span>
        ))}
        {review.length > 0 && (
          <span className="absolute bottom-[5%] right-[0%] flex items-center gap-1.5 text-sage">
            <span className="h-1.5 w-1.5 rounded-full border border-sage" />Planner review <span className="text-ivory">{review.length}</span>
          </span>
        )}
      </div>
    </div>
  );
}
