"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApprover } from "./approver";

const FILES = [
  { key: "sku_master", label: "SKU master", file: "sku_master.csv", required: true },
  { key: "current_inventory", label: "Current inventory", file: "current_inventory.csv", required: true },
  { key: "weekly_sales", label: "Weekly sales", file: "weekly_sales.csv", required: true },
  { key: "calendar", label: "Calendar", file: "calendar.csv", required: false },
  { key: "distributor_master", label: "Distributor master", file: "distributor_master.csv", required: false },
];

/** The Monday/Thursday step: upload the SAP export and the engine runs on it straight away. */
export function UploadForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const name = useApprover();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("created_by", name.trim());
    if (name.trim().length < 2) return setError("Enter your name in the top bar first.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/runs", { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string; type?: string };
    setBusy(false);
    if (!res.ok || !body.id) return setError(`${body.type ? `${body.type}: ` : ""}${body.error ?? "Upload failed."}`);
    router.push(`/?run=${body.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-[13px]">
      <div className="grid gap-2 sm:grid-cols-2">
        {FILES.map((f) => (
          <label key={f.key} className="rounded-lg border border-line bg-page px-3 py-2">
            <span className="block text-[12px] font-medium text-ink-2">{f.label} {f.required ? <span className="text-bad">*</span> : <span className="text-muted">(optional)</span>}</span>
            <input type="file" name={f.key} accept=".csv,text/csv" required={f.required} className="mt-1 block w-full text-[12px] file:mr-2 file:rounded file:border-0 file:bg-accent-soft file:px-2 file:py-1 file:text-accent" />
            <span className="text-[11px] text-muted">{f.file}</span>
          </label>
        ))}
        <label className="rounded-lg border border-line bg-page px-3 py-2">
          <span className="block text-[12px] font-medium text-ink-2">Evaluation date <span className="text-bad">*</span></span>
          <input type="date" name="evaluation_date" defaultValue={defaultDate} required className="mt-1 rounded border border-line-strong bg-card px-2 py-1" />
          <span className="block text-[11px] text-muted">Sets the festival-month uplift and data freshness checks</span>
        </label>
      </div>
      <input name="label" placeholder="Label (optional), e.g. Thursday export" className="w-full rounded-md border border-line-strong bg-page px-2 py-1.5" />
      <div className="flex items-center gap-3">
        <button disabled={busy} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-50 dark:text-page">
          {busy ? "Running the engine…" : "Upload and run"}
        </button>
        <span className="text-[12px] text-muted">{name.trim() ? `Recorded as uploaded by ${name.trim()}` : "Enter your name in the top bar"}</span>
      </div>
      {error && <div role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-bad">{error}</div>}
    </form>
  );
}
