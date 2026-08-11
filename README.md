# outmute

Turn a time-tracking report into a nice-looking PDF invoice. ("In voice" ⇒
"out mute".) Clockify "Detailed report" CSV exports are the supported input
format so far — Clockify's own invoicing is a paid feature; this is the free
version. Other trackers just need an adapter (`src/adapters/`).

Export the CSV in Clockify: **Reports > Detailed > Export > Save as CSV**.
The CSV supplies dates, hours, projects, and billable rates; everything else
(sender, client, tax, terms) comes from your answers, flags, or a config file.

TypeScript throughout, one shared core. The PDF is generated with
[pdf-lib](https://pdf-lib.js.org/) — no Chrome, no server, works in Bun and
the browser.

## Install

```sh
curl -fsSL https://zetlen.github.io/outmute/install.sh | sh
```

Downloads the latest release binary for your platform, verifies it against
`SHASUMS256.txt`, and installs it to `~/.local/bin` (override with
`OUTMUTE_INSTALL_DIR`; pin a version with `OUTMUTE_VERSION`). Re-run to
update. On Windows, grab the `windows-x64` zip from the
[releases page](https://github.com/zetlen/outmute/releases).

## 1. Web page (everything stays in your browser)

```sh
outmute serve            # http://localhost:4520
outmute serve --port 8080
```

Fill in the form, drop the CSV on the dropzone, click **Generate PDF**. The
file is parsed and the PDF is produced entirely client-side; nothing is
uploaded. Form values persist in localStorage for repeat invoices.

The same page is a static build you can host anywhere — see
[Developer](#developer).

## 2. Interactive CLI

```sh
outmute
# or: outmute report.csv
```

On a terminal, anything missing is asked for with validation and sensible
defaults (CSV path, sender, client, rate if the CSV has none, tax, terms,
invoice number, output path), and you can save your answers as the config for
next time.

## 3. Non-interactive CLI

```sh
outmute report.csv --no-input \
  --from-name "Your Name" --from-lines "123 Example St;you@example.com" \
  --to-name "Client, Inc." --rate 125 --tax-percent 8.875 \
  --appendix -o invoice.pdf
```

`--no-input` guarantees no prompts (it's also implied when stdin isn't a
terminal, e.g. in CI). Run `outmute --help` for all flags: grouping
(`-g description|project|day|entry`), non-billable entries (`--all`),
per-entry appendix page (`--appendix`), input format (`--input-format`),
currency, net days, rounding, accent color (`--accent "#7a2048"`), typeface
(`--font sans|serif|mono`), paper size, and more.

## Config file

Defaults live in `~/.config/outmute/config.json` (a pre-rename
`~/.config/clockify-invoice/config.json` is still honored)
(`--init` writes a starter; `-c path` uses another file; `--save-config`
writes the effective settings back). Flags override the config; the CSV's
"Billable Rate" column overrides the `rates` map, which is used as fallback
per project name with `"default"` covering the rest.

## Fonts

Three embedded typefaces (`--font`, or the Typeface dropdown): **Inter**
(sans, default), **Source Serif 4**, and **JetBrains Mono** — all
OFL-licensed, from [Fontsource](https://fontsource.org/). Coverage spans
Latin, Latin Extended, Cyrillic, Greek, and Vietnamese, with per-character
fallback across subsets (serif/mono additionally fall back to Inter for
glyphs they lack, e.g. ₹); only the glyphs actually used are embedded, so
PDFs stay small. Scripts outside that coverage (e.g. CJK) render as `?`.

## Tests

```bash
bun test                   # unit + CLI integration tests
bun run test:e2e:install   # one-time: download Chromium for Playwright
bun run test:e2e           # browser end-to-end tests
```

`bun test` covers the adapters, invoice math, and `src/cli.test.ts`, which
spawns the real CLI against the fixture CSVs in `test/fixtures/`. Each run gets
a throwaway `HOME`, so the suite never reads your own
`~/.config/outmute/config.json`.

`bun run test:e2e` starts `outmute serve` and drives the page in Chromium —
form, CSV dropzone, and Generate PDF — checking the downloaded file really is a
PDF. Nothing in either suite touches the network.

## Claude Code skill

`outmute --install-skill` installs a skill at `~/.claude/skills/outmute/` so
Claude can generate invoices with this tool when you ask. Interactive runs
also offer to install it.

## Notes

- Line items group entries by description (default), project, day, or not at
  all; totals, tax, and optional round-up-to-N-minutes match the original
  Python version (`clockifyinvoice`, kept in git history).

## Developer

Everything below runs from a clone of the repo rather than the installed
binary. [Bun](https://bun.sh/) is the only prerequisite.

```sh
git clone https://github.com/zetlen/outmute.git
cd outmute
bun install            # also installs the lefthook git hooks via "prepare"
```

Run the CLI from source with `bun run cli` (equivalent to
`bun run src/cli.ts`), which takes the same arguments as `outmute`.

Web version:

```sh
bun run web            # dev server
bun run build:web      # static build in dist/ — host it anywhere
```

Checks (all of these run in CI, and lefthook runs the first two on commit and
the rest on push):

```sh
bun run fmt:check      # oxfmt
bun run lint           # oxlint
bun run typecheck      # tsc --noEmit
bun test               # unit + CLI integration tests
bun run test:e2e       # Playwright browser tests (first: bun run test:e2e:install)
```

The TTFs in `src/fonts/` are generated from the Fontsource packages by
`bun scripts/build-fonts.ts`; re-run it after bumping a Fontsource
dependency.

Contributions land via pull request; CI runs formatting, lint, type, unit,
CLI-integration, and browser e2e checks plus a conventional-commit PR title
check.
