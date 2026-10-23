"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { IconArrowUpRight, IconClose } from "./icons";
import { SkuBody, SkuHeader } from "./SkuDetail";
import type { EngineConfig } from "@/lib/engine/config";
import type { Recommendation } from "@/lib/engine/engine";
import { withRun } from "@/lib/format";
import type { DecisionRecord } from "@/lib/types";

/** Right-hand SKU panel. Escape or the close button dismisses it; focus returns to where it was. */
export function SkuDrawer({ runId, rec, decision, history, config, distributor, onClose }: {
  runId: string; rec: Recommendation; decision: DecisionRecord | null; history: { week: string; units: number }[];
  config: EngineConfig; distributor?: { name: string; status: string }; onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(null);

  useEffect(() => {
    returnTo.current = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (returnTo.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close panel" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-night/35 [animation:fade_var(--dur)_var(--ease)_both]" />
      <aside role="dialog" aria-modal="true" aria-labelledby="sku-drawer-title"
        className="relative flex h-full w-full max-w-[540px] flex-col overflow-y-auto [&>*]:shrink-0 bg-paper-2 shadow-[var(--shadow-3)] [animation:drawer-in_240ms_var(--ease)_both]">
        <SkuHeader rec={rec} distributor={distributor} titleId="sku-drawer-title"
          right={
            <button ref={closeRef} onClick={onClose} aria-label="Close (Escape)"
              className="shrink-0 rounded-full border border-night-line p-2 text-mist transition-colors hover:bg-night-3 hover:text-cream">
              <IconClose width={16} height={16} />
            </button>
          } />
        <SkuBody runId={runId} rec={rec} decision={decision} history={history} config={config} />
        <div className="mt-auto border-t border-line px-6 py-4">
          <Link href={withRun(`/sku/${rec.SKU_ID}`, runId)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-ok hover:underline">
            Full page with weekly sales and decision history <IconArrowUpRight width={14} height={14} />
          </Link>
        </div>
      </aside>
    </div>
  );
}
