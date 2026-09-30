import { parseTimesheet } from "../adapters";
import type { Timesheet } from "../core/timesheet";
import { computeInvoice } from "../core/invoice";
import { parseFeesCsv, type Fee } from "../core/fees";
import { renderInvoicePdf } from "../core/pdf";
import { fmtDay, fmtFeeCount, fmtHours, money } from "../core/format";
import { mergeConfig, type GroupBy } from "../core/types";
import { VERSION } from "../core/version";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

if (VERSION) $<HTMLSpanElement>("version").textContent = ` — outmute v${VERSION}`;

const dropzone = $<HTMLDivElement>("dropzone");
const dropzoneText = $<HTMLDivElement>("dropzone-text");
const dropzoneHint = $<HTMLDivElement>("dropzone-hint");
const fileInput = $<HTMLInputElement>("file");
const form = $<HTMLFormElement>("form");
const generate = $<HTMLButtonElement>("generate");
const status = $<HTMLDivElement>("status");

let report: Timesheet | null = null;

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
    const parsed = parseTimesheet(await file.text());
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

/** Open the file picker on click or Enter/Space, and accept a dropped file. */
function wireDropzone(zone: HTMLElement, input: HTMLInputElement, accept: (file: File) => void) {
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", () => {
    if (input.files?.[0]) accept(input.files[0]);
    // Let the same file be chosen again, e.g. after editing it.
    input.value = "";
  });
  for (const type of ["dragenter", "dragover"] as const) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    });
  }
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) accept(file);
  });
}

wireDropzone(dropzone, fileInput, (file) => void acceptFile(file));

// ---- Flat fees ----
// Fees belong to one invoice, so unlike the form fields they aren't saved.
const feeList = $<HTMLDivElement>("fees");

function feeInput(className: string, label: string, type: string, value = ""): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  input.className = className;
  input.value = value;
  input.setAttribute("aria-label", label);
  if (type === "text") input.placeholder = label.replace(" (optional)", "");
  if (type === "number") {
    input.step = "any";
    input.placeholder = "Amount";
  }
  return input;
}

function addFeeRow(fee: Partial<Fee> = {}): HTMLInputElement {
  const row = document.createElement("div");
  row.className = "fee";
  const description = feeInput("fee-description", "Description", "text", fee.description);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", "Remove fee");
  remove.addEventListener("click", () => row.remove());
  row.append(
    description,
    feeInput("fee-project", "Project (optional)", "text", fee.project),
    feeInput("fee-date", "Date (optional)", "date", fee.day),
    feeInput("fee-amount", "Amount", "number", fee.amount === undefined ? "" : String(fee.amount)),
    remove,
  );
  feeList.append(row);
  return description;
}

$<HTMLButtonElement>("add-fee").addEventListener("click", () => addFeeRow().focus());

async function acceptFeesFile(file: File): Promise<void> {
  clearStatus();
  try {
    const fees = parseFeesCsv(await file.text());
    for (const fee of fees) addFeeRow(fee);
    showStatus("ok", `Added ${fees.length} fee${fees.length === 1 ? "" : "s"} from ${file.name}.`);
  } catch (err) {
    showStatus("err", `${file.name}: ${(err as Error).message}`);
  }
}

wireDropzone(
  $<HTMLDivElement>("fees-dropzone"),
  $<HTMLInputElement>("fees-file"),
  (file) => void acceptFeesFile(file),
);

/** Read the fee rows, skipping blank ones; throws on a half-filled row. */
function collectFees(): Fee[] {
  const fees: Fee[] = [];
  [...feeList.querySelectorAll<HTMLDivElement>(".fee")].forEach((row, i) => {
    const field = (cls: string) => row.querySelector<HTMLInputElement>(`.${cls}`)!.value.trim();
    const description = field("fee-description"),
      project = field("fee-project"),
      day = field("fee-date"),
      amount = field("fee-amount");
    if (!description && !project && !day && !amount) return;
    if (!description || !amount || !Number.isFinite(Number(amount))) {
      throw new Error(`fee ${i + 1} needs a description and an amount`);
    }
    fees.push({
      description,
      amount: Number(amount),
      ...(day ? { day } : {}),
      ...(project ? { project } : {}),
    });
  });
  return fees;
}

// ---- Form persistence ----
const FIELD_IDS = [
  "fromName",
  "fromLines",
  "toName",
  "toLines",
  "number",
  "rate",
  "currency",
  "netDays",
  "taxPercent",
  "taxLabel",
  "roundUp",
  "group",
  "accent",
  "paper",
  "fontHeading",
  "fontBody",
  "notes",
] as const;
const CHECKBOX_IDS = ["all", "appendix", "items", "subtotals"] as const;
const STORAGE_KEY = "outmute-form";
// Pre-rename key, read once as a fallback so saved forms survive the rename.
const LEGACY_STORAGE_KEY = "clockify-invoice-form";

function saveForm(): void {
  const data: Record<string, string | boolean> = {};
  for (const id of FIELD_IDS) data[id] = $<HTMLInputElement>(id).value;
  for (const id of CHECKBOX_IDS) data[id] = $<HTMLInputElement>(id).checked;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function restoreForm(): void {
  try {
    const data = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? "{}",
    );
    for (const id of FIELD_IDS) {
      if (typeof data[id] === "string") $<HTMLInputElement>(id).value = data[id];
    }
    for (const id of CHECKBOX_IDS) {
      if (typeof data[id] === "boolean") $<HTMLInputElement>(id).checked = data[id];
    }
  } catch {
    /* stale/invalid storage: start fresh */
  }
}
restoreForm();
form.addEventListener("input", saveForm);

// ---- Generate ----
const splitLines = (raw: string) =>
  raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
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
      fonts: { heading: val("fontHeading"), body: val("fontBody") },
    },
    projects: {
      default: {
        ...(rate > 0 ? { rate } : {}),
        items: $<HTMLInputElement>("items").checked,
        subtotal: $<HTMLInputElement>("subtotals").checked,
      },
    },
  });

  generate.disabled = true;
  generate.textContent = "Generating…";
  try {
    const invoice = computeInvoice(report, config, {
      group: val("group") as GroupBy,
      includeNonBillable: $<HTMLInputElement>("all").checked,
      appendix: $<HTMLInputElement>("appendix").checked,
      number: val("number") || undefined,
      fees: collectFees(),
    });
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
      `${fmtHours(invoice.totalHours)} hours, ${fmtFeeCount(invoice.fees.length)}` +
      `${money(invoice.currency, invoice.total)} ` +
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
