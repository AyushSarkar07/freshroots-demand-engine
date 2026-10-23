"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./ui";

/** Native modal dialog: focus is trapped and Escape cancels, for free. */
export function ConfirmDialog({ open, title, children, confirmLabel, tone = "primary", busy = false, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel: string; tone?: "primary" | "danger"; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[var(--radius-xl)] border border-line bg-paper-2 p-0 text-ink shadow-[var(--shadow-3)] backdrop:bg-night/55">
      <div className="p-6">
        <h2 className="font-display text-[20px] font-semibold tracking-tight">{title}</h2>
        <div className="mt-2 text-[14px] leading-relaxed text-ink-2">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>{busy ? "Working…" : confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}
