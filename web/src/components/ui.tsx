import type { ReactNode } from "react";

export function Card({ title, sub, children, className = "", right }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-line bg-card p-4 sm:p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[14px] font-semibold">{title}</h2>}
            {sub && <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "bad" | "info" | "good" | "warn" }) {
  const cls = tone ? { bad: "text-bad", info: "text-info", good: "text-good", warn: "text-warn" }[tone] : "";
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className={`tnum mt-1 text-[26px] font-semibold leading-tight tracking-tight ${cls}`}>{value}</div>
      {note && <div className="mt-1 text-[12px] leading-snug text-ink-2">{note}</div>}
    </div>
  );
}

export const ACTION_META: Record<string, { label: string; icon: string; cls: string; tone: "bad" | "info" | "good" | "warn" }> = {
  IMMEDIATE_REORDER: { label: "Reorder", icon: "↑", cls: "bg-bad-soft text-bad", tone: "bad" },
  PAUSE_ORDER: { label: "Pause", icon: "‖", cls: "bg-info-soft text-info", tone: "info" },
  MAINTAIN: { label: "In range", icon: "✓", cls: "bg-good-soft text-good", tone: "good" },
  MANUAL_REVIEW: { label: "Planner review", icon: "?", cls: "bg-warn-soft text-warn", tone: "warn" },
};

export function ActionChip({ action }: { action: string }) {
  const m = ACTION_META[action] ?? { label: action, icon: "·", cls: "border border-line text-ink-2" };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${m.cls}`}>
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </span>
  );
}

export function Pill({ children, tone = "plain", title }: { children: ReactNode; tone?: "plain" | "accent" | "warn" | "bad" | "info" | "good"; title?: string }) {
  const cls = {
    plain: "border border-line text-ink-2", accent: "bg-accent-soft text-accent", warn: "bg-warn-soft text-warn",
    bad: "bg-bad-soft text-bad", info: "bg-info-soft text-info", good: "bg-good-soft text-good",
  }[tone];
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] ${cls}`}>{children}</span>;
}

export function DqChip({ status }: { status: string }) {
  if (status === "OK") return <Pill tone="good">✓ Data OK</Pill>;
  if (status === "WARNING") return <Pill tone="warn">! Data warning</Pill>;
  return <Pill tone="bad">× Data error</Pill>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line-strong p-6 text-center text-[13px] text-ink-2">{children}</div>;
}
