import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

import interLatin400 from "../fonts/inter-latin-400.ttf";
import interLatin700 from "../fonts/inter-latin-700.ttf";
import interLatinExt400 from "../fonts/inter-latin-ext-400.ttf";
import interLatinExt700 from "../fonts/inter-latin-ext-700.ttf";
import interCyrillic400 from "../fonts/inter-cyrillic-400.ttf";
import interCyrillic700 from "../fonts/inter-cyrillic-700.ttf";
import interCyrillicExt400 from "../fonts/inter-cyrillic-ext-400.ttf";
import interCyrillicExt700 from "../fonts/inter-cyrillic-ext-700.ttf";
import interGreek400 from "../fonts/inter-greek-400.ttf";
import interGreek700 from "../fonts/inter-greek-700.ttf";
import interVietnamese400 from "../fonts/inter-vietnamese-400.ttf";
import interVietnamese700 from "../fonts/inter-vietnamese-700.ttf";
import serifLatin400 from "../fonts/source-serif-4-latin-400.ttf";
import serifLatin700 from "../fonts/source-serif-4-latin-700.ttf";
import serifLatinExt400 from "../fonts/source-serif-4-latin-ext-400.ttf";
import serifLatinExt700 from "../fonts/source-serif-4-latin-ext-700.ttf";
import serifCyrillic400 from "../fonts/source-serif-4-cyrillic-400.ttf";
import serifCyrillic700 from "../fonts/source-serif-4-cyrillic-700.ttf";
import serifCyrillicExt400 from "../fonts/source-serif-4-cyrillic-ext-400.ttf";
import serifCyrillicExt700 from "../fonts/source-serif-4-cyrillic-ext-700.ttf";
import serifGreek400 from "../fonts/source-serif-4-greek-400.ttf";
import serifGreek700 from "../fonts/source-serif-4-greek-700.ttf";
import serifVietnamese400 from "../fonts/source-serif-4-vietnamese-400.ttf";
import serifVietnamese700 from "../fonts/source-serif-4-vietnamese-700.ttf";
import monoLatin400 from "../fonts/jetbrains-mono-latin-400.ttf";
import monoLatin700 from "../fonts/jetbrains-mono-latin-700.ttf";
import monoLatinExt400 from "../fonts/jetbrains-mono-latin-ext-400.ttf";
import monoLatinExt700 from "../fonts/jetbrains-mono-latin-ext-700.ttf";
import monoCyrillic400 from "../fonts/jetbrains-mono-cyrillic-400.ttf";
import monoCyrillic700 from "../fonts/jetbrains-mono-cyrillic-700.ttf";
import monoCyrillicExt400 from "../fonts/jetbrains-mono-cyrillic-ext-400.ttf";
import monoCyrillicExt700 from "../fonts/jetbrains-mono-cyrillic-ext-700.ttf";
import monoGreek400 from "../fonts/jetbrains-mono-greek-400.ttf";
import monoGreek700 from "../fonts/jetbrains-mono-greek-700.ttf";
import monoVietnamese400 from "../fonts/jetbrains-mono-vietnamese-400.ttf";
import monoVietnamese700 from "../fonts/jetbrains-mono-vietnamese-700.ttf";

export type FontFamily = "sans" | "serif" | "mono";
export const FONT_FAMILIES: FontFamily[] = ["sans", "serif", "mono"];
export const FONT_LABELS: Record<FontFamily, string> = {
  sans: "Inter (sans-serif)",
  serif: "Source Serif 4",
  mono: "JetBrains Mono",
};

export function isFontFamily(value: unknown): value is FontFamily {
  return typeof value === "string" && (FONT_FAMILIES as string[]).includes(value);
}

/** Independently styled parts of the document. */
export type FontSlot = "heading" | "body";
export const FONT_SLOTS: FontSlot[] = ["heading", "body"];

/** A font file: a filesystem path/URL, or its bytes (e.g. a browser upload). */
export type FontSource = string | ArrayBuffer | Uint8Array;

/** User-supplied font files. With no `bold`, `regular` serves both weights. */
export interface CustomFont {
  regular: FontSource;
  bold?: FontSource;
}

/** What a slot renders in: a bundled family, or user-supplied file(s). */
export type FontSpec = FontFamily | CustomFont;

export type FontSlots = Record<FontSlot, FontSpec>;

/** A font the user asked for that can't be read, parsed, or embedded. */
export class FontError extends Error {}

