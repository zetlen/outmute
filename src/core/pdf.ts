import { PDFDocument, PDFPage, rgb, type RGB } from "pdf-lib";
import type { Invoice } from "./types";
import { fmtDay, fmtHours, money } from "./format";
import { embedFamily, Face } from "./fonts";

const PAPER = {
  letter: [612, 792] as [number, number],
  a4: [595.28, 841.89] as [number, number],
};
const MARGIN = 46; // ~16mm
const FOOTER_SPACE = 34;

const INK = rgb(0.102, 0.114, 0.129);
const MUTED = rgb(0.42, 0.447, 0.502);
const RULE = rgb(0.898, 0.906, 0.922);

function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

interface Style { face: Face; size: number; color: RGB; }

function wrap(text: string, face: Face, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = "";
    for (let word of words) {
      // Hard-break words wider than the column.
      while (face.widthOf(word, size) > maxWidth && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && face.widthOf(word.slice(0, cut), size) > maxWidth) cut--;
        const head = word.slice(0, cut);
        if (line) { out.push(line); line = ""; }
        out.push(head);
        word = word.slice(cut);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (line && face.widthOf(candidate, size) > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}

class Painter {
  page!: PDFPage;
  y = 0;
  constructor(
    readonly doc: PDFDocument,
    readonly pageSize: [number, number],
  ) {
    this.addPage();
  }

  get pageWidth() { return this.pageSize[0]; }
  get right() { return this.pageSize[0] - MARGIN; }
  get contentWidth() { return this.pageSize[0] - 2 * MARGIN; }

  addPage(): void {
    this.page = this.doc.addPage(this.pageSize);
    this.y = this.pageSize[1] - MARGIN;
  }

  /** Start a new page if fewer than `height` points remain above the footer area. */
  ensure(height: number): boolean {
    if (this.y - height < MARGIN + FOOTER_SPACE) {
      this.addPage();
      return true;
    }
    return false;
  }

  text(str: string, x: number, s: Style): void {
    let cx = x;
    for (const seg of s.face.segments(str)) {
      this.page.drawText(seg.text, { x: cx, y: this.y, size: s.size, font: seg.font, color: s.color });
      cx += seg.font.widthOfTextAtSize(seg.text, s.size);
    }
  }

  textRight(str: string, right: number, s: Style): number {
    const w = s.face.widthOf(str, s.size);
    this.text(str, right - w, s);
    return w;
  }

  /** Draw text with letter-spacing; returns total width. */
  tracked(str: string, x: number, s: Style, tracking: number): number {
    let cx = x;
    for (const ch of str) {
      this.text(ch, cx, s);
      cx += s.face.widthOf(ch, s.size) + tracking;
    }
    return cx - x - tracking;
  }

  trackedWidth(str: string, s: Style, tracking: number): number {
    return s.face.widthOf(str, s.size) + tracking * Math.max(0, [...str].length - 1);
  }

  hline(x1: number, x2: number, thickness: number, color: RGB, dy = 0): void {
    this.page.drawLine({
      start: { x: x1, y: this.y + dy },
      end: { x: x2, y: this.y + dy },
      thickness,
      color,
    });
  }
}

export async function renderInvoicePdf(inv: Invoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.number}`);
  doc.setCreator("clockify-invoice");
  const { regular, bold } = await embedFamily(doc, inv.config.invoice.font);
  const accent = hexToRgb(inv.config.invoice.accent);
  const p = new Painter(doc, PAPER[inv.config.invoice.paper]);
  const sym = inv.currency;

  const body: Style = { face: regular, size: 9.5, color: INK };
  const small: Style = { face: regular, size: 8.5, color: MUTED };
  const label: Style = { face: bold, size: 7, color: accent };
  const colhead: Style = { face: regular, size: 7, color: MUTED };

  const labelRow = (text: string) => {
    p.tracked(text.toUpperCase(), MARGIN, label, 1.1);
    p.y -= 13;
  };

  // ---- Header: from-block left, title + meta right ----
  const topY = p.y - 14;
  p.y = topY;
  p.text(inv.config.from.name, MARGIN, { face: bold, size: 13, color: INK });
  p.y -= 15;
  for (const line of inv.config.from.lines) {
    p.text(line, MARGIN, { face: regular, size: 9, color: MUTED });
    p.y -= 12.5;
  }
  const afterFrom = p.y;

  p.y = topY - 3;
  const titleStyle: Style = { face: regular, size: 22, color: accent };
  const titleW = p.trackedWidth("INVOICE", titleStyle, 4);
  p.tracked("INVOICE", p.right - titleW, titleStyle, 4);
  p.y -= 24;
  const metaRows: [string, string][] = [
    ["Invoice No.", inv.number],
    ["Issue Date", fmtDay(inv.issued)],
    ["Due Date", fmtDay(inv.due)],
    ["Period", `${fmtDay(inv.periodStart)} – ${fmtDay(inv.periodEnd)}`],
  ];
  for (const [name, value] of metaRows) {
    const valueW = p.textRight(value, p.right, { face: bold, size: 9, color: INK });
    p.textRight(name, p.right - valueW - 6, { face: regular, size: 9, color: MUTED });
    p.y -= 13;
  }
  p.y = Math.min(afterFrom, p.y) - 26;

  // ---- Bill to ----
  labelRow("Bill To");
  p.text(inv.config.to.name, MARGIN, { face: bold, size: 11, color: INK });
  p.y -= 14;
  for (const line of inv.config.to.lines) {
    p.text(line, MARGIN, { face: regular, size: 9, color: INK });
    p.y -= 12.5;
  }
  p.y -= 18;

  // ---- Line item table ----
  const cols = {
    desc: { x: MARGIN, w: p.contentWidth * 0.55 },
    hours: { right: MARGIN + p.contentWidth * 0.67 },
    rate: { right: MARGIN + p.contentWidth * 0.83 },
    amount: { right: p.right },
  };
  const tableHeader = (headers: [string, number, boolean][]) => {
    for (const [text, pos, rightAlign] of headers) {
      const style = colhead;
      if (rightAlign) {
        const w = p.trackedWidth(text.toUpperCase(), style, 0.8);
        p.tracked(text.toUpperCase(), pos - w, style, 0.8);
      } else {
        p.tracked(text.toUpperCase(), pos, style, 0.8);
      }
    }
    p.hline(MARGIN, p.right, 1.4, INK, -5);
    p.y -= 16;
  };
  const mainHeader = () =>
    tableHeader([
      ["Description", cols.desc.x, false],
      ["Hours", cols.hours.right, true],
      ["Rate", cols.rate.right, true],
      ["Amount", cols.amount.right, true],
    ]);

  p.ensure(80);
  mainHeader();

  for (const line of inv.lines) {
    const descWidth = cols.desc.w - 8;
    const primaryLines = wrap(line.primary, regular, 9.5, descWidth);
    const secondaryLines = line.secondary ? wrap(line.secondary, regular, 8.5, descWidth) : [];
    const rowHeight = primaryLines.length * 12 + secondaryLines.length * 11 + 10;
    if (p.ensure(rowHeight)) mainHeader();

    const rowTop = p.y;
    for (const text of primaryLines) {
      p.text(text, cols.desc.x, body);
      p.y -= 12;
    }
    for (const text of secondaryLines) {
      p.text(text, cols.desc.x, small);
      p.y -= 11;
    }
    const rowBottom = p.y;
    p.y = rowTop;
    p.textRight(fmtHours(line.hours), cols.hours.right, body);
    p.textRight(money(sym, line.rate), cols.rate.right, body);
    p.textRight(money(sym, line.hours * line.rate), cols.amount.right, body);
    p.y = rowBottom - 4;
    p.hline(MARGIN, p.right, 0.6, RULE, 4);
    p.y -= 6;
  }

  // ---- Totals ----
  const totalsRows = 2 + (inv.tax > 0 ? 1 : 0);
  p.ensure(totalsRows * 16 + 20);
  p.y -= 8;
  const totalsLeft = MARGIN + p.contentWidth * 0.58;
  const totalRow = (name: string, value: string, gray = true) => {
    p.text(name, totalsLeft, { face: regular, size: 9.5, color: gray ? MUTED : INK });
    p.textRight(value, p.right, { face: regular, size: 9.5, color: INK });
    p.y -= 15;
  };
  totalRow("Subtotal", money(sym, inv.subtotal));
  if (inv.tax > 0) {
    const pct = Number(inv.taxPercent.toFixed(4)); // trim float noise, like "%g"
    totalRow(`${inv.config.invoice.taxLabel} (${pct}%)`, money(sym, inv.tax));
  }
  p.hline(totalsLeft, p.right, 1.4, INK, 10);
  p.y -= 4;
  p.text("Total Due", totalsLeft, { face: bold, size: 11.5, color: accent });
  p.textRight(money(sym, inv.total), p.right, { face: bold, size: 11.5, color: accent });
  p.y -= 30;

  // ---- Notes ----
  const notes = inv.config.invoice.notes.replaceAll(
    "{net_days}",
    String(inv.config.invoice.netDays),
  );
  if (notes.trim()) {
    const noteLines = wrap(notes, regular, 9, p.contentWidth * 0.6);
    p.ensure(noteLines.length * 12 + 20);
    labelRow("Notes");
    for (const text of noteLines) {
      p.text(text, MARGIN, { face: regular, size: 9, color: MUTED });
      p.y -= 12;
    }
  }

  // ---- Appendix: per-entry detail on its own page ----
  if (inv.appendix) {
    p.addPage();
    labelRow("Time Entry Detail");
    p.y -= 4;
    const a = {
      date: MARGIN,
      project: MARGIN + p.contentWidth * 0.16,
      desc: MARGIN + p.contentWidth * 0.38,
      descW: p.contentWidth * 0.52,
      hours: p.right,
    };
    const appendixHeader = () =>
      tableHeader([
        ["Date", a.date, false],
        ["Project", a.project, false],
        ["Description", a.desc, false],
        ["Hours", a.hours, true],
      ]);
    appendixHeader();
    const cell: Style = { face: regular, size: 8.5, color: INK };
    for (const entry of inv.entries) {
      const descLines = wrap(entry.description || "", regular, 8.5, a.descW);
      const projLines = wrap(entry.project || "", regular, 8.5, a.desc - a.project - 8);
      const rowHeight = Math.max(descLines.length, projLines.length, 1) * 11 + 8;
      if (p.ensure(rowHeight)) appendixHeader();
      const rowTop = p.y;
      p.text(fmtDay(entry.day), a.date, cell);
      projLines.forEach((text, i) => {
        p.y = rowTop - i * 11;
        p.text(text, a.project, cell);
      });
      descLines.forEach((text, i) => {
        p.y = rowTop - i * 11;
        p.text(text, a.desc, cell);
      });
      p.y = rowTop;
      p.textRight(fmtHours(entry.hours), a.hours, cell);
      p.y = rowTop - (Math.max(descLines.length, projLines.length, 1) - 1) * 11 - 4;
      p.hline(MARGIN, p.right, 0.6, RULE, 1);
      p.y -= 12;
    }
  }

  // ---- Footer on the last page ----
  p.y = MARGIN;
  p.hline(MARGIN, p.right, 0.6, RULE, 12);
  const footer: Style = { face: regular, size: 7.5, color: MUTED };
  p.text(`Invoice ${inv.number}`, MARGIN, footer);
  p.textRight(`${money(sym, inv.total)} due ${fmtDay(inv.due)}`, p.right, footer);

  return doc.save();
}
