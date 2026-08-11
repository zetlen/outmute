import { describe, expect, test } from "bun:test";
import { computeInvoice, InvoiceError } from "./invoice";
import { mergeConfig } from "./types";
import type { TimeEntry, Timesheet } from "./timesheet";
import type { InvoiceOptions } from "./types";

function entry(overrides: Partial<TimeEntry>): TimeEntry {
  return {
    day: "2026-08-01",
    project: "Acme",
    description: "Work",
    hours: 1,
    billable: true,
    ...overrides,
  };
}

function timesheet(entries: TimeEntry[], currency?: string): Timesheet {
  return { source: "test", entries, currency };
}

function options(overrides: Partial<InvoiceOptions> = {}): InvoiceOptions {
  return { group: "description", includeNonBillable: false, appendix: false, ...overrides };
}

describe("computeInvoice grouping", () => {
  const entries = [
    entry({ day: "2026-08-01", project: "Acme", description: "Design", rate: 50 }),
    entry({ day: "2026-08-02", project: "Acme", description: "Design", rate: 50 }),
    entry({ day: "2026-08-03", project: "Acme", description: "Dev", rate: 50 }),
    entry({ day: "2026-08-04", project: "Beta", description: "Design", rate: 50 }),
  ];

  test("groups by description within project+rate", () => {
    const invoice = computeInvoice(
      timesheet(entries),
      mergeConfig({}),
      options({ group: "description" }),
    );
    expect(invoice.lines).toHaveLength(3);
  });

  test("groups by project", () => {
    const invoice = computeInvoice(
      timesheet(entries),
      mergeConfig({}),
      options({ group: "project" }),
    );
    expect(invoice.lines).toHaveLength(2);
  });

  test("groups by day", () => {
    const invoice = computeInvoice(timesheet(entries), mergeConfig({}), options({ group: "day" }));
    expect(invoice.lines).toHaveLength(4);
  });

  test("groups by entry (no grouping at all)", () => {
    const dup = [entries[0]!, { ...entries[0]! }];
    const invoice = computeInvoice(timesheet(dup), mergeConfig({}), options({ group: "entry" }));
    expect(invoice.lines).toHaveLength(2);
  });
});

describe("computeInvoice rate resolution", () => {
  test("an entry's own rate beats the config rates", () => {
    const config = mergeConfig({ rates: { Acme: 10, default: 5 } });
    const invoice = computeInvoice(
      timesheet([entry({ project: "Acme", rate: 99 })]),
      config,
      options(),
    );
    expect(invoice.lines[0]?.rate).toBe(99);
  });

  test("a project rate beats the default rate", () => {
    const config = mergeConfig({ rates: { Acme: 10, default: 5 } });
    const invoice = computeInvoice(timesheet([entry({ project: "Acme" })]), config, options());
    expect(invoice.lines[0]?.rate).toBe(10);
  });

  test("falls back to the default rate when no project rate is set", () => {
    const config = mergeConfig({ rates: { default: 5 } });
    const invoice = computeInvoice(timesheet([entry({ project: "Other" })]), config, options());
    expect(invoice.lines[0]?.rate).toBe(5);
  });

  test("warns when no rate can be resolved for a project", () => {
    const invoice = computeInvoice(
      timesheet([entry({ project: "Unpriced" })]),
      mergeConfig({}),
      options(),
    );
    expect(invoice.lines[0]?.rate).toBe(0);
    expect(invoice.warnings.some((w) => w.includes("Unpriced"))).toBe(true);
  });
});

describe("computeInvoice round-up-minutes", () => {
  test("rounds each grouped line's total hours up, not per entry", () => {
    const config = mergeConfig({ invoice: { roundUpMinutes: 15 } });
    const entries = [
      entry({ description: "Design", hours: 0.1, rate: 10 }),
      entry({ description: "Design", hours: 0.1, rate: 10 }),
    ];
    const invoice = computeInvoice(timesheet(entries), config, options());
    // Two 0.1h entries sum to 0.2h, rounded up to the next quarter hour (0.25h) once —
    // not 0.25h + 0.25h, which would happen if rounding applied per entry.
    expect(invoice.lines[0]?.hours).toBe(0.25);
  });

  test("does not round when roundUpMinutes is 0", () => {
    const invoice = computeInvoice(
      timesheet([entry({ hours: 1.1, rate: 10 })]),
      mergeConfig({}),
      options(),
    );
    expect(invoice.lines[0]?.hours).toBe(1.1);
  });
});

