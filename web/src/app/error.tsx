"use client";
import { EmptyState, Button } from "@/components/ui";

/** Page-level error state: says what failed without claiming anything was saved. */
export default function ErrorState({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="px-5 py-16 sm:px-8 lg:px-10">
      <EmptyState title="This page couldn't load" action={<Button onClick={reset}>Try again</Button>}>
        {error.message || "The server didn't respond."} No decision was changed. If it keeps failing, check the database connection on Data &amp; runs.
        {error.digest ? ` (ref ${error.digest})` : ""}
      </EmptyState>
    </div>
  );
}
