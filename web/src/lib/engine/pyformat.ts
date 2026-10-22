/**
 * Number formatting that matches Python's format() byte for byte, so explanations and
 * data-quality notes are identical to the Python reference engine.
 * Python rounds the exact binary value half-to-even; JS toFixed rounds ties away from zero.
 */
export function pyFixed(v: number, digits: number): string {
  const exact = Math.abs(v).toFixed(Math.min(digits + 25, 100));
  const [intPart, frac = ""] = exact.split(".");
  const tail = frac.slice(digits);
  const tie = tail[0] === "5" && /^0*$/.test(tail.slice(1));
  if (!tie) return v.toFixed(digits);
  const kept = intPart + frac.slice(0, digits);
  if (Number(kept[kept.length - 1]) % 2 === 1) return v.toFixed(digits); // odd: round up (toFixed does)
  const s = digits ? `${intPart}.${frac.slice(0, digits)}` : intPart;
  return v < 0 && /[1-9]/.test(s) ? `-${s}` : s;
}

/** f"{v:,.{d}f}" */
export function pyComma(v: number, digits: number): string {
  const s = pyFixed(v, digits);
  const neg = s.startsWith("-");
  const [i, f] = (neg ? s.slice(1) : s).split(".");
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}${f !== undefined ? `.${f}` : ""}`;
}

/** f"{v:g}" for the plain values the engine prints (thresholds, multipliers, percentages). */
export function pyG(v: number): string {
  return String(Number(v.toPrecision(6)));
}

/** Python's _fmt_num: "n/a" for missing values. */
export function fmtNum(v: number | null | undefined, digits = 1): string {
  return v == null || Number.isNaN(v) ? "n/a" : pyComma(v, digits);
}

/** repr() of a str, as Python prints it inside f"{x!r}" (single quotes unless the text contains one). */
export function pyRepr(s: string): string {
  if (s.includes("'") && !s.includes('"')) return `"${s}"`;
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
export const pyList = (xs: (string | number)[]) => `[${xs.map((x) => (typeof x === "string" ? pyRepr(x) : String(x))).join(", ")}]`;

/** Python's round-half-even to n decimals, used before threshold comparisons. */
export function pyRound(v: number, n: number): number {
  return Number(pyFixed(v, n));
}
