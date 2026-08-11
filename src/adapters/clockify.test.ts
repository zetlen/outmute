import { describe, expect, test } from "bun:test";
import { parseCsv, clockify } from "./clockify";
import { AdapterError } from "./adapter";

const HEADER =
  "Project,Description,Billable,Start Date,Duration (h),Duration (decimal),Billable Rate (EUR)";

describe("parseCsv", () => {
  test("parses simple comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("handles quoted fields with commas inside", () => {
    expect(parseCsv('a,"b, still b",c')).toEqual([["a", "b, still b", "c"]]);
  });

  test("handles embedded quotes via doubling", () => {
    expect(parseCsv('a,"she said ""hi""",c')).toEqual([["a", 'she said "hi"', "c"]]);
  });

  test("handles newlines inside quoted fields", () => {
    expect(parseCsv('a,"line1\nline2",c')).toEqual([["a", "line1\nline2", "c"]]);
  });

  test("strips a leading BOM", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("clockify.detect", () => {
  test("accepts a Clockify-shaped header", () => {
    expect(clockify.detect(`${HEADER}\nAcme,Work,Yes,08/01/2026,01:00:00,1,50\n`)).toBe(true);
  });

  test("rejects arbitrary CSV without date/duration columns", () => {
    expect(clockify.detect("Name,Email\nAlice,a@example.com\n")).toBe(false);
  });
});

describe("clockify.parse", () => {
  test("prefers an unambiguous ISO date format", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,2026-08-01,01:00:00,1,50\n`;
    expect(clockify.parse(csv).entries[0]?.day).toBe("2026-08-01");
  });

  test("picks US month/day/year when every date requires it", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,08/13/2026,01:00:00,1,50\n`;
    expect(clockify.parse(csv).entries[0]?.day).toBe("2026-08-13");
  });

  test("picks EU day/month/year when every date requires it", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,13/08/2026,01:00:00,1,50\n`;
    expect(clockify.parse(csv).entries[0]?.day).toBe("2026-08-13");
  });

  test("throws on a date format that cannot be parsed", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,not-a-date,01:00:00,1,50\n`;
    expect(() => clockify.parse(csv)).toThrow(AdapterError);
  });

  test("uses Duration (h) when Duration (decimal) is blank", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,2026-08-01,01:30:00,,50\n`;
    expect(clockify.parse(csv).entries[0]?.hours).toBe(1.5);
  });

  test("uses Duration (decimal) when present", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,2026-08-01,,2.25,50\n`;
    expect(clockify.parse(csv).entries[0]?.hours).toBe(2.25);
  });

  test("sets rate when the billable rate is greater than zero", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,2026-08-01,01:00:00,1,50\n`;
    expect(clockify.parse(csv).entries[0]?.rate).toBe(50);
  });

  test("leaves rate absent when the billable rate is blank", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,2026-08-01,01:00:00,1,\n`;
    expect(clockify.parse(csv).entries[0]?.rate).toBeUndefined();
  });

  test("leaves rate absent when the billable rate is zero", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,2026-08-01,01:00:00,1,0\n`;
    expect(clockify.parse(csv).entries[0]?.rate).toBeUndefined();
  });

  test("extracts the ISO currency code from the rate column header", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,2026-08-01,01:00:00,1,50\n`;
    expect(clockify.parse(csv).currency).toBe("EUR");
  });

  test("treats Yes/true/1 as billable and No as not billable", () => {
    const csv = `${HEADER}\nAcme,Work,Yes,2026-08-01,01:00:00,1,50\nAcme,Work,No,2026-08-01,01:00:00,1,50\n`;
    const { entries } = clockify.parse(csv);
    expect(entries[0]?.billable).toBe(true);
    expect(entries[1]?.billable).toBe(false);
  });
});
