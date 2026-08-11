import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  anchorFontPaths,
  embedFonts,
  FontError,
  parseFontSlotsConfig,
  parseFontValue,
  resolveFontSlots,
  type FontSlots,
} from "./fonts";
import { mergeConfig } from "./types";

const FONT_DIR = resolve(import.meta.dir, "../fonts");
// A real TTF that lacks ₹ — as a custom font it must fall back to Inter.
const CUSTOM_TTF = resolve(FONT_DIR, "jetbrains-mono-latin-400.ttf");
const CUSTOM_BOLD_TTF = resolve(FONT_DIR, "jetbrains-mono-latin-700.ttf");

const DEFAULTS: FontSlots = { heading: "sans", body: "sans" };
const identity = (path: string) => path;

function tmpFile(name: string, bytes: Uint8Array): string {
  const path = resolve(mkdtempSync(resolve(tmpdir(), "outmute-fonts-")), name);
  writeFileSync(path, bytes);
  return path;
}

describe("parseFontValue", () => {
  test("accepts bundled family names", () => {
    expect(parseFontValue("serif", "--font", identity)).toBe("serif");
  });

  test("treats one path as both weights", () => {
    expect(parseFontValue("Display.ttf", "--font-heading", identity)).toEqual({
      regular: "Display.ttf",
    });
  });

  test("splits a comma-separated regular,bold pair", () => {
    expect(parseFontValue(" a.ttf , b.otf ", "--font-heading", identity)).toEqual({
      regular: "a.ttf",
      bold: "b.otf",
    });
  });

  test("resolves paths through the caller's resolver", () => {
    expect(parseFontValue("a.ttf", "--font", (p) => `/work/${p}`)).toEqual({
      regular: "/work/a.ttf",
    });
  });

  test("rejects empty values and more than two files", () => {
    expect(() => parseFontValue("  ", "--font", identity)).toThrow(FontError);
    expect(() => parseFontValue("a.ttf,b.ttf,c.ttf", "--font", identity)).toThrow(
      /at most two font files/,
    );
  });
});

describe("resolveFontSlots precedence", () => {
  test("falls back to the base slots with no flags", () => {
    expect(resolveFontSlots({ heading: "serif", body: "mono" }, {}, identity)).toEqual({
      heading: "serif",
      body: "mono",
    });
  });

  test("--font sets both slots", () => {
    expect(resolveFontSlots(DEFAULTS, { font: "serif" }, identity)).toEqual({
      heading: "serif",
      body: "serif",
    });
  });

  test("a per-slot flag wins over --font", () => {
    expect(resolveFontSlots(DEFAULTS, { font: "serif", body: "mono" }, identity)).toEqual({
      heading: "serif",
      body: "mono",
    });
  });

  test("a per-slot flag wins over the config value", () => {
    expect(
      resolveFontSlots({ heading: "serif", body: "serif" }, { heading: "mono" }, identity),
    ).toEqual({ heading: "mono", body: "serif" });
  });
});

describe("invoice.fonts config", () => {
  test("defaults both slots to sans", () => {
    expect(mergeConfig({}).invoice.fonts).toEqual({ heading: "sans", body: "sans" });
  });

  test("reads family names per slot", () => {
    expect(mergeConfig({ invoice: { fonts: { heading: "serif" } } }).invoice.fonts).toEqual({
      heading: "serif",
      body: "sans",
    });
  });

  test("reads the object form, with bold optional", () => {
    const raw = {
      invoice: {
        fonts: { heading: { regular: "d.ttf" }, body: { regular: "b.ttf", bold: "bb.ttf" } },
      },
    };
    expect(mergeConfig(raw).invoice.fonts).toEqual({
      heading: { regular: "d.ttf" },
      body: { regular: "b.ttf", bold: "bb.ttf" },
    });
  });

  test("ignores the retired single invoice.font key", () => {
    const config = mergeConfig({ invoice: { font: "serif" } });
    expect(config.invoice.fonts).toEqual({ heading: "sans", body: "sans" });
    expect(config.invoice).not.toHaveProperty("font");
  });

  test("anchors custom paths against a directory", () => {
    const slots = parseFontSlotsConfig({ heading: { regular: "d.ttf", bold: "db.ttf" } }, DEFAULTS);
    expect(anchorFontPaths(slots, (p) => resolve("/cfg", p))).toEqual({
      heading: { regular: "/cfg/d.ttf", bold: "/cfg/db.ttf" },
      body: "sans",
    });
  });
});

