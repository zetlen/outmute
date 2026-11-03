import { describe, expect, test } from "bun:test";
import { parseCsv, parseIsoDay } from "./csv";

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

describe("parseIsoDay", () => {
  test("reads dashes or slashes and rejects non-dates", () => {
    expect(parseIsoDay("2026/10/01")).toBe("2026-10-01");
    expect(parseIsoDay("2026-10-1")).toBe("2026-10-01");
    expect(parseIsoDay("2026/02/30")).toBeNull();
    expect(parseIsoDay("10/01/2026")).toBeNull();
  });
});
