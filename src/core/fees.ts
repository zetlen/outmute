/**
 * Flat fees: charges billed as a fixed amount rather than hours at a rate
 * (awards, bonuses, reimbursements). They come from a fees CSV or from
 * `Description=amount` shorthand, never from the time report, and are drawn
 * in their own block after the time rows.
 */
import { findColumn, parseCsv, pickDateFormat, tryParseDate } from "./csv";
import { parseNumber } from "./format";

export interface Fee {
  description: string;
  amount: number;
  /** ISO "YYYY-MM-DD", when the source gives one. */
  day?: string;
  project?: string;
}

export class FeeError extends Error {}

function parseAmount(raw: string, where: string): number {
  // parseNumber reads anything without digits as 0; a fee needs a real number.
  if (!/\d/.test(raw))
    throw new FeeError(`${where}: amount ${JSON.stringify(raw)} is not a number`);
  return parseNumber(raw);
}

/**
 * Parse a fees CSV. The header row needs Description and Amount columns;
 * Date and Project columns are optional, and so are their cells. Column
 * names match by prefix, so "Amount (USD)" works.
 */
export function parseFeesCsv(text: string): Fee[] {
  const table = parseCsv(text);
  const fields = table[0] ?? [];
  const descCol = findColumn(fields, "Description");
  const amountCol = findColumn(fields, "Amount");
  if (descCol === -1 || amountCol === -1) {
    throw new FeeError("a fees CSV needs a header row with Description and Amount columns");
  }
  const dateCol = findColumn(fields, "Date");
  const projectCol = findColumn(fields, "Project");
  const cell = (row: string[], col: number) => (col === -1 ? "" : (row[col] ?? "").trim());

  // Row numbers in messages count the header as row 1, as a spreadsheet does.
  const rows = table
    .map((row, i) => ({ row, n: i + 1 }))
    .slice(1)
    .filter(({ row }) => row.some((v) => (v ?? "").trim()));
  const rawDates = rows.map(({ row }) => cell(row, dateCol)).filter(Boolean);
  const fmt = pickDateFormat(rawDates);
  if (!fmt) {
    throw new FeeError(
      `unrecognized date format in fees CSV (e.g. ${JSON.stringify(rawDates[0])})`,
    );
  }

  return rows.map(({ row, n }): Fee => {
    const description = cell(row, descCol);
    if (!description) throw new FeeError(`fees CSV row ${n}: description is empty`);
    const fee: Fee = {
      description,
      amount: parseAmount(cell(row, amountCol), `fees CSV row ${n}`),
    };
    const date = cell(row, dateCol);
    if (date) fee.day = tryParseDate(date, fmt)!;
    const project = cell(row, projectCol);
    if (project) fee.project = project;
    return fee;
  });
}

/** Parse `Description=amount` shorthand, e.g. "Awards=50" or "Travel=$1,200.00". */
export function parseFeeFlag(raw: string): Fee {
  const eq = raw.lastIndexOf("=");
  const description = raw.slice(0, eq).trim();
  if (eq === -1 || !description) {
    throw new FeeError(`fee ${JSON.stringify(raw)} should look like "Description=amount"`);
  }
  return {
    description,
    amount: parseAmount(raw.slice(eq + 1).trim(), `fee ${JSON.stringify(raw)}`),
  };
}