// Assets in per-character fallback priority order (latin first). Serif and
// mono end with Inter's latin subsets so glyphs those families lack (e.g.
// JetBrains Mono has no ₹) degrade to a sans glyph instead of "?".
const MANIFEST: Record<FontFamily, { regular: string[]; bold: string[] }> = {
  sans: {
    regular: [
      interLatin400,
      interLatinExt400,
      interCyrillic400,
      interCyrillicExt400,
      interGreek400,
      interVietnamese400,
    ],
    bold: [
      interLatin700,
      interLatinExt700,
      interCyrillic700,
      interCyrillicExt700,
      interGreek700,
      interVietnamese700,
    ],
  },
  serif: {
    regular: [
      serifLatin400,
      serifLatinExt400,
      serifCyrillic400,
      serifCyrillicExt400,
      serifGreek400,
      serifVietnamese400,
      interLatin400,
      interLatinExt400,
    ],
    bold: [
      serifLatin700,
      serifLatinExt700,
      serifCyrillic700,
      serifCyrillicExt700,
      serifGreek700,
      serifVietnamese700,
      interLatin700,
      interLatinExt700,
    ],
  },
  mono: {
    regular: [
      monoLatin400,
      monoLatinExt400,
      monoCyrillic400,
      monoCyrillicExt400,
      monoGreek400,
      monoVietnamese400,
      interLatin400,
      interLatinExt400,
    ],
    bold: [
      monoLatin700,
      monoLatinExt700,
      monoCyrillic700,
      monoCyrillicExt700,
      monoGreek700,
      monoVietnamese700,
      interLatin700,
      interLatinExt700,
    ],
  },
};

interface Variant {
  pdf: PDFFont;
  chars: Set<number>;
}

export interface Segment {
  font: PDFFont;
  text: string;
}

/**
 * One weight of a family, embedded as several script-subset fonts.
 * Splits strings into per-font runs; characters no subset covers become "?".
 */
export class Face {
  constructor(private variants: Variant[]) {}

  segments(text: string): Segment[] {
    const runs: { index: number; text: string }[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      let index = this.variants.findIndex((v) => v.chars.has(cp));
      let out = ch;
      if (index === -1) {
        index = 0;
        out = "?";
      }
      const last = runs[runs.length - 1];
      if (last && last.index === index) last.text += out;
      else runs.push({ index, text: out });
    }
    return runs.map((run) => ({ font: this.variants[run.index].pdf, text: run.text }));
  }

  widthOf(text: string, size: number): number {
    return this.segments(text).reduce(
      (sum, seg) => sum + seg.font.widthOfTextAtSize(seg.text, size),
      0,
    );
  }
}

export interface FontSet {
  regular: Face;
  bold: Face;
}

async function loadBytes(asset: string): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    const { readFileSync } = await import("node:fs");
    return new Uint8Array(readFileSync(asset));
  }
  const res = await fetch(asset);
  if (!res.ok) throw new Error(`failed to fetch font ${asset}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const describe = (source: FontSource) =>
  typeof source === "string" ? source : "the supplied font data";

// sfnt wrappers pdf-lib can embed: TrueType, "true", TrueType collection, OTTO.
const SFNT_TAGS = new Set([0x00010000, 0x74727565, 0x74746366, 0x4f54544f]);
const WOFF_TAGS: Record<number, string> = { 0x774f4646: "WOFF", 0x774f4632: "WOFF2" };

const woffError = (source: FontSource, slot: FontSlot, format: string) =>
  new FontError(
    `${slot} font: ${describe(source)} is a ${format} file; ` +
      `convert it to TTF or OTF first (web fonts can't be embedded in a PDF)`,
  );

async function readFontSource(source: FontSource, slot: FontSlot): Promise<Uint8Array> {
  let bytes: Uint8Array;
  if (typeof source === "string") {
    // Catch the common mistake by name before spending a read on it.
    const ext = /\.(woff2?)$/i.exec(source);
    if (ext) throw woffError(source, slot, ext[1].toLowerCase() === "woff2" ? "WOFF2" : "WOFF");
    try {
      bytes = await loadBytes(source);
    } catch (err) {
      throw new FontError(`${slot} font: couldn't read ${source}: ${(err as Error).message}`);
    }
  } else {
    bytes = source instanceof Uint8Array ? new Uint8Array(source) : new Uint8Array(source);
  }
  const tag = bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) : -1;
  if (WOFF_TAGS[tag]) throw woffError(source, slot, WOFF_TAGS[tag]);
  if (!SFNT_TAGS.has(tag)) {
    throw new FontError(`${slot} font: ${describe(source)} is not a readable TTF or OTF file`);
  }
  return bytes;
}

/** Per-slot embedded weights, ready for the renderer. */
export type EmbeddedFonts = Record<FontSlot, FontSet>;

