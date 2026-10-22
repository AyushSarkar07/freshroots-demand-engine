export const fmtDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const fmtDateTime = (iso: string) =>
  `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })} IST`;

export const units = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-IN"));
export const weeks = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(1));
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)}%`);

/** Today's date in India, for default evaluation dates. */
export const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Appends ?run= so navigation stays on the run being viewed. */
export const withRun = (href: string, run?: string | null) => (run ? `${href}${href.includes("?") ? "&" : "?"}run=${encodeURIComponent(run)}` : href);
