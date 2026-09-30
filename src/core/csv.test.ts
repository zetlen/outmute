import { describe, expect, test } from "bun:test";
import { parseCsv } from "./csv";

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
