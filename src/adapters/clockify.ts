import type { Timesheet, TimeEntry } from "../core/timesheet";
import {
  findColumn,
  parseCsv,
  pickDateFormat as findDateFormat,
  tryParseDate,
  type DateFormat,
} from "../core/csv";
import { parseNumber } from "../core/format";
import { AdapterError, type Adapter } from "./adapter";

/** Find the first format that parses every date string in the CSV. */
function pickDateFormat(rawDates: string[]): DateFormat {
  const fmt = findDateFormat(rawDates);
  if (!fmt) {
    throw new AdapterError(`unrecognized date format in CSV (e.g. ${JSON.stringify(rawDates[0])})`);
  }
  return fmt;
}

function parseDuration(row: string[], decimalCol: number, hmsCol: number): number {
  if (decimalCol !== -1 && (row[decimalCol] ?? "").trim()) {
    return parseNumber(row[decimalCol]);
  }
  const raw = (row[hmsCol] ?? "").trim();
  const parts = raw.split(":");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    throw new AdapterError(`can't parse duration ${JSON.stringify(raw)}`);
  }
  const [h, m, s] = parts.map(Number);
  return h + m / 60 + s / 3600;
}

function columns(fields: string[]) {
  return {
    date: findColumn(fields, "Start Date", "Date"),
    hms: findColumn(fields, "Duration (h)"),
    decimal: findColumn(fields, "Duration (decimal)"),
  };
}

/** Parse the text of a Clockify Detailed report CSV into a Timesheet. */
function parse(text: string): Timesheet {
  const table = parseCsv(text);
  const fields = table[0] ?? [];
  const rows = table.slice(1).filter((row) => row.some((v) => (v ?? "").trim()));

  const { date: dateCol, hms: hmsCol, decimal: decimalCol } = columns(fields);
  if (dateCol === -1 || (hmsCol === -1 && decimalCol === -1)) {
    throw new AdapterError(
      "this doesn't look like a Clockify Detailed report CSV " +
        "(need a Start Date and a Duration column). In Clockify: " +
        "Reports > Detailed > Export > Save as CSV.",
    );
  }
  if (!rows.length) throw new AdapterError("CSV has no time entries");

  const projectCol = findColumn(fields, "Project");
  const descCol = findColumn(fields, "Description");
  const billableCol = findColumn(fields, "Billable");
  const rateCol = findColumn(fields, "Billable Rate");

  let currency: string | undefined;
  if (rateCol !== -1) {
    const match = /\(([A-Z]{3})\)/.exec(fields[rateCol]);
    if (match) currency = match[1];
  }

  const fmt = pickDateFormat(rows.map((row) => (row[dateCol] ?? "").trim()));
  const entries: TimeEntry[] = rows.map((row) => {
    const rate = rateCol !== -1 ? parseNumber(row[rateCol]) : 0;
    return {
      day: tryParseDate((row[dateCol] ?? "").trim(), fmt)!,
      project: projectCol !== -1 ? (row[projectCol] ?? "").trim() : "",
      description: descCol !== -1 ? (row[descCol] ?? "").trim() : "",
      hours: parseDuration(row, decimalCol, hmsCol),
      // Clockify leaves the rate blank/0 when none is set; treat that as "unpriced".
      ...(rate > 0 ? { rate } : {}),
      billable:
        billableCol !== -1
          ? ["yes", "true", "1"].includes((row[billableCol] ?? "yes").trim().toLowerCase())
          : true,
    };
  });
  return { source: "clockify", entries, currency };
}

export const clockify: Adapter = {
  name: "clockify",
  /** A Clockify Detailed report has a Start Date and a Duration column in its header row. */
  detect(text: string): boolean {
    const header = parseCsv(text.slice(0, 4096))[0] ?? [];
    const { date, hms, decimal } = columns(header);
    return date !== -1 && (hms !== -1 || decimal !== -1);
  },
  parse,
};
