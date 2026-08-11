import { describe, expect, test } from "bun:test";
import { addDays, fmtDay, parseNumber, symbolForCurrency } from "./format";

describe("fmtDay", () => {
  test("formats an ISO date as a short display date", () => {
    expect(fmtDay("2026-08-05")).toBe("Aug 5, 2026");
  });

  test("does not zero-pad the day", () => {
    expect(fmtDay("2026-01-01")).toBe("Jan 1, 2026");
  });
});

describe("addDays", () => {
  test("adds days within a month", () => {
    expect(addDays("2026-08-05", 3)).toBe("2026-08-08");
  });

  test("rolls over into the next month", () => {
    expect(addDays("2026-08-30", 3)).toBe("2026-09-02");
  });

  test("rolls over into the next year", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("parseNumber", () => {
  test("parses US-style thousands with a decimal point", () => {
    expect(parseNumber("1,234.56")).toBe(1234.56);
  });

  test("parses EU-style thousands with a decimal comma", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
  });

  test("strips currency symbols", () => {
    expect(parseNumber("$1,234.56")).toBe(1234.56);
    expect(parseNumber("€1.234,56")).toBe(1234.56);
  });

  test("returns 0 for blank or undefined input", () => {
    expect(parseNumber("")).toBe(0);
    expect(parseNumber(undefined)).toBe(0);
    expect(parseNumber(null)).toBe(0);
  });
});

describe("symbolForCurrency", () => {
  test("returns the symbol for a known code", () => {
    expect(symbolForCurrency("EUR")).toBe("€");
  });

  test("passes unknown codes through unchanged", () => {
    expect(symbolForCurrency("XYZ")).toBe("XYZ");
  });

  test("returns undefined for undefined input", () => {
    expect(symbolForCurrency(undefined)).toBeUndefined();
  });
});
