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

macOS and Linux, in a terminal:

```sh
curl -fsSL https://zetlen.github.io/outmute/install.sh | sh
```

Windows, in PowerShell (press Start, type "PowerShell", hit Enter):

```powershell
irm https://zetlen.github.io/outmute/install.ps1 | iex
```

Either one downloads the latest release binary for your platform, verifies it
against `SHASUMS256.txt`, and installs it. Re-run to update.

The Unix script installs to `~/.local/bin` and tells you if that is not on your
`PATH`. The Windows script installs to `%LOCALAPPDATA%\Programs\outmute` and
adds that folder to your user `PATH` for you, so open a new terminal afterwards
and `outmute` is there. Both take the same settings, as environment variables:

- `OUTMUTE_INSTALL_DIR` — install somewhere else.
- `OUTMUTE_VERSION` — pin a version, e.g. `2.1.2`.
- `OUTMUTE_NO_MODIFY_PATH` — Windows only; set to `1` to leave `PATH` alone.

In PowerShell you set one like this before the install line:

```powershell
$env:OUTMUTE_INSTALL_DIR = 'C:\tools\outmute'
irm https://zetlen.github.io/outmute/install.ps1 | iex
```

If you would rather read the Windows script before running it, save it and run
it as a file — `-ExecutionPolicy Bypass` because it is unsigned:

```powershell
irm https://zetlen.github.io/outmute/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallDir C:\tools\outmute
```

Windows on ARM works: there is no arm64 build, so the installer picks the x64
one, which Windows runs under emulation. Prefer to do it by hand? The
`windows-x64` zip on the
[releases page](https://github.com/zetlen/outmute/releases) holds a single
`outmute.exe`.

Tool managers that install directly from GitHub releases also work — the
release assets follow the `<name>-<version>-<os>-<arch>` convention they
expect:

```sh
mise use -g github:zetlen/outmute                  # mise
ubi --project zetlen/outmute --in ~/.local/bin     # ubi
eget zetlen/outmute                                # eget
```

Note for mise: its `minimum_release_age` guard hides brand-new releases, so
installing on the day of a release needs `MISE_MINIMUM_RELEASE_AGE=0` (or
just wait a day).

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
(`-g description|project|day|entry`), per-project subtotals and summary rows
(`--subtotals`, `--no-items`), non-billable entries (`--all`), per-entry
appendix page (`--appendix`), input format (`--input-format`), currency, net
days, rounding, accent color (`--accent "#7a2048"`), typefaces (`--font`,
`--font-heading`, `--font-body`), paper size, and more.

## Config file

Defaults live in `~/.config/outmute/config.toml` (`--init` writes a
commented starter; `-c path` uses another file; `--save-config` writes the
effective settings back). A config file from before this tool switched to
TOML — `~/.config/outmute/config.json`, or the pre-rename
`~/.config/clockify-invoice/config.json` — is still read if no `config.toml`
exists yet; `-c path.json` also still works. Flags override the config.

Everything that varies by project lives in one `[projects]` table keyed by
the project name in the time report: the hourly `rate`, and the `items` and
`subtotal` display switches described below. `default` covers projects not
listed, and a named entry only needs the keys it changes. The CSV's
"Billable Rate" column, when present, beats any configured rate.

```toml
[projects.default]
rate = 130

[projects."Awards"]
rate = 50
```

Keys outmute doesn't recognize are reported as warnings rather than
silently ignored.

## Per-project rows and subtotals

By default the line items are one flat, date-ordered list. Two switches
change how each project's entries appear:

- **Subtotals** (`--subtotals`, or the "Add a subtotal row per project"
  checkbox) block the line items by project, with the project name as a
  heading and a subtotal row after its entries.
- **Hiding itemized rows** (`--no-items`, or unchecking "Show itemized rows
  per project") collapses a project into a single summary row carrying its
  name, hours, rate, and amount. A project billed at several rates gets one
  row per rate plus a subtotal.

`--no-subtotals` and `--items` turn either back off when the config file has
them on. Both flags set the defaults; the config file can also set them per
project name, with a named entry only listing the keys it changes:

```toml
[projects.default]
rate = 130
items = true
subtotal = true

[projects."Retainer Client"]
items = false
```

Whenever any project deviates from `items = true, subtotal = false`, the
whole invoice is sectioned by project in order of first activity.

## Fonts

Two independent slots: **heading** (the INVOICE title, the sender and client
names, and the small uppercase labels) and **body** (everything else). Set
them with `--font-heading` and `--font-body`, or both at once with `--font`;
a per-slot flag wins over `--font`. The browser version has a dropdown for
each. Both default to sans.

Three typefaces are embedded: **Inter** (`sans`, the default), **Source Serif
4** (`serif`), and **JetBrains Mono** (`mono`) — all OFL-licensed, from
[Fontsource](https://fontsource.org/). Coverage spans Latin, Latin Extended,
Cyrillic, Greek, and Vietnamese, with per-character fallback across subsets
(serif/mono additionally fall back to Inter for glyphs they lack, e.g. ₹);
only the glyphs actually used are embedded, so PDFs stay small. Scripts
outside that coverage (e.g. CJK) render as `?`.

A slot can also take your own **TTF or OTF** files (WOFF/WOFF2 are rejected —
convert them first). Pass one file, or a comma-separated `regular,bold` pair;
with one file it serves both weights, with no synthetic bolding. Inter is
appended to a custom font's fallback chain, so glyphs it lacks still render.

```sh
outmute report.csv --font-heading "fonts/Display.ttf,fonts/Display-Bold.ttf" --font-body serif
```

In the config file, `invoice.fonts` holds the two slots; paths there are
relative to the config file, while paths on the command line are relative to
the working directory.

```toml
[invoice.fonts]
heading = { regular = "fonts/Display.ttf", bold = "fonts/Display-Bold.ttf" }
body = "serif"
```

## Tests

```bash
bun test                   # unit + CLI integration tests
bun run test:e2e:install   # one-time: download Chromium for Playwright
bun run test:e2e           # browser end-to-end tests
```

`bun test` covers the adapters, invoice math, and `src/cli.test.ts`, which
spawns the real CLI against the fixture CSVs in `test/fixtures/`. Each run gets
a throwaway `HOME`, so the suite never reads your own
`~/.config/outmute/config.toml`.

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
bun run web            # dev server on port 3000, all interfaces
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
