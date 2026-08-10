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

// Assets in per-character fallback priority order (latin first). Serif and
// mono end with Inter's latin subsets so glyphs those families lack (e.g.
// JetBrains Mono has no ₹) degrade to a sans glyph instead of "?".
const MANIFEST: Record<FontFamily, { regular: string[]; bold: string[] }> = {
  sans: {
    regular: [interLatin400, interLatinExt400, interCyrillic400, interCyrillicExt400, interGreek400, interVietnamese400],
    bold: [interLatin700, interLatinExt700, interCyrillic700, interCyrillicExt700, interGreek700, interVietnamese700],
  },
  serif: {
    regular: [serifLatin400, serifLatinExt400, serifCyrillic400, serifCyrillicExt400, serifGreek400, serifVietnamese400, interLatin400, interLatinExt400],
    bold: [serifLatin700, serifLatinExt700, serifCyrillic700, serifCyrillicExt700, serifGreek700, serifVietnamese700, interLatin700, interLatinExt700],
  },
  mono: {
    regular: [monoLatin400, monoLatinExt400, monoCyrillic400, monoCyrillicExt400, monoGreek400, monoVietnamese400, interLatin400, interLatinExt400],
    bold: [monoLatin700, monoLatinExt700, monoCyrillic700, monoCyrillicExt700, monoGreek700, monoVietnamese700, interLatin700, interLatinExt700],
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

export async function embedFamily(doc: PDFDocument, family: FontFamily): Promise<FontSet> {
  doc.registerFontkit(fontkit);
  const face = async (assets: string[]): Promise<Face> =>
    new Face(
      await Promise.all(
        assets.map(async (asset) => {
          const pdf = await doc.embedFont(await loadBytes(asset), { subset: true });
          return { pdf, chars: new Set(pdf.getCharacterSet()) };
        }),
      ),
    );
  const manifest = MANIFEST[family];
  return { regular: await face(manifest.regular), bold: await face(manifest.bold) };
}
