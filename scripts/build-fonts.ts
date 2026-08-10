/**
 * Convert the Fontsource WOFF2 subsets to TTF in src/fonts/, which pdf-lib
 * can embed. Run once after changing font packages: bun scripts/build-fonts.ts
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error wawoff2 ships no types
import { decompress } from "wawoff2";

const ROOT = resolve(import.meta.dir, "..");
const OUT = resolve(ROOT, "src/fonts");

const FAMILIES = {
  "inter": "@fontsource/inter",
  "source-serif-4": "@fontsource/source-serif-4",
  "jetbrains-mono": "@fontsource/jetbrains-mono",
} as const;
// Subset order matters downstream: it's the per-character fallback priority.
const SUBSETS = ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek", "vietnamese"];
const WEIGHTS = [400, 700];

mkdirSync(OUT, { recursive: true });
for (const [family, pkg] of Object.entries(FAMILIES)) {
  const dir = resolve(ROOT, "node_modules", pkg);
  copyFileSync(resolve(dir, "LICENSE"), resolve(OUT, `${family}-LICENSE`));
  for (const subset of SUBSETS) {
    for (const weight of WEIGHTS) {
      const name = `${family}-${subset}-${weight}-normal.woff2`;
      let woff2: Buffer;
      try {
        woff2 = readFileSync(resolve(dir, "files", name));
      } catch {
        console.warn(`skip (not in package): ${name}`);
        continue;
      }
      const ttf = await decompress(woff2);
      const out = resolve(OUT, `${family}-${subset}-${weight}.ttf`);
      writeFileSync(out, ttf);
      console.log(`${out.replace(ROOT + "/", "")} (${(ttf.length / 1024).toFixed(0)} KB)`);
    }
  }
}
