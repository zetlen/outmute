import type { Invoice, InvoiceConfig, InvoiceOptions, Line } from "./types";
import type { TimeEntry, Timesheet } from "./timesheet";
import { addDays, fmtDay, symbolForCurrency, todayISO } from "./format";

export class InvoiceError extends Error {}

/** A time entry whose rate has been resolved (from the source or the config). */
type PricedEntry = TimeEntry & { rate: number };

function resolveRates(
  entries: TimeEntry[],
  rates: Record<string, number>,
  warnings: string[],
): PricedEntry[] {
  const missing = new Set<string>();
  const priced = entries.map((entry): PricedEntry => {
    if (entry.rate !== undefined) return { ...entry, rate: entry.rate };
    let configured = rates[entry.project] ?? rates["default"];
    if (configured === undefined) {
      missing.add(entry.project || "(no project)");
      configured = 0;
    }
    return { ...entry, rate: configured };
  });
  if (missing.size) {
    warnings.push(
      `no rate for project(s): ${[...missing].sort().join(", ")} — set them in the rates config`,
    );
  }
  return priced;
}

function buildLines(entries: PricedEntry[], groupBy: InvoiceOptions["group"]): Line[] {
  const groups = new Map<string, PricedEntry[]>();
  entries.forEach((entry, i) => {
    let key: string;
    if (groupBy === "description")
      key = JSON.stringify([entry.project, entry.description, entry.rate]);
    else if (groupBy === "project") key = JSON.stringify([entry.project, entry.rate]);
    else if (groupBy === "day") key = JSON.stringify([entry.day, entry.project, entry.rate]);
    else key = String(i);
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  });

  const lines: Line[] = [];
  for (const bucket of groups.values()) {
    const first = bucket.reduce((a, b) => (b.day < a.day ? b : a));
    const hours = bucket.reduce((sum, e) => sum + e.hours, 0);
    const descriptions = [...new Set(bucket.map((e) => e.description).filter(Boolean))];
    let primary: string, secondary: string;
    if (groupBy === "description") {
      primary = first.description || "(no description)";
      secondary = first.project;
    } else if (groupBy === "project") {
      primary = first.project || "(no project)";
      secondary = descriptions.join("; ");
    } else if (groupBy === "day") {
      primary = first.project ? `${fmtDay(first.day)} — ${first.project}` : fmtDay(first.day);
      secondary = descriptions.join("; ");
    } else {
      primary = first.description || "(no description)";
      secondary = [first.project, fmtDay(first.day)].filter(Boolean).join(" · ");
    }
    lines.push({ primary, secondary, hours, rate: first.rate, firstDay: first.day });
  }

  lines.sort((a, b) =>
    a.firstDay < b.firstDay
      ? -1
      : a.firstDay > b.firstDay
        ? 1
        : a.primary.toLowerCase().localeCompare(b.primary.toLowerCase()),
  );
  return lines;
}

/** Turn a timesheet + config into a fully computed invoice model. */
export function computeInvoice(
  timesheet: Timesheet,
  config: InvoiceConfig,
  options: InvoiceOptions,
): Invoice {
  const warnings: string[] = [];
  let entries: TimeEntry[] = timesheet.entries;

  if (!options.includeNonBillable) {
    const skipped = entries.filter((e) => !e.billable).length;
    entries = entries.filter((e) => e.billable);
    if (skipped) {
      warnings.push(`skipped ${skipped} non-billable entr${skipped === 1 ? "y" : "ies"}`);
    }
    if (!entries.length) throw new InvoiceError("no billable entries in the report");
  }
  if (!entries.length) throw new InvoiceError("the report has no time entries");

  // resolveRates copies, so the caller's timesheet is never mutated.
  const priced = resolveRates(entries, config.rates, warnings);
  const lines = buildLines(priced, options.group);

  const roundMinutes = Math.floor(config.invoice.roundUpMinutes);
  if (roundMinutes > 0) {
    const increment = roundMinutes / 60;
    for (const line of lines) {
      line.hours = Math.ceil(line.hours / increment - 1e-9) * increment;
    }
  }

  const subtotal = lines.reduce((sum, line) => sum + line.hours * line.rate, 0);
  const taxPercent = config.invoice.taxPercent;
  const tax = (subtotal * taxPercent) / 100;
  const days = priced.map((e) => e.day).sort();
  const periodStart = days[0],
    periodEnd = days[days.length - 1];
  const issued = options.issueDate ?? todayISO();
  const number = options.number || `${config.invoice.numberPrefix}${periodEnd.replaceAll("-", "")}`;

  return {
    config,
    lines,
    entries: priced.slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    number,
    issued,
    due: addDays(issued, Math.floor(config.invoice.netDays)),
    periodStart,
    periodEnd,
    subtotal,
    taxPercent,
    tax,
    total: subtotal + tax,
    currency: config.invoice.currency || symbolForCurrency(timesheet.currency) || "$",
    appendix: options.appendix,
    totalHours: lines.reduce((sum, line) => sum + line.hours, 0),
    warnings,
  };
}
