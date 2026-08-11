/**
 * The internal interchange format. Adapters (src/adapters/) turn a
 * time-tracker's export into a Timesheet; everything downstream — invoice
 * computation, PDF rendering — knows only this shape, never the source format.
 */

/** A single time entry. Days are ISO "YYYY-MM-DD" strings, timezone-free. */
export interface TimeEntry {
  day: string;
  project: string;
  description: string;
  hours: number;
  /** Hourly rate from the source; absent means "resolve from config rates". */
  rate?: number;
  billable: boolean;
}

export interface Timesheet {
  /** Name of the adapter that produced this (e.g. "clockify"). */
  source: string;
  /** ISO 4217 currency code inferred from the source, if any. */
  currency?: string;
  entries: TimeEntry[];
}
