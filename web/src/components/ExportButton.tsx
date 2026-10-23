"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApprover } from "./approver";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconDownload } from "./icons";
import { useToast } from "./toast";
import { buttonClass } from "./ui";

/**
 * Downloads a CSV through fetch, so success is only reported once the server has produced the
 * file (and logged the export). With decisions still pending, it asks before exporting a partial order.
 */
export function ExportButton({ href, label, small = false, pending = 0, lines, filename }: {
  href: string; label: string; small?: boolean; pending?: number; lines?: number; filename: string;
}) {
  const name = useApprover();
  const router = useRouter();
  const toast = useToast();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const url = `${href}${href.includes("?") ? "&" : "?"}by=${encodeURIComponent(name.trim() || "Unknown")}`;
    const res = await fetch(url).catch(() => null);
    setBusy(false);
    setAsk(false);
    if (!res || !res.ok) {
      toast({ tone: "error", title: "Export failed", body: res ? `Server answered ${res.status}.` : "Network error. Nothing was exported." });
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ tone: "success", title: `${filename} downloaded`, body: lines != null ? `${lines} line${lines === 1 ? "" : "s"}. Export logged${name.trim() ? ` under ${name.trim()}` : ""}.` : undefined });
    router.refresh();
  }

  return (
    <>
      <button type="button" disabled={busy} onClick={() => (pending > 0 ? setAsk(true) : run())}
        className={`${buttonClass(small ? "ghost" : "primary", small ? "sm" : "md")} disabled:opacity-50`}>
        <IconDownload width={15} height={15} /> {busy ? "Preparing…" : label}
      </button>
      <ConfirmDialog open={ask} title="Export with decisions still open?" confirmLabel="Export approved lines" busy={busy}
        onCancel={() => setAsk(false)} onConfirm={run}>
        {pending} SKU{pending === 1 ? " still needs" : "s still need"} a decision. The file will contain only the {lines ?? "approved"} approved line{lines === 1 ? "" : "s"}; anything decided later needs another export.
      </ConfirmDialog>
    </>
  );
}
