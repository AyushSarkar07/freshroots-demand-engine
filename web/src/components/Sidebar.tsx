"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { setApprover, useApprover } from "./approver";
import { IconData, IconDecisions, IconOrders, IconOversight, IconRules, Mark } from "./icons";
import { fmtDate, withRun } from "@/lib/format";

export interface RunContext {
  id: string;
  source: string;
  evaluation_date: string;
  sales_cutoff_week: string;
  label: string;
}

const LINKS = [
  { href: "/", label: "Decisions", Icon: IconDecisions, match: (p: string) => p === "/" || p.startsWith("/sku") },
  { href: "/orders", label: "Purchase orders", Icon: IconOrders, match: (p: string) => p.startsWith("/orders") },
  { href: "/data", label: "Data & runs", Icon: IconData, match: (p: string) => p.startsWith("/data") || p.startsWith("/compare") },
  { href: "/rules", label: "Rules", Icon: IconRules, match: (p: string) => p.startsWith("/rules") },
  { href: "/oversight", label: "Oversight", Icon: IconOversight, match: (p: string) => p.startsWith("/oversight") },
];

const onPopState = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};

/** The run being viewed comes from ?run=; with none, pages show the latest run. */
function useRunParam() {
  usePathname(); // re-render on every route change
  const search = useSyncExternalStore(onPopState, () => window.location.search, () => "");
  return new URLSearchParams(search).get("run");
}

function OperatorField({ compact = false }: { compact?: boolean }) {
  const name = useApprover();
  const ok = name.trim().length >= 2;
  const initials = (name.match(/\p{L}+/gu) ?? []).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <label className={`flex items-center gap-2.5 ${compact ? "" : "rounded-[var(--radius)] border border-night-line bg-night-2 p-2.5"}`}>
      <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${ok ? "bg-spice text-night" : "border border-dashed border-amber text-amber"}`}>
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        {!compact && <span className="block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mist">Deciding as</span>}
        <input
          value={name}
          onChange={(e) => setApprover(e.target.value)}
          placeholder="Your name"
          aria-label="Your name, recorded with every decision"
          className="w-full min-w-0 bg-transparent text-[13.5px] text-cream placeholder:text-mist/70 focus:outline-none"
        />
      </span>
    </label>
  );
}

export function Sidebar({ runs }: { runs: RunContext[] }) {
  const path = usePathname();
  const runParam = useRunParam();
  const latest = runs.find((r) => r.source !== "scenario");
  const run = runs.find((r) => r.id === runParam) ?? latest;
  const isLatest = run && run.id === latest?.id;

  return (
    <>
      {/* Desktop: fixed rail */}
      <aside className="on-dark sticky top-0 hidden h-screen flex-col border-r border-night-line bg-night text-cream lg:flex">
        <Link href={withRun("/", runParam)} className="flex items-center gap-3 px-5 pb-6 pt-6">
          <Mark size={30} />
          <span className="leading-tight">
            <span className="block font-display text-[17px] font-semibold tracking-tight">Freshroots</span>
            <span className="block text-[11px] font-medium uppercase tracking-[0.16em] text-mist">Reorder Desk</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
          {LINKS.map(({ href, label, Icon, match }) => {
            const active = match(path);
            return (
              <Link key={href} href={withRun(href, runParam)} aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-[var(--radius)] px-3 py-2.5 text-[14px] transition-colors duration-150 ${active ? "bg-night-3 font-semibold text-cream" : "text-mist hover:bg-night-2 hover:text-cream"}`}>
                <span aria-hidden className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-spice transition-opacity duration-150 ${active ? "opacity-100" : "opacity-0"}`} />
                <Icon className={active ? "text-spice" : ""} />
                {label}
              </Link>
            );
          })}
        </nav>

        {run && (
          <div className="mx-3 mt-8 rounded-[var(--radius)] border border-night-line p-3.5">
            <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.14em] text-mist">
              <span>Viewing run</span>
              <span className={run.source === "scenario" ? "text-amber" : isLatest ? "text-spice" : "text-amber"}>{run.source === "scenario" ? "Simulation" : isLatest ? "Latest" : "Earlier run"}</span>
            </div>
            <div className="tnum mt-2 font-display text-[18px] font-semibold">{fmtDate(run.evaluation_date)}</div>
            <div className="tnum text-[12.5px] text-mist">Sales through {run.sales_cutoff_week}</div>
            <div className="mt-1 line-clamp-2 text-[12px] text-mist/80">{run.label}</div>
            {!isLatest && <Link href="/" className="mt-2 inline-block text-[12px] font-semibold text-spice hover:underline">Back to latest →</Link>}
          </div>
        )}

        <div className="mt-auto p-3">
          <OperatorField />
          <p className="mt-2 px-1 text-[11px] leading-snug text-mist/80">Stored with every decision and export. Kept in this browser only.</p>
        </div>
      </aside>

      {/* Mobile and tablet: compact top bar */}
      <header className="on-dark sticky top-0 z-40 border-b border-night-line bg-night text-cream lg:hidden">
        <div className="flex items-center gap-3 px-4 pt-3">
          <Link href={withRun("/", runParam)} className="flex shrink-0 items-center gap-2">
            <Mark size={26} />
            <span className="font-display text-[16px] font-semibold tracking-tight">Freshroots</span>
          </Link>
          <div className="ml-auto w-[min(220px,50vw)]"><OperatorField compact /></div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-2 pt-2">
          {LINKS.map(({ href, label, Icon, match }) => {
            const active = match(path);
            return (
              <Link key={href} href={withRun(href, runParam)} aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] ${active ? "bg-spice font-semibold text-night" : "text-mist hover:text-cream"}`}>
                <Icon width={15} height={15} />{label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
