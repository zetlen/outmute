import type { Timesheet } from "../core/timesheet";

export class AdapterError extends Error {}

/** Turns one time-tracker's export into the internal Timesheet format. */
export interface Adapter {
  name: string;
  /** Cheap sniff: does this text look like this adapter's format? */
  detect(text: string): boolean;
  parse(text: string): Timesheet;
}
