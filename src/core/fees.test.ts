import { describe, expect, test } from "bun:test";
import { FeeError, parseFeeFlag, parseFeesCsv } from "./fees";

describe("parseFeesCsv", () => {
  test("reads description and amount, with optional date and project", () => {
    const csv = [
      "Date,Project,Description,Amount (USD)",
      "2026-08-15,Forge,Award,$50.00",
      ',,Reimbursement,"1,200.50"',
    ].join("\n");
    expect(parseFeesCsv(csv)).toEqual([
      { description: "Award", amount: 50, day: "2026-08-15", project: "Forge" },
      { description: "Reimbursement", amount: 1200.5 },
    ]);
  });

  test("needs only Description and Amount columns", () => {
    expect(parseFeesCsv("Description,Amount\nAward,50\n")).toEqual([
      { description: "Award", amount: 50 },
    ]);
  });

  test("picks the date format that fits every date", () => {
    const csv = "Date,Description,Amount\n08/15/2026,A,1\n08/01/2026,B,2\n";
    expect(parseFeesCsv(csv).map((f) => f.day)).toEqual(["2026-08-15", "2026-08-01"]);
  });

  test("skips blank rows and allows an empty list", () => {
    expect(parseFeesCsv("Description,Amount\n\n,\n")).toEqual([]);
  });

  test("rejects a CSV without the required columns", () => {
    expect(() => parseFeesCsv("Project,Duration\nA,1\n")).toThrow(FeeError);
  });

  test("names the row of a bad amount or missing description", () => {
    expect(() => parseFeesCsv("Description,Amount\nAward,fifty\n")).toThrow(/row 2/);
    expect(() => parseFeesCsv("Description,Amount\nA,1\n,5\n")).toThrow(/row 3.*description/);
  });

  test("rejects an unrecognized date", () => {
    expect(() => parseFeesCsv("Date,Description,Amount\nsoon,A,1\n")).toThrow(/date format/);
  });
});

describe("parseFeeFlag", () => {
  test("splits on the last =", () => {
    expect(parseFeeFlag("Awards=50")).toEqual({ description: "Awards", amount: 50 });
    expect(parseFeeFlag("A=B bonus = $1,200.00")).toEqual({
      description: "A=B bonus",
      amount: 1200,
    });
  });

  test("rejects a missing description or amount", () => {
    expect(() => parseFeeFlag("50")).toThrow(FeeError);
    expect(() => parseFeeFlag("=50")).toThrow(FeeError);
    expect(() => parseFeeFlag("Awards=")).toThrow(FeeError);
  });
});
