/**
 * End-to-end tests for the browser version: fill the form, feed the dropzone a
 * fixture CSV, hit Generate PDF, and check the download really is a PDF.
 *
 * Everything here is client-side — the page makes no network calls beyond
 * loading its own bundle.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../test/fixtures/${name}`, import.meta.url));
const SAMPLE = fixture("clockify-sample.csv");
const MALFORMED = fixture("malformed.csv");

/** Matches the CLI fixture: 6 parsed entries, 12.5 h billable, last day 2026-07-10. */
const SAMPLE_ENTRIES = 6;

async function fillInvoiceForm(page: Page): Promise<void> {
  await page.fill("#fromName", "Jane Dev");
  await page.fill("#fromLines", "1 Developer Lane\nSpringfield, ST 00000");
  await page.fill("#toName", "Acme Corp");
  await page.fill("#toLines", "456 Client Avenue");
  await page.fill("#rate", "150");
  await page.fill("#currency", "$");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // A previous test's saved form is restored from localStorage; start clean.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("generates a PDF from the form and a CSV chosen via the file input", async ({ page }) => {
  const generate = page.locator("#generate");
  await expect(generate).toBeDisabled();

  await page.setInputFiles("#file", SAMPLE);

  await expect(page.locator("#dropzone")).toHaveClass(/loaded/);
  await expect(page.locator("#dropzone-text")).toContainText("clockify-sample.csv");
  await expect(page.locator("#dropzone-text")).toContainText(`${SAMPLE_ENTRIES} entries`);
  await expect(generate).toBeEnabled();

  await fillInvoiceForm(page);

  const downloadPromise = page.waitForEvent("download");
  await generate.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("INV-20260710.pdf");

  const path = await download.path();
  const bytes = readFileSync(path);
  expect(bytes.byteLength).toBeGreaterThan(0);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getTitle()).toBe("Invoice INV-20260710");
  expect(doc.getCreator()).toBe("outmute");

  // 12.5 billable hours at 150, grouped by description into 3 line items.
  const status = page.locator("#status");
  await expect(status).toHaveClass("ok");
  await expect(status).toContainText("Downloaded INV-20260710.pdf");
  await expect(status).toContainText("3 line item(s)");
  await expect(status).toContainText("12.50 hours");
  await expect(status).toContainText("$1,875.00");

  await expect(generate).toBeEnabled();
  await expect(generate).toHaveText("Generate PDF");
});

test("accepts a CSV dropped onto the dropzone", async ({ page }) => {
  const csv = readFileSync(SAMPLE, "utf8");

  // Synthesise a real drop: build a DataTransfer in the page and hand it to
  // the dropzone's own drop handler.
  const dataTransfer = await page.evaluateHandle(
    ([contents, name]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([contents], name, { type: "text/csv" }));
      return dt;
    },
    [csv, "clockify-sample.csv"] as const,
  );
  await page.dispatchEvent("#dropzone", "drop", { dataTransfer });

  await expect(page.locator("#dropzone")).toHaveClass(/loaded/);
  await expect(page.locator("#dropzone-text")).toContainText(`${SAMPLE_ENTRIES} entries`);

  await fillInvoiceForm(page);
  await page.selectOption("#group", "project");

  const downloadPromise = page.waitForEvent("download");
  await page.click("#generate");
  const download = await downloadPromise;

  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);

  // Grouping by project collapses the same 12.5 h into 2 line items.
  await expect(page.locator("#status")).toContainText("2 line item(s)");
  await expect(page.locator("#status")).toContainText("$1,875.00");
});

test("the project display checkboxes reach the invoice", async ({ page }) => {
  await page.setInputFiles("#file", SAMPLE);
  await fillInvoiceForm(page);
  await expect(page.locator("#items")).toBeChecked();
  await page.uncheck("#items");
  await page.check("#subtotals");

  const downloadPromise = page.waitForEvent("download");
  await page.click("#generate");
  const bytes = readFileSync(await (await downloadPromise).path());
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // Hiding itemized rows collapses the sample's 2 projects to one row each.
  await expect(page.locator("#status")).toContainText("2 line item(s)");
  await expect(page.locator("#status")).toContainText("$1,875.00");

  // The choice survives a reload via localStorage.
  await page.reload();
  await expect(page.locator("#items")).not.toBeChecked();
  await expect(page.locator("#subtotals")).toBeChecked();
});

test("reports an unrecognized CSV and leaves Generate disabled", async ({ page }) => {
  await page.setInputFiles("#file", MALFORMED);

  const status = page.locator("#status");
  await expect(status).toHaveClass("err");
  await expect(status).toContainText("unrecognized time report format");
  await expect(page.locator("#dropzone")).not.toHaveClass(/loaded/);
  await expect(page.locator("#generate")).toBeDisabled();
});
