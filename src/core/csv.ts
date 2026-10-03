/**
 * CSV and date parsing shared by the time report adapters and the fees list.
 */
import { toISO } from "./format";

/** RFC 4180 CSV parser: quoted fields, embedded quotes, newlines in fields. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM
  const push = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    push();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
      } else {
        field += c;
        i++;
      }
    } else if (c === '"' && field === "") {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      push();
      i++;
    } else if (c === "\n") {
      endRow();
      i++;
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

export function findColumn(fields: string[], ...prefixes: string[]): number {
  for (const prefix of prefixes) {
    const p = prefix.toLowerCase();
    const idx = fields.findIndex((name) => name.trim().toLowerCase().startsWith(p));
    if (idx !== -1) return idx;
  }
  return -1;
}

export interface DateFormat {
  re: RegExp;
  y: number;
  m: number;
  d: number;
}

// Same candidate order as strptime formats in the original: ISO, US, EU slash, EU dot, Y/M/D.
const DATE_FORMATS: DateFormat[] = [
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, y: 1, m: 2, d: 3 },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, y: 3, m: 1, d: 2 },
  { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, y: 3, m: 2, d: 1 },
  { re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, y: 3, m: 2, d: 1 },
  { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, y: 1, m: 2, d: 3 },
];

export function tryParseDate(raw: string, fmt: DateFormat): string | null {
  const match = fmt.re.exec(raw);
  if (!match) return null;
  const y = Number(match[fmt.y]),
    m = Number(match[fmt.m]),
    d = Number(match[fmt.d]);
  if (m < 1 || m > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return toISO(y, m, d);
}

/** Find the first format that parses every date string, or null if none does. */
export function pickDateFormat(rawDates: string[]): DateFormat | null {
  return (
    DATE_FORMATS.find((fmt) => rawDates.every((raw) => tryParseDate(raw, fmt) !== null)) ?? null
  );
}
