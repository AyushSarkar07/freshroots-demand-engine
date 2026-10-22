"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { setApprover, useApprover } from "./approver";
import { withRun } from "@/lib/format";

const LINKS = [
  { href: "/", label: "Decisions" },
  { href: "/orders", label: "Purchase orders" },
  { href: "/data", label: "Data & runs" },
  { href: "/rules", label: "Rules" },
];

const onPopState = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};

export function Nav() {
  // usePathname re-renders the nav on every route change; the run id is read from the URL
  // directly so the nav needs no Suspense boundary (useSearchParams would require one).
  const path = usePathname();
  const search = useSyncExternalStore(onPopState, () => window.location.search, () => "");
  const run = new URLSearchParams(search).get("run");
  const name = useApprover();
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href={withRun("/", run)} className="flex items-baseline gap-2">
          <span className="font-serif text-[19px] font-semibold tracking-tight text-accent">Freshroots</span>
          <span className="text-[13px] text-ink-2">Reorder Desk</span>
        </Link>
        <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" || path.startsWith("/sku") : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={withRun(l.href, run)}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] ${active ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-page"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <span className="whitespace-nowrap">Deciding as</span>
          <input
            value={name}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="Your name"
            aria-label="Your name, recorded with every decision"
            className={`w-36 rounded-md border bg-page px-2 py-1 text-[13px] text-ink outline-none focus:border-accent ${name.trim().length >= 2 ? "border-line" : "border-warn"}`}
          />
        </label>
      </div>
    </header>
  );
}
