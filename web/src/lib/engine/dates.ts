/** Calendar helpers on UTC day numbers (days since 1970-01-01), so no timezone can shift a date. */

const DAY_MS = 86_400_000;

export const dayNum = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY_MS;
export const fromDayNum = (n: number) => new Date(n * DAY_MS);
export const isoDate = (n: number) => fromDayNum(n).toISOString().slice(0, 10);

export function parseIsoDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  return m ? validDay(+m[1], +m[2], +m[3]) : null;
}

export function validDay(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const n = dayNum(y, m, d);
  const dt = fromDayNum(n);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? n : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Same accepted formats, in the same order, as the Python engine: ISO first, then day-first. */
export function parseFlexibleDate(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const tries: [RegExp, (m: RegExpExecArray) => [number, number, number] | null][] = [
    [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (m) => [+m[1], +m[2], +m[3]]],
    [/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (m) => [+m[3], +m[2], +m[1]]],
    [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => [+m[3], +m[2], +m[1]]],
    [/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (m) => [+m[1], +m[2], +m[3]]],
    [/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/, (m) => monthName(m[2], +m[3], +m[1])],
    [/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/, (m) => monthName(m[2], +m[3], +m[1])],
  ];
  for (const [re, pick] of tries) {
    const m = re.exec(s);
    if (!m) continue;
    const ymd = pick(m);
    const n = ymd && validDay(...ymd);
    if (n != null) return n;
  }
  return null;
}
function monthName(name: string, y: number, d: number): [number, number, number] | null {
  const i = MONTHS.indexOf(name.toLowerCase());
  return i < 0 ? null : [y, i + 1, d];
}

/** Day number of the Monday of an ISO week, or null. Accepts "2026-W27" and "2026W27". */
export function parseIsoWeek(value: string): number | null {
  const m = /^(\d{4})-?W(\d{1,2})$/i.exec(value.trim());
  if (!m) return null;
  const year = +m[1];
  const week = +m[2];
  if (week < 1 || week > weeksInIsoYear(year)) return null;
  return week1Monday(year) + (week - 1) * 7;
}

function week1Monday(year: number): number {
  const jan4 = dayNum(year, 1, 4);
  const dow = (fromDayNum(jan4).getUTCDay() + 6) % 7; // Monday = 0
  return jan4 - dow;
}
function weeksInIsoYear(year: number): number {
  return (week1Monday(year + 1) - week1Monday(year)) / 7;
}

export function isoWeekOf(day: number): { year: number; week: number; monday: number } {
  const dow = (fromDayNum(day).getUTCDay() + 6) % 7;
  const monday = day - dow;
  const year = fromDayNum(monday + 3).getUTCFullYear(); // the Thursday decides the ISO year
  return { year, week: (monday - week1Monday(year)) / 7 + 1, monday };
}

export function formatIsoWeek(monday: number): string {
  const { year, week } = isoWeekOf(monday);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export const ymOf = (day: number) => {
  const d = fromDayNum(day);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
};
export const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
export const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