/**
 * Embed both slots into `doc`. Custom fonts get the bundled Inter subsets
 * appended to their fallback chain, so glyphs they lack (e.g. ₹) degrade to
 * sans instead of "?". Sources shared between slots are embedded once.
 */
export async function embedFonts(doc: PDFDocument, slots: FontSlots): Promise<EmbeddedFonts> {
  doc.registerFontkit(fontkit);
  const embedded = new Map<FontSource, Promise<Variant>>();
  const variant = (source: FontSource, slot: FontSlot): Promise<Variant> => {
    let pending = embedded.get(source);
    if (!pending) {
      pending = embedOne(doc, source, slot);
      embedded.set(source, pending);
    }
    return pending;
  };
  const face = async (sources: FontSource[], slot: FontSlot): Promise<Face> =>
    new Face(await Promise.all(sources.map((source) => variant(source, slot))));

  const out = {} as EmbeddedFonts;
  for (const slot of FONT_SLOTS) {
    const spec = slots[slot];
    const chain = isFontFamily(spec)
      ? MANIFEST[spec]
      : {
          regular: [spec.regular, ...MANIFEST.sans.regular],
          bold: [spec.bold ?? spec.regular, ...MANIFEST.sans.bold],
        };
    out[slot] = { regular: await face(chain.regular, slot), bold: await face(chain.bold, slot) };
  }
  return out;
}

async function embedOne(doc: PDFDocument, source: FontSource, slot: FontSlot): Promise<Variant> {
  const bytes = await readFontSource(source, slot);
  try {
    const pdf = await doc.embedFont(bytes, { subset: true });
    return { pdf, chars: new Set(pdf.getCharacterSet()) };
  } catch (err) {
    throw new FontError(
      `${slot} font: couldn't parse ${describe(source)}: ${(err as Error).message}`,
    );
  }
}

/** Parse a CLI font value: a family name, or `regular[,bold]` file paths. */
export function parseFontValue(
  value: string,
  flag: string,
  resolvePath: (path: string) => string,
): FontSpec {
  const trimmed = value.trim();
  if (isFontFamily(trimmed)) return trimmed;
  const paths = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!paths.length) {
    throw new FontError(
      `invalid ${flag} ${JSON.stringify(value)}; use ${FONT_FAMILIES.join("|")} ` +
        `or a TTF/OTF path (regular[,bold])`,
    );
  }
  if (paths.length > 2) {
    throw new FontError(
      `invalid ${flag} ${JSON.stringify(value)}; expected at most two font files (regular,bold)`,
    );
  }
  return {
    regular: resolvePath(paths[0]),
    ...(paths[1] ? { bold: resolvePath(paths[1]) } : {}),
  };
}

/** Apply flag precedence: `--font-<slot>` beats `--font`, which beats `base`. */
export function resolveFontSlots(
  base: FontSlots,
  flags: { font?: string; heading?: string; body?: string },
  resolvePath: (path: string) => string,
): FontSlots {
  const pick = (slot: FontSlot): FontSpec => {
    const own = slot === "heading" ? flags.heading : flags.body;
    if (own !== undefined) return parseFontValue(own, `--font-${slot}`, resolvePath);
    if (flags.font !== undefined) return parseFontValue(flags.font, "--font", resolvePath);
    return base[slot];
  };
  return { heading: pick("heading"), body: pick("body") };
}

/** Read the `invoice.fonts` config block, falling back per slot. */
export function parseFontSlotsConfig(raw: unknown, fallback: FontSlots): FontSlots {
  const slots = (raw ?? {}) as Record<string, unknown>;
  const one = (value: unknown, fb: FontSpec): FontSpec => {
    if (isFontFamily(value)) return value;
    const o = value as Record<string, unknown> | null;
    if (o && typeof o === "object" && typeof o.regular === "string" && o.regular.trim()) {
      return {
        regular: o.regular,
        ...(typeof o.bold === "string" && o.bold.trim() ? { bold: o.bold } : {}),
      };
    }
    return fb;
  };
  return { heading: one(slots.heading, fallback.heading), body: one(slots.body, fallback.body) };
}

/** Re-anchor custom font paths, e.g. against the config file's directory. */
export function anchorFontPaths(
  slots: FontSlots,
  resolvePath: (path: string) => string,
): FontSlots {
  const anchor = (spec: FontSpec): FontSpec => {
    if (isFontFamily(spec)) return spec;
    return {
      regular: typeof spec.regular === "string" ? resolvePath(spec.regular) : spec.regular,
      ...(spec.bold !== undefined
        ? { bold: typeof spec.bold === "string" ? resolvePath(spec.bold) : spec.bold }
        : {}),
    };
  };
  return { heading: anchor(slots.heading), body: anchor(slots.body) };
}
