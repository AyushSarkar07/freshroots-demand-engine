import type { ButtonHTMLAttributes, ReactNode } from "react";
import { IconAlert, IconCheck, IconPause, IconQuestion, IconUp } from "./icons";

/* ------------------------------------------------------------------ surfaces */

export function Panel({ title, eyebrow, sub, right, children, className = "", id }: {
  title?: ReactNode; eyebrow?: string; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={`rounded-[var(--radius-lg)] border border-line bg-paper-2 shadow-[var(--shadow-1)] ${className}`}>
      {(title || right || eyebrow) && (
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 pb-4 pt-5 sm:px-6">
          <div>
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            {title && <h2 className="font-display text-[19px] font-semibold tracking-tight">{title}</h2>}
            {sub && <p className="mt-1 max-w-2xl text-[13px] text-muted">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="px-5 py-5 sm:px-6">{children}</div>
    </section>
  );
}

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <div className={`mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${dark ? "text-mist" : "text-muted"}`}>{children}</div>;
}

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="on-dark relative overflow-hidden bg-night px-5 pb-10 pt-8 text-cream sm:px-8 lg:px-10">
      <div className="coord-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div className="reveal">
          <Eyebrow dark>{eyebrow}</Eyebrow>
          <h1 className="font-display text-[34px] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[42px]">{title}</h1>
          {sub && <p className="mt-2 max-w-2xl text-[14px] text-mist">{sub}</p>}
        </div>
        {right}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ controls */

type Variant = "primary" | "ghost" | "danger" | "dark" | "quiet";
const VARIANT: Record<Variant, string> = {
  primary: "bg-spice text-night hover:bg-spice-hover active:bg-spice-deep shadow-[inset_0_-1px_0_rgb(27_17_32/0.15)]",
  ghost: "border border-line-strong bg-paper-2 text-ink hover:bg-paper-3 active:bg-line",
  danger: "bg-crit text-white hover:bg-[#962a1b]",
  dark: "bg-night text-cream hover:bg-night-3",
  quiet: "text-ink-2 hover:bg-paper-3",
};

export function Button({ variant = "primary", size = "md", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "h-8 px-3 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]";
  return (
    <button
      {...rest}
      className={`inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] font-semibold transition-[background-color,transform,box-shadow] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45 ${sz} ${VARIANT[variant]} ${className}`}
    />
  );
}

export const buttonClass = (variant: Variant = "primary", size: "sm" | "md" = "md") =>
  `inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] font-semibold transition-[background-color,transform] duration-150 active:translate-y-px ${size === "sm" ? "h-8 px-3 text-[12.5px]" : "h-9 px-3.5 text-[13.5px]"} ${VARIANT[variant]}`;

/* ------------------------------------------------------------------ status */

export const ACTION_META: Record<string, { label: string; short: string; tone: "crit" | "warn" | "over" | "ok" | "neutral"; Icon: typeof IconUp }> = {
  IMMEDIATE_REORDER: { label: "Reorder now", short: "Reorder", tone: "crit", Icon: IconUp },
  PAUSE_ORDER: { label: "Pause next order", short: "Pause", tone: "over", Icon: IconPause },
  MAINTAIN: { label: "In range", short: "In range", tone: "ok", Icon: IconCheck },
  MANUAL_REVIEW: { label: "Planner review", short: "Review", tone: "neutral", Icon: IconQuestion },
};

const TONE: Record<string, string> = {
  crit: "bg-crit-soft text-crit",
  warn: "bg-warn-soft text-warn",
  over: "bg-over-soft text-over-ink",
  ok: "bg-ok-soft text-ok",
  neutral: "bg-neutral-soft text-ink-2 ring-1 ring-inset ring-line-strong [--tw-ring-style:dashed]",
  lime: "bg-spice text-night",
  dark: "bg-night-3 text-cream",
  plain: "bg-paper-3 text-ink-2",
};

export function StatusBadge({ action, size = "md" }: { action: string; size?: "sm" | "md" }) {
  const m = ACTION_META[action] ?? { short: action, tone: "neutral", Icon: IconQuestion };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold ${size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]"} ${TONE[m.tone]}`}>
      <m.Icon width={size === "sm" ? 12 : 13} height={size === "sm" ? 12 : 13} strokeWidth={2.2} />
      {m.short}
    </span>
  );
}

export function Tag({ children, tone = "plain", title }: { children: ReactNode; tone?: keyof typeof TONE; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ${TONE[tone]}`}>{children}</span>;
}

export function DqTag({ status, notes }: { status: string; notes?: string }) {
  if (status === "OK") return null;
  return (
    <Tag tone={status === "ERROR" ? "crit" : "warn"} title={notes}>
      <IconAlert width={12} height={12} strokeWidth={2} />{status === "ERROR" ? "Data error" : "Data warning"}
    </Tag>
  );
}

/** Small dot + label, for system status on dark surfaces. */
export function StatusDot({ tone, children }: { tone: "ok" | "warn" | "crit"; children: ReactNode }) {
  const c = tone === "ok" ? "bg-ok-fill" : tone === "warn" ? "bg-amber" : "bg-under";
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px]">
      <span className="relative flex h-2 w-2">
        {tone === "ok" && <span className={`absolute inline-flex h-full w-full rounded-full ${c} opacity-50 motion-safe:animate-ping`} />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${c}`} />
      </span>
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <svg width="120" height="64" viewBox="0 0 120 64" aria-hidden className="mb-4">
        <ellipse cx="60" cy="32" rx="54" ry="18" fill="none" stroke="var(--line-strong)" strokeDasharray="3 5" />
        <ellipse cx="60" cy="32" rx="34" ry="11" fill="none" stroke="var(--line-strong)" />
        <circle cx="60" cy="32" r="7" fill="var(--spice)" />
        <circle cx="106" cy="25" r="3" fill="var(--night)" />
      </svg>
      <div className="font-display text-[18px] font-semibold tracking-tight">{title}</div>
      {children && <p className="mt-1.5 max-w-md text-[13.5px] text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: "crit" | "warn" | "ok" }) {
  const cls = tone ? { crit: "text-crit", warn: "text-warn", ok: "text-ok" }[tone] : "";
  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-paper-2 p-4 shadow-[var(--shadow-1)]">
      <div className="text-[12px] font-medium text-muted">{label}</div>
      <div className={`tnum mt-1 font-display text-[28px] font-semibold leading-tight tracking-tight ${cls}`}>{value}</div>
      {note && <div className="mt-1 text-[12px] leading-snug text-ink-2">{note}</div>}
    </div>
  );
}

/** Hover/focus tooltip with plain text. CSS only, so it works in server components. */
export function Tip({ label, children, side = "top", block = false }: { label: string; children: ReactNode; side?: "top" | "bottom"; block?: boolean }) {
  return (
    <span className={`group/tip relative ${block ? "flex w-full" : "inline-flex"}`}>
      {children}
      <span role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-40 w-max max-w-[260px] -translate-x-1/2 rounded-md bg-night px-2.5 py-1.5 text-left text-[12px] font-normal leading-snug text-cream opacity-0 shadow-[var(--shadow-2)] transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 ${side === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}`}>
        {label}
      </span>
    </span>
  );
}
