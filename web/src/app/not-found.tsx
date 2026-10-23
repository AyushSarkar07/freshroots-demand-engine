import Link from "next/link";
import { EmptyState, buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="px-5 py-16 sm:px-8 lg:px-10">
      <EmptyState title="Nothing orbits here" action={<Link href="/" className={buttonClass()}>Back to the decision desk</Link>}>
        That SKU or page isn&apos;t in this run. It may belong to a different export.
      </EmptyState>
    </div>
  );
}
