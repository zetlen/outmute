import type { Entry, Invoice, InvoiceConfig, InvoiceOptions, Line } from "./types";
import { addDays, fmtDay, todayISO } from "./format";

export class InvoiceError extends Error {}

function resolveRates(entries: Entry[], rates: Record<string, number>, warnings: string[]): void {
  const missing = new Set<string>();
  for (const entry of entries) {
    if (entry.rate > 0) continue;
    let configured = rates[entry.project] ?? rates["default"];
    if (configured === undefined) {
      missing.add(entry.project || "(no project)");
      configured = 0;
    }
    entry.rate = configured;
  }
  if (missing.size) {
    warnings.push(
      `no rate for project(s): ${[...missing].sort().join(", ")} — set them in the rates config`,
    );
  }
}

function buildLines(entries: Entry[], groupBy: InvoiceOptions["group"]): Line[] {
  const groups = new Map<string, Entry[]>();
  entries.forEach((entry, i) => {
    let key: string;
    if (groupBy === "description") key = JSON.stringify([entry.project, entry.description, entry.rate]);
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
    a.firstDay < b.firstDay ? -1 : a.firstDay > b.firstDay ? 1
      : a.primary.toLowerCase().localeCompare(b.primary.toLowerCase()),
  );
  return lines;
}

/** Turn parsed CSV entries + config into a fully computed invoice model. */
export function computeInvoice(
  allEntries: Entry[],
  config: InvoiceConfig,
  options: InvoiceOptions,
  csvCurrency?: string,
): Invoice {
  const warnings: string[] = [];
  // Copy entries so rate resolution doesn't mutate the caller's data.
  let entries: Entry[] = allEntries.map((e) => ({ ...e }));

  if (!options.includeNonBillable) {
    const skipped = entries.filter((e) => !e.billable).length;
    entries = entries.filter((e) => e.billable);
    if (skipped) {
      warnings.push(`skipped ${skipped} non-billable entr${skipped === 1 ? "y" : "ies"}`);
    }
    if (!entries.length) throw new InvoiceError("no billable entries in CSV");
  }
  if (!entries.length) throw new InvoiceError("CSV has no time entries");

  resolveRates(entries, config.rates, warnings);
  const lines = buildLines(entries, options.group);

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
  const days = entries.map((e) => e.day).sort();
  const periodStart = days[0], periodEnd = days[days.length - 1];
  const issued = options.issueDate ?? todayISO();
  const number =
    options.number || `${config.invoice.numberPrefix}${periodEnd.replaceAll("-", "")}`;

  return {
    config,
    lines,
    entries: entries.slice().sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    number,
    issued,
    due: addDays(issued, Math.floor(config.invoice.netDays)),
    periodStart,
    periodEnd,
    subtotal,
    taxPercent,
    tax,
    total: subtotal + tax,
    currency: config.invoice.currency || csvCurrency || "$",
    appendix: options.appendix,
    totalHours: lines.reduce((sum, line) => sum + line.hours, 0),
    warnings,
  };
}
