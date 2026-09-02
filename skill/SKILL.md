---
name: outmute
description: Generate a PDF invoice from a Clockify Detailed report CSV export. Use when the user asks to create, generate, or draft an invoice from Clockify data, time-tracking hours, or a Clockify CSV, or asks to bill a client for tracked time.
---

# Generating invoices from Clockify CSVs

The tool is invoked as `{{CMD}}`. It turns a Clockify
"Detailed report" CSV export into a PDF invoice.

If the user didn't say which CSV to use, stop and ask for the path — do not
search the filesystem for CSVs or guess which file they meant. If they have no
CSV yet, tell them to export one in Clockify:
**Reports > Detailed > Export > Save as CSV**.

## How to run it

Always run non-interactively (`--no-input`) and pass everything as flags:

```sh
{{CMD}} <report.csv> --no-input -o <output.pdf> [flags]
```

Saved defaults (sender, client, per-project rates, tax…) live in
`~/.config/outmute/config.toml` (an older `config.json`, or the pre-rename
`~/.config/clockify-invoice/config.json`, is also read if no `config.toml`
exists yet); read it first if it exists — then you only need flags for what's
missing or different. If it doesn't exist and the user will invoice again,
offer to save their answers with `--save-config`.

Required knowledge before running — from the config file or by asking the user:

- Sender: `--from-name "Name"` and `--from-lines "addr;email;phone"` (`;`-separated)
- Client: `--to-name "Name"` and `--to-lines "…"`
- Hourly rate, only if the CSV has no billable-rate column: `--rate <n>`

Useful optional flags (full list: `--help`):

- `-n <number>` invoice number (default: prefix + last entry date)
- `-g description|project|day|entry` line-item grouping (default: description)
- `--tax-percent <n>`, `--net-days <n>`, `--currency <symbol>`
- `--subtotals` subtotal row per project; `--no-items` one summary row per
  project instead of its itemized entries (per-project rates and display
  settings go in the config file's `[projects."Name"]` tables)
- `--all` include non-billable entries; `--appendix` per-entry detail page
- `--accent "#rrggbb"` accent color, `--paper letter|a4`
- `--font-heading <v>` / `--font-body <v>` typeface per slot (heading = title,
  names, labels), or `--font <v>` for both; each value is `sans|serif|mono` or
  a TTF/OTF path, optionally `regular.ttf,bold.ttf`

## After generating

The command prints line-item count, hours, total, and due date — relay that
summary. Warnings on stderr (skipped non-billable entries, missing rates) are
worth surfacing to the user. Offer to open the PDF.
