"use client";
import { useRouter } from "next/navigation";
import { useApprover } from "./approver";

/** Downloads a CSV and records who exported it. */
export function ExportButton({ href, label, small = false }: { href: string; label: string; small?: boolean }) {
  const name = useApprover();
  const router = useRouter();
  const url = `${href}${href.includes("?") ? "&" : "?"}by=${encodeURIComponent(name.trim() || "Unknown")}`;
  return (
    <a
      href={url}
      onClick={() => setTimeout(() => router.refresh(), 800)}
      className={`inline-flex items-center gap-1.5 rounded-md font-medium ${small ? "border border-line-strong px-2.5 py-1 text-[12px] text-ink-2 hover:bg-page" : "bg-accent px-3 py-1.5 text-[13px] text-white hover:opacity-90 dark:text-page"}`}
    >
      <span aria-hidden>↓</span> {label}
    </a>
  );
}
