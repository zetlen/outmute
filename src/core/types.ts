import { parseFontSlotsConfig, type FontSlots } from "./fonts";
import type { TimeEntry } from "./timesheet";

/** One invoice line item (a group of entries billed at the same rate). */
export interface Line {
  primary: string;
  secondary: string;
  hours: number;
  rate: number;
  firstDay: string;
}

export type GroupBy = "description" | "project" | "day" | "entry";

/** How one project's entries appear on the invoice. */
export interface ProjectDisplay {
  /**
   * Show the project's itemized rows. When false the project collapses to a
   * single summary row (one per rate, if its entries are billed at different
   * rates, followed by a subtotal).
   */
  items: boolean;
  /** Add a subtotal row after the project's itemized rows. */
  subtotal: boolean;
}

/**
 * A block of line items. When any project's display settings deviate from
 * the defaults the invoice is sectioned, with one block per project in
 * order of first activity; otherwise a single untitled block holds every
 * line in date order.
 */
export interface Section {
  /** Project name, drawn as a heading above itemized rows; "" when unsectioned. */
  title: string;
  lines: Line[];
  /** The rows are project summaries rather than itemized entries. */
  summarized: boolean;
  /** Draw a subtotal row after the lines. */
  subtotal: boolean;
  hours: number;
  amount: number;
}

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
    /**
     * Typeface per slot — `heading` styles the title, party names and section
     * labels, `body` everything else. Each is a bundled family (sans = Inter,
     * serif = Source Serif 4, mono = JetBrains Mono) or custom TTF/OTF files.
     */
    fonts: FontSlots;
  };
  /** Hourly rates by Clockify project name; "default" covers everything else. */
  rates: Record<string, number>;
  /**
   * Display settings by project name; "default" covers everything else, and a
   * named entry only needs the keys it changes.
   */
  projects: Record<string, Partial<ProjectDisplay>>;
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
  /** Every row drawn in the line item table, in order. */
  lines: Line[];
  /** The same rows, blocked by project. */
  sections: Section[];
  /** The billed entries, for the appendix. */
  entries: TimeEntry[];
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

const DEFAULT_DISPLAY: ProjectDisplay = { items: true, subtotal: false };

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
    fonts: { heading: "sans", body: "sans" },
  },
  rates: {},
  projects: { default: DEFAULT_DISPLAY },
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
  const projects: Record<string, Partial<ProjectDisplay>> = {};
  for (const [k, raw] of Object.entries(p.projects ?? {})) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    const display: Partial<ProjectDisplay> = {};
    if (typeof v.items === "boolean") display.items = v.items;
    if (typeof v.subtotal === "boolean") display.subtotal = v.subtotal;
    projects[k] = display;
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
      fonts: parseFontSlotsConfig(i.fonts, d.fonts),
    },
    rates,
    projects: { ...projects, default: { ...DEFAULT_DISPLAY, ...projects.default } },
  };
}

/** Resolve a project's display settings: named entry over "default" over built-in. */
export function projectDisplay(config: InvoiceConfig, project: string): ProjectDisplay {
  return { ...DEFAULT_DISPLAY, ...config.projects["default"], ...config.projects[project] };
}
