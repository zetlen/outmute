import type { FontFamily } from "./fonts";

/** A single time entry from the Clockify CSV. Days are ISO "YYYY-MM-DD" strings. */
export interface Entry {
  day: string;
  project: string;
  description: string;
  hours: number;
  /** 0 means "not in CSV, resolve from config rates". */
  rate: number;
  billable: boolean;
}

/** One invoice line item (a group of entries billed at the same rate). */
export interface Line {
  primary: string;
  secondary: string;
  hours: number;
  rate: number;
  firstDay: string;
}

export type GroupBy = "description" | "project" | "day" | "entry";

export interface Party {
  name: string;
  /** Address, email, phone... rendered one per line under the name. */
  lines: string[];
}

export interface InvoiceConfig {
  from: Party;
  to: Party;
  invoice: {
    /** Default invoice number is `${numberPrefix}${last entry date as YYYYMMDD}`. */
    numberPrefix: string;
    /** Due date = issue date + netDays. */
    netDays: number;
    /** Currency symbol; empty string means "take it from the CSV, else $". */
    currency: string;
    /** 0 disables the tax line. */
    taxPercent: number;
    taxLabel: string;
    /** e.g. 15 rounds each line item's hours up to the quarter hour. */
    roundUpMinutes: number;
    /** May contain a {net_days} placeholder. */
    notes: string;
    /** Accent color, #rrggbb. */
    accent: string;
    paper: "letter" | "a4";
    /** Typeface: sans = Inter, serif = Source Serif 4, mono = JetBrains Mono. */
    font: FontFamily;
  };
  /** Hourly rates by Clockify project name; "default" covers everything else. */
  rates: Record<string, number>;
}

export interface InvoiceOptions {
  group: GroupBy;
  /** Include entries marked non-billable. */
  includeNonBillable: boolean;
  /** Append a per-entry detail table on its own page. */
  appendix: boolean;
  /** Override the computed invoice number. */
  number?: string;
  /** Issue date as ISO "YYYY-MM-DD"; defaults to today. */
  issueDate?: string;
}

/** Everything the renderer needs to draw the invoice. */
export interface Invoice {
  config: InvoiceConfig;
  lines: Line[];
  /** The billed entries, for the appendix. */
  entries: Entry[];
  number: string;
  issued: string;
  due: string;
  periodStart: string;
  periodEnd: string;
  subtotal: number;
  taxPercent: number;
  tax: number;
  total: number;
  /** Resolved currency symbol. */
  currency: string;
  appendix: boolean;
  totalHours: number;
  warnings: string[];
}

export const DEFAULT_CONFIG: InvoiceConfig = {
  from: { name: "Your Name", lines: [] },
  to: { name: "Client", lines: [] },
  invoice: {
    numberPrefix: "INV-",
    netDays: 30,
    currency: "",
    taxPercent: 0,
    taxLabel: "Tax",
    roundUpMinutes: 0,
    notes: "Thank you for your business. Please remit payment within {net_days} days.",
    accent: "#20509e",
    paper: "letter",
    font: "sans",
  },
  rates: {},
};

/** Deep-merge a partial config over the defaults. */
export function mergeConfig(partial: unknown): InvoiceConfig {
  const p = (partial ?? {}) as Record<string, any>;
  const party = (raw: any, fallback: Party): Party => ({
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name : fallback.name,
    lines: Array.isArray(raw?.lines) ? raw.lines.map(String) : fallback.lines,
  });
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(p.rates ?? {})) {
    const n = Number(v);
    if (Number.isFinite(n)) rates[k] = n;
  }
  const d = DEFAULT_CONFIG.invoice;
  const i = p.invoice ?? {};
  const num = (v: unknown, fallback: number) =>
    Number.isFinite(Number(v)) && v !== "" && v !== null && v !== undefined ? Number(v) : fallback;
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  return {
    from: party(p.from, DEFAULT_CONFIG.from),
    to: party(p.to, DEFAULT_CONFIG.to),
    invoice: {
      numberPrefix: str(i.numberPrefix, d.numberPrefix),
      netDays: num(i.netDays, d.netDays),
      currency: str(i.currency, d.currency),
      taxPercent: num(i.taxPercent, d.taxPercent),
      taxLabel: str(i.taxLabel, d.taxLabel),
      roundUpMinutes: num(i.roundUpMinutes, d.roundUpMinutes),
      notes: str(i.notes, d.notes),
      accent: /^#[0-9a-fA-F]{6}$/.test(i.accent ?? "") ? i.accent : d.accent,
      paper: i.paper === "a4" ? "a4" : "letter",
      font: ["sans", "serif", "mono"].includes(i.font) ? i.font : d.font,
    },
    rates,
  };
}