describe("embedFonts", () => {
  test("embeds each slot independently", async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc, { heading: "serif", body: "mono" });
    expect(fonts.heading.regular.segments("A")[0].font).not.toBe(
      fonts.body.regular.segments("A")[0].font,
    );
  });

  test("embeds a source shared by both slots only once", async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc, { heading: "sans", body: "sans" });
    expect(fonts.heading.regular.segments("A")[0].font).toBe(
      fonts.body.regular.segments("A")[0].font,
    );
  });

  test("renders a custom TTF, reusing the single file for bold", async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc, { heading: { regular: CUSTOM_TTF }, body: "sans" });
    const regular = fonts.heading.regular.segments("A")[0].font;
    expect(fonts.heading.bold.segments("A")[0].font).toBe(regular);
    // The custom face is genuinely in use, not the bundled sans.
    expect(fonts.body.regular.segments("A")[0].font).not.toBe(regular);
  });

  test("uses the bold file when one is supplied", async () => {
    const doc = await PDFDocument.create();
    const spec = { regular: CUSTOM_TTF, bold: CUSTOM_BOLD_TTF };
    const fonts = await embedFonts(doc, { heading: spec, body: "sans" });
    expect(fonts.heading.bold.segments("A")[0].font).not.toBe(
      fonts.heading.regular.segments("A")[0].font,
    );
  });

  test("falls back to Inter for a glyph the custom font lacks", async () => {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc, { heading: { regular: CUSTOM_TTF }, body: "sans" });
    const [segment, ...rest] = fonts.heading.regular.segments("₹");
    expect(rest).toHaveLength(0);
    expect(segment.text).toBe("₹");
    expect(segment.font).not.toBe(fonts.heading.regular.segments("A")[0].font);
  });

  test("rejects WOFF2 by extension, naming the format and the slot", async () => {
    const doc = await PDFDocument.create();
    const attempt = embedFonts(doc, { heading: { regular: "Display.woff2" }, body: "sans" });
    await expect(attempt).rejects.toThrow(/heading font.*Display\.woff2 is a WOFF2 file/s);
  });

  test("rejects WOFF content whatever the file is called", async () => {
    const bytes = new Uint8Array(64);
    new DataView(bytes.buffer).setUint32(0, 0x774f4646); // "wOFF"
    const path = tmpFile("mislabeled.ttf", bytes);
    const doc = await PDFDocument.create();
    await expect(embedFonts(doc, { heading: { regular: path }, body: "sans" })).rejects.toThrow(
      /is a WOFF file/,
    );
  });

  test("reports a missing file by path and slot", async () => {
    const doc = await PDFDocument.create();
    const missing = resolve(tmpdir(), "outmute-no-such-font.ttf");
    await expect(embedFonts(doc, { heading: "sans", body: { regular: missing } })).rejects.toThrow(
      new RegExp(`body font: couldn't read ${missing}`),
    );
  });

  test("reports a corrupt font file", async () => {
    const path = tmpFile("truncated.ttf", readFileSync(CUSTOM_TTF).subarray(0, 512));
    const doc = await PDFDocument.create();
    await expect(embedFonts(doc, { heading: { regular: path }, body: "sans" })).rejects.toThrow(
      /heading font: couldn't parse/,
    );
  });

  test("rejects a file that isn't a font at all", async () => {
    const path = tmpFile("notes.txt", new TextEncoder().encode("not a font"));
    const doc = await PDFDocument.create();
    await expect(embedFonts(doc, { heading: { regular: path }, body: "sans" })).rejects.toThrow(
      /is not a readable TTF or OTF file/,
    );
  });

  test("accepts raw bytes, so uploads need no filesystem", async () => {
    const doc = await PDFDocument.create();
    const bytes = readFileSync(CUSTOM_TTF);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const fonts = await embedFonts(doc, { heading: { regular: buffer }, body: "sans" });
    expect(fonts.heading.regular.segments("A")[0].font).not.toBe(
      fonts.body.regular.segments("A")[0].font,
    );
  });
});
