/** Minimal RFC 4180 CSV reader: quoted fields, escaped quotes, CRLF, BOM. Everything stays text. */

export interface CsvTable {
  columns: string[];
  rows: Record<string, string>[]; // each row also carries "_row": its CSV line number (header = 1)
}

export class CsvParseError extends Error {}

function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new CsvParseError("Unterminated quoted field");
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseCsv(text: string): CsvTable {
  const clean = text.replace(/^﻿/, "");
  // Blank lines are skipped, as pandas does; line numbers still count them.
  const all = splitRecords(clean);
  const numbered: { line: number; cells: string[] }[] = [];
  all.forEach((cells, idx) => {
    if (!(cells.length === 1 && cells[0].trim() === "")) numbered.push({ line: idx + 1, cells });
  });
  if (!numbered.length) return { columns: [], rows: [] };
  const columns = numbered[0].cells.map((c) => c.trim());
  const rows = numbered.slice(1).map(({ cells }, i) => {
    if (cells.length > columns.length) throw new CsvParseError(`Line ${i + 2} has ${cells.length} fields, expected ${columns.length}`);
    const row: Record<string, string> = {};
    columns.forEach((c, j) => (row[c] = (cells[j] ?? "").trim()));
    row._row = String(i + 2);
    return row;
  });
  return { columns, rows };
}