describe("computeInvoice tax", () => {
  test("computes tax and total from the subtotal", () => {
    const config = mergeConfig({ invoice: { taxPercent: 10 } });
    const invoice = computeInvoice(timesheet([entry({ hours: 2, rate: 100 })]), config, options());
    expect(invoice.subtotal).toBe(200);
    expect(invoice.tax).toBe(20);
    expect(invoice.total).toBe(220);
  });

  test("tax is zero when taxPercent is 0", () => {
    const invoice = computeInvoice(
      timesheet([entry({ hours: 2, rate: 100 })]),
      mergeConfig({}),
      options(),
    );
    expect(invoice.tax).toBe(0);
    expect(invoice.total).toBe(invoice.subtotal);
  });
});

describe("computeInvoice non-billable filtering", () => {
  test("filters out non-billable entries and warns", () => {
    const entries = [entry({ billable: true, rate: 10 }), entry({ billable: false, rate: 10 })];
    const invoice = computeInvoice(timesheet(entries), mergeConfig({}), options());
    expect(invoice.entries).toHaveLength(1);
    expect(invoice.warnings.some((w) => w.includes("non-billable"))).toBe(true);
  });

  test("includes non-billable entries when includeNonBillable is set", () => {
    const entries = [entry({ billable: true, rate: 10 }), entry({ billable: false, rate: 10 })];
    const invoice = computeInvoice(
      timesheet(entries),
      mergeConfig({}),
      options({ includeNonBillable: true }),
    );
    expect(invoice.entries).toHaveLength(2);
  });

  test("throws when nothing is billable", () => {
    const entries = [entry({ billable: false })];
    expect(() => computeInvoice(timesheet(entries), mergeConfig({}), options())).toThrow(
      InvoiceError,
    );
  });

  test("throws when the report has no entries at all", () => {
    expect(() => computeInvoice(timesheet([]), mergeConfig({}), options())).toThrow(InvoiceError);
  });
});

describe("computeInvoice period + invoice number", () => {
  test("period spans the earliest to latest entry day", () => {
    const entries = [
      entry({ day: "2026-08-05", rate: 10 }),
      entry({ day: "2026-08-01", rate: 10 }),
      entry({ day: "2026-08-10", rate: 10 }),
    ];
    const invoice = computeInvoice(timesheet(entries), mergeConfig({}), options());
    expect(invoice.periodStart).toBe("2026-08-01");
    expect(invoice.periodEnd).toBe("2026-08-10");
  });

  test("default invoice number is prefix + period end with dashes stripped", () => {
    const config = mergeConfig({ invoice: { numberPrefix: "INV-" } });
    const invoice = computeInvoice(
      timesheet([entry({ day: "2026-08-10", rate: 10 })]),
      config,
      options(),
    );
    expect(invoice.number).toBe("INV-20260810");
  });

  test("an explicit invoice number overrides the default", () => {
    const invoice = computeInvoice(
      timesheet([entry({ rate: 10 })]),
      mergeConfig({}),
      options({ number: "CUSTOM-1" }),
    );
    expect(invoice.number).toBe("CUSTOM-1");
  });
});

describe("computeInvoice currency precedence", () => {
  test("config currency wins over everything", () => {
    const config = mergeConfig({ invoice: { currency: "£" } });
    const invoice = computeInvoice(timesheet([entry({ rate: 10 })], "EUR"), config, options());
    expect(invoice.currency).toBe("£");
  });

  test("timesheet's ISO code is used when config has no currency", () => {
    const invoice = computeInvoice(
      timesheet([entry({ rate: 10 })], "EUR"),
      mergeConfig({}),
      options(),
    );
    expect(invoice.currency).toBe("€");
  });

  test("falls back to $ when neither config nor timesheet specify a currency", () => {
    const invoice = computeInvoice(timesheet([entry({ rate: 10 })]), mergeConfig({}), options());
    expect(invoice.currency).toBe("$");
  });
});

describe("computeInvoice does not mutate its input", () => {
  test("leaves the source timesheet and entries untouched", () => {
    const original = timesheet([entry({ rate: 10 })]);
    const snapshot = JSON.parse(JSON.stringify(original));
    computeInvoice(original, mergeConfig({}), options());
    expect(original).toEqual(snapshot);
  });
});
