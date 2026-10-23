/** Shown while a run is read and rendered on the server (real loading only). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="bg-forest px-5 pb-24 pt-12 sm:px-8 lg:px-10">
        <div className="h-3 w-56 rounded bg-forest-3" />
        <div className="mt-5 h-16 w-[min(560px,80%)] rounded-[var(--radius)] bg-forest-2" />
        <div className="mt-3 h-16 w-[min(420px,60%)] rounded-[var(--radius)] bg-forest-2" />
      </div>
      <div className="mx-auto -mt-16 grid max-w-[1320px] gap-4 px-4 sm:px-8 lg:grid-cols-12 lg:px-10">
        <div className="skeleton h-[420px] lg:col-span-6" />
        <div className="grid gap-4 lg:col-span-6 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[200px]" />)}
        </div>
        <div className="skeleton h-[320px] lg:col-span-12" />
      </div>
    </div>
  );
}
