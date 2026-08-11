import type { Timesheet } from "../core/timesheet";
import { AdapterError, type Adapter } from "./adapter";
import { clockify } from "./clockify";

export { AdapterError, type Adapter } from "./adapter";

export const adapters: Adapter[] = [clockify];

export const adapterNames = adapters.map((a) => a.name);

/**
 * Parse a time report into a Timesheet, auto-detecting the source format
 * unless `format` names an adapter explicitly.
 */
export function parseTimesheet(text: string, format?: string): Timesheet {
  if (format) {
    const adapter = adapters.find((a) => a.name === format);
    if (!adapter) {
      throw new AdapterError(
        `unknown input format ${JSON.stringify(format)}; supported: ${adapterNames.join(", ")}`,
      );
    }
    return adapter.parse(text);
  }
  const adapter = adapters.find((a) => a.detect(text));
  if (!adapter) {
    throw new AdapterError(
      "unrecognized time report format (supported: " +
        `${adapterNames.join(", ")}). For Clockify: Reports > Detailed > Export > Save as CSV.`,
    );
  }
  return adapter.parse(text);
}
