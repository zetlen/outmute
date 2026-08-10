import type { Entry } from "./types";
import { parseNumber, toISO } from "./format";

export class CsvError extends Error {}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", CAD: "CA$", AUD: "A$",
  NZD: "NZ$", INR: "₹", JPY: "¥", CHF: "CHF", SEK: "kr",
};

/** RFC 4180 CSV parser: quoted fields, embedded quotes, newlines in fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM
  const push = () => { row.push(field); field = ""; };
  const endRow = () => { push(); rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++;
      } else { field += c; i++; }
    } else if (c === '"' && field === "") {
      inQuotes = true; i++;
    } else if (c === ",") {
      push(); i++;
    } else if (c === "\n") {
      endRow(); i++;
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow(); i++;
    } else { field += c; i++; }
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

function findColumn(fields: string[], ...prefixes: string[]): number {
  for (const prefix of prefixes) {
    const p = prefix.toLowerCase();
    const idx = fields.findIndex((name) => name.trim().toLowerCase().startsWith(p));
    if (idx !== -1) return idx;
  }
  return -1;
}

interface DateFormat { re: RegExp; y: number; m: number; d: number; }

// Same candidate order as strptime formats in the original: ISO, US, EU slash, EU dot, Y/M/D.
const DATE_FORMATS: DateFormat[] = [
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, y: 1, m: 2, d: 3 },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, y: 3, m: 1, d: 2 },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, y: 3, m: 2, d: 1 },
  { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, y: 3, m: 2, d: 1 },
  { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, y: 1, m: 2, d: 3 },
];

function tryParseDate(raw: string, fmt: DateFormat): string | null {
  const match = fmt.re.exec(raw);
  if (!match) return null;
  const y = Number(match[fmt.y]), m = Number(match[fmt.m]), d = Number(match[fmt.d]);
  if (m < 1 || m > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return toISO(y, m, d);
}

/** Find the first format that parses every date string in the CSV. */
function pickDateFormat(rawDates: string[]): DateFormat {
  for (const fmt of DATE_FORMATS) {
    if (rawDates.every((raw) => tryParseDate(raw, fmt) !== null)) return fmt;
  }
  throw new CsvError(`unrecognized date format in CSV (e.g. ${JSON.stringify(rawDates[0])})`);
}

function parseDuration(row: string[], decimalCol: number, hmsCol: number): number {
  if (decimalCol !== -1 && (row[decimalCol] ?? "").trim()) {
    return parseNumber(row[decimalCol]);
  }
  const raw = (row[hmsCol] ?? "").trim();
  const parts = raw.split(":");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new CsvError(`can't parse duration ${JSON.stringify(raw)}`);
  }
  const [h, m, s] = parts.map(Number);
  return h + m / 60 + s / 3600;
}

export interface ParsedReport {
  entries: Entry[];
  /** Currency symbol inferred from a "Billable Rate (XXX)" header, if any. */
  currency?: string;
}

/** Parse the text of a Clockify Detailed report CSV into time entries. */
export function readEntries(text: string): ParsedReport {
  const table = parseCsv(text);
  const fields = table[0] ?? [];
  const rows = table.slice(1).filter((row) => row.some((v) => (v ?? "").trim()));

  const dateCol = findColumn(fields, "Start Date", "Date");
  const hmsCol = findColumn(fields, "Duration (h)");
  const decimalCol = findColumn(fields, "Duration (decimal)");
  if (dateCol === -1 || (hmsCol === -1 && decimalCol === -1)) {
    throw new CsvError(
      "this doesn't look like a Clockify Detailed report CSV " +
        "(need a Start Date and a Duration column). In Clockify: " +
        "Reports > Detailed > Export > Save as CSV.",
    );
  }
  if (!rows.length) throw new CsvError("CSV has no time entries");

  const projectCol = findColumn(fields, "Project");
  const descCol = findColumn(fields, "Description");
  const billableCol = findColumn(fields, "Billable");
  const rateCol = findColumn(fields, "Billable Rate");

  let currency: string | undefined;
  if (rateCol !== -1) {
    const match = /\(([A-Z]{3})\)/.exec(fields[rateCol]);
    if (match) currency = CURRENCY_SYMBOLS[match[1]];
  }

  const fmt = pickDateFormat(rows.map((row) => (row[dateCol] ?? "").trim()));
  const entries: Entry[] = rows.map((row) => ({
    day: tryParseDate((row[dateCol] ?? "").trim(), fmt)!,
    project: projectCol !== -1 ? (row[projectCol] ?? "").trim() : "",
    description: descCol !== -1 ? (row[descCol] ?? "").trim() : "",
    hours: parseDuration(row, decimalCol, hmsCol),
    rate: rateCol !== -1 ? parseNumber(row[rateCol]) : 0,
    billable:
      billableCol !== -1
        ? ["yes", "true", "1"].includes((row[billableCol] ?? "yes").trim().toLowerCase())
        : true,
  }));
  return { entries, currency };
}
