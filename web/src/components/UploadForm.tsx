"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useApprover } from "./approver";
import { IconAlert, IconCheck, IconFile, IconUpload } from "./icons";
import { useToast } from "./toast";
import { Button } from "./ui";

const FILES = [
  { key: "sku_master", label: "SKU master", file: "sku_master.csv", required: true },
  { key: "current_inventory", label: "Current inventory", file: "current_inventory.csv", required: true },
  { key: "weekly_sales", label: "Weekly sales", file: "weekly_sales.csv", required: true },
  { key: "calendar", label: "Calendar", file: "calendar.csv", required: false },
  { key: "distributor_master", label: "Distributor master", file: "distributor_master.csv", required: false },
];

/** What to do next, by the engine's error type. */
const RECOVERY: Record<string, string> = {
  SchemaValidationError: "A file is missing a required column. Check its header row against the SAP export template; names are matched without regard to case.",
  UnrecoverableDataError: "A file has no usable rows, or no complete sales week before the evaluation date. Re-export it from SAP, or check the evaluation date.",
  InputFileError: "A file couldn't be read as CSV. Save it from Excel as “CSV UTF-8” and upload again.",
  ConfigurationError: "The evaluation date or configuration is invalid. Pick a date on or after the last complete sales week.",
};

/** The Monday/Thursday step: upload the SAP export and the engine runs on it straight away. */
export function UploadForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const toast = useToast();
  const name = useApprover();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; type?: string } | null>(null);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (name.trim().length < 2) return setError({ message: "Add your name in the sidebar first, so the run is attributable." });
    const form = new FormData(e.currentTarget);
    form.set("created_by", name.trim());
    setBusy(true);
    setError(null);
    const res = await fetch("/api/runs", { method: "POST", body: form }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { id?: string; error?: string; type?: string }) : {};
    setBusy(false);
    if (!res || !res.ok || !body.id) {
      setError({ message: body.error ?? (res ? `Upload failed (${res.status}).` : "Network error: nothing was uploaded."), type: body.type });
      return;
    }
    toast({ tone: "success", title: "Run complete", body: "The engine decided every SKU in the new export." });
    router.push(`/?run=${body.id}`);
    router.refresh(); // refresh the layout's run list too
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-[13px]">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {FILES.map((f) => {
          const picked = chosen[f.key];
          return (
            <label key={f.key}
              className={`group relative flex cursor-pointer items-center gap-3 rounded-[var(--radius-lg)] border px-3.5 py-3 transition-colors duration-150 focus-within:border-night ${picked ? "border-ok/40 bg-ok-soft/50" : "border-dashed border-line-strong bg-paper hover:border-night/50 hover:bg-paper-3"}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] ${picked ? "bg-night text-spice" : "bg-paper-3 text-muted"}`}>
                {picked ? <IconCheck width={16} height={16} strokeWidth={2.2} /> : <IconFile width={16} height={16} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{f.label} {f.required ? <span className="text-crit" aria-label="required">*</span> : <span className="font-normal text-muted">(optional)</span>}</span>
                <span className="block truncate text-[12px] text-muted">{picked ?? f.file}</span>
              </span>
              <input type="file" name={f.key} accept=".csv,text/csv" required={f.required}
                onChange={(e) => setChosen((c) => ({ ...c, [f.key]: e.target.files?.[0]?.name ?? "" }))}
                className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-ink-2">Evaluation date <span className="text-crit">*</span></span>
          <input type="date" name="evaluation_date" defaultValue={defaultDate} required className="tnum h-9 rounded-[var(--radius)] border border-line-strong bg-paper-2 px-2.5" />
        </label>
        <label className="block min-w-[220px] flex-1">
          <span className="mb-1 block text-[12px] font-semibold text-ink-2">Label</span>
          <input name="label" placeholder="e.g. Thursday export" className="h-9 w-full rounded-[var(--radius)] border border-line-strong bg-paper-2 px-2.5" />
        </label>
        <Button type="submit" disabled={busy}><IconUpload width={15} height={15} />{busy ? "Running the engine…" : "Upload and run"}</Button>
      </div>
      <p className="text-[12px] text-muted">The evaluation date sets the festival-month uplift and the freshness checks. {name.trim() ? `Recorded as uploaded by ${name.trim()}.` : "Add your name in the sidebar."}</p>
      {error && (
        <div role="alert" className="flex gap-3 rounded-[var(--radius-lg)] border border-crit/25 bg-crit-soft px-4 py-3 text-crit">
          <IconAlert className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">{error.type ? `${error.type.replace(/([a-z])([A-Z])/g, "$1 $2")}: ` : ""}{error.message}</div>
            {error.type && RECOVERY[error.type] && <div className="mt-1 text-ink-2">{RECOVERY[error.type]}</div>}
            <div className="mt-1 text-[12px] text-ink-2">Nothing was stored; the current run is unchanged.</div>
          </div>
        </div>
      )}
    </form>
  );
}
