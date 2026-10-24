"use client";
import { useState } from "react";
import { IconSearch } from "./icons";
import { Button } from "./ui";

const EXAMPLES = ["Why is the festival uplift 25%?", "What happens to a new SKU with no sales?", "Who owns the export format?", "Which rule wins when demand surges but stock is high?"];

/** Query the rulebook in plain English. Answers cite rulebook sections; nothing outside it is used. */
export function RulebookAsk({ runId }: { runId?: string }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ answer: string; cites: string[]; source: string; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    setQ(question);
    setBusy(true);
    setError(null);
    const r = await fetch("/api/rulebook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, run: runId }) }).catch(() => null);
    const body = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (!r?.ok || !body) return setError(body?.error ?? "Couldn't reach the rulebook.");
    setRes(body);
  }

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q.trim()); }} className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Ask a question about the rules</span>
          <IconSearch width={15} height={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask why a rule exists, who owns it, what happens when…" className="h-10 w-full rounded-[var(--radius)] border border-line-strong bg-paper-2 pl-9 pr-3 text-[13.5px]" />
        </label>
        <Button type="submit" disabled={busy || q.trim().length < 4}>{busy ? "Looking…" : "Ask"}</Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((x) => <button key={x} onClick={() => ask(x)} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:bg-paper-3">{x}</button>)}
      </div>
      {error && <div role="alert" className="mt-3 text-[13px] text-crit">{error}</div>}
      {res && (
        <div className="mt-4 rounded-[var(--radius-lg)] border border-line bg-paper px-4 py-3" aria-live="polite">
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink">{res.answer}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            {res.cites.map((c) => <a key={c} href={`#${c}`} className="rounded bg-paper-3 px-1.5 py-0.5 font-mono text-ink-2 hover:underline">{c}</a>)}
            <span>{res.source === "gemini" ? "Answered by Gemini from the rulebook only" : "Matching rulebook sections"}{res.note ? ` · ${res.note}` : ""}</span>
          </div>
        </div>
      )}
    </div>
  );
}
