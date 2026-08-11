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

## Setup

```sh
bun install
```

## 1. Web page (everything stays in your browser)

```sh
bun run web            # dev server
bun run build:web      # static build in dist/ — host it anywhere
```

Fill in the form, drop the CSV on the dropzone, click **Generate PDF**. The
file is parsed and the PDF is produced entirely client-side; nothing is
uploaded. Form values persist in localStorage for repeat invoices.

The CLI can also host the web version locally:

```sh
bun run src/cli.ts serve            # http://localhost:4520
bun run src/cli.ts serve --port 8080
```

## 2. Interactive CLI

```sh
bun run cli
# or: bun run src/cli.ts report.csv
```

On a terminal, anything missing is asked for with validation and sensible
defaults (CSV path, sender, client, rate if the CSV has none, tax, terms,
invoice number, output path), and you can save your answers as the config for
next time.

## 3. Non-interactive CLI

```sh
bun run src/cli.ts report.csv --no-input \
  --from-name "Your Name" --from-lines "123 Example St;you@example.com" \
  --to-name "Client, Inc." --rate 125 --tax-percent 8.875 \
  --appendix -o invoice.pdf
```

`--no-input` guarantees no prompts (it's also implied when stdin isn't a
terminal, e.g. in CI). Run `bun run src/cli.ts --help` for all flags:
grouping (`-g description|project|day|entry`), non-billable entries
(`--all`), per-entry appendix page (`--appendix`), currency, net days,
rounding, accent color (`--accent "#7a2048"`), typeface
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
The TTFs in `src/fonts/` are generated from the Fontsource packages by
`bun scripts/build-fonts.ts`.

## Claude Code skill

`bun run src/cli.ts --install-skill` installs a skill at
`~/.claude/skills/outmute/` so Claude can generate invoices with
this tool when you ask. Interactive runs also offer to install it.

## Notes

- Line items group entries by description (default), project, day, or not at
  all; totals, tax, and optional round-up-to-N-minutes match the original
  Python version (`clockifyinvoice`, kept in git history).
- Contributions land via pull request; CI runs formatting, lint, type, and
  test checks plus a conventional-commit PR title check.
