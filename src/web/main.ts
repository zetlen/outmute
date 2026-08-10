import { readEntries, type ParsedReport } from "../core/csv";
import { computeInvoice } from "../core/invoice";
import { renderInvoicePdf } from "../core/pdf";
import { fmtDay, fmtHours, money } from "../core/format";
import { mergeConfig, type GroupBy } from "../core/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dropzone = $<HTMLDivElement>("dropzone");
const dropzoneText = $<HTMLDivElement>("dropzone-text");
const dropzoneHint = $<HTMLDivElement>("dropzone-hint");
const fileInput = $<HTMLInputElement>("file");
const form = $<HTMLFormElement>("form");
const generate = $<HTMLButtonElement>("generate");
const status = $<HTMLDivElement>("status");

let report: ParsedReport | null = null;

function showStatus(kind: "ok" | "err", message: string): void {
  status.className = kind;
  status.textContent = message;
}

function clearStatus(): void {
  status.className = "";
  status.textContent = "";
}

async function acceptFile(file: File): Promise<void> {
  clearStatus();
  try {
    const parsed = readEntries(await file.text());
    report = parsed;
    const days = parsed.entries.map((e) => e.day).sort();
    dropzone.classList.add("loaded");
    const name = document.createElement("strong");
    name.textContent = file.name;
    dropzoneText.replaceChildren(name, ` — ${parsed.entries.length} entries`);
    dropzoneHint.textContent =
      `${fmtDay(days[0])} – ${fmtDay(days[days.length - 1])}` +
      (parsed.currency ? ` · rates in ${parsed.currency}` : "") +
      " · drop another file to replace";
    generate.disabled = false;
  } catch (err) {
    report = null;
    generate.disabled = true;
    dropzone.classList.remove("loaded");
    const browse = document.createElement("strong");
    browse.textContent = "browse";
    dropzoneText.replaceChildren("Drop your Clockify CSV export here, or ", browse);
    showStatus("err", (err as Error).message);
  }
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", () => {
  if (fileInput.files?.[0]) void acceptFile(fileInput.files[0]);
});
for (const type of ["dragenter", "dragover"] as const) {
  dropzone.addEventListener(type, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
}
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  const file = e.dataTransfer?.files?.[0];
  if (file) void acceptFile(file);
});

// ---- Form persistence ----
const FIELD_IDS = [
  "fromName", "fromLines", "toName", "toLines", "number", "rate", "currency",
  "netDays", "taxPercent", "taxLabel", "roundUp", "group", "accent", "paper", "font", "notes",
] as const;
const CHECKBOX_IDS = ["all", "appendix"] as const;
const STORAGE_KEY = "clockify-invoice-form";

function saveForm(): void {
  const data: Record<string, string | boolean> = {};
  for (const id of FIELD_IDS) data[id] = $<HTMLInputElement>(id).value;
  for (const id of CHECKBOX_IDS) data[id] = $<HTMLInputElement>(id).checked;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function restoreForm(): void {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    for (const id of FIELD_IDS) {
      if (typeof data[id] === "string") $<HTMLInputElement>(id).value = data[id];
    }
    for (const id of CHECKBOX_IDS) {
      if (typeof data[id] === "boolean") $<HTMLInputElement>(id).checked = data[id];
    }
  } catch { /* stale/invalid storage: start fresh */ }
}
restoreForm();
form.addEventListener("input", saveForm);

// ---- Generate ----
const splitLines = (raw: string) => raw.split("\n").map((s) => s.trim()).filter(Boolean);
const val = (id: string) => $<HTMLInputElement>(id).value.trim();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!report) return;
  clearStatus();

  const rate = Number(val("rate"));
  const config = mergeConfig({
    from: { name: val("fromName") || "Your Name", lines: splitLines(val("fromLines")) },
    to: { name: val("toName") || "Client", lines: splitLines(val("toLines")) },
    invoice: {
      netDays: val("netDays"),
      currency: val("currency"),
      taxPercent: val("taxPercent"),
      taxLabel: val("taxLabel") || "Tax",
      roundUpMinutes: val("roundUp"),
      notes: $<HTMLTextAreaElement>("notes").value,
      accent: val("accent"),
      paper: val("paper"),
      font: val("font"),
    },
    rates: rate > 0 ? { default: rate } : {},
  });

  generate.disabled = true;
  generate.textContent = "Generating…";
  try {
    const invoice = computeInvoice(
      report.entries,
      config,
      {
        group: val("group") as GroupBy,
        includeNonBillable: $<HTMLInputElement>("all").checked,
        appendix: $<HTMLInputElement>("appendix").checked,
        number: val("number") || undefined,
      },
      report.currency,
    );
    const pdf = await renderInvoicePdf(invoice);
    const filename = `${invoice.number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    let message =
      `Downloaded ${filename}: ${invoice.lines.length} line item(s), ` +
      `${fmtHours(invoice.totalHours)} hours, ${money(invoice.currency, invoice.total)} ` +
      `due ${fmtDay(invoice.due)}.`;
    if (invoice.warnings.length) message += "\n⚠ " + invoice.warnings.join("\n⚠ ");
    showStatus("ok", message);
  } catch (err) {
    showStatus("err", (err as Error).message);
  } finally {
    generate.disabled = false;
    generate.textContent = "Generate PDF";
  }
});
