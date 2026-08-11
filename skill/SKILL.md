---
name: outmute
description: Generate a PDF invoice from a Clockify Detailed report CSV export. Use when the user asks to create, generate, or draft an invoice from Clockify data, time-tracking hours, or a Clockify CSV, or asks to bill a client for tracked time.
---

# Generating invoices from Clockify CSVs

The tool lives at `{{REPO}}` and runs with Bun. It turns a Clockify
"Detailed report" CSV export into a PDF invoice.

If the user has no CSV yet, tell them to export one in Clockify:
**Reports > Detailed > Export > Save as CSV**.

## How to run it

Always run non-interactively (`--no-input`) and pass everything as flags:

```sh
bun run {{REPO}}/src/cli.ts <report.csv> --no-input -o <output.pdf> [flags]
```

Saved defaults (sender, client, rates, tax…) live in
`~/.config/outmute/config.json` (or the pre-rename
`~/.config/clockify-invoice/config.json`); read it first if it exists — then
you only need flags for what's missing or different. If it doesn't exist and
the user will invoice again, offer to save their answers with `--save-config`.

Required knowledge before running — from the config file or by asking the user:

- Sender: `--from-name "Name"` and `--from-lines "addr;email;phone"` (`;`-separated)
- Client: `--to-name "Name"` and `--to-lines "…"`
- Hourly rate, only if the CSV has no billable-rate column: `--rate <n>`

Useful optional flags (full list: `--help`):

- `-n <number>` invoice number (default: prefix + last entry date)
- `-g description|project|day|entry` line-item grouping (default: description)
- `--tax-percent <n>`, `--net-days <n>`, `--currency <symbol>`
- `--all` include non-billable entries; `--appendix` per-entry detail page
- `--accent "#rrggbb"` accent color, `--font sans|serif|mono`, `--paper letter|a4`

## After generating

The command prints line-item count, hours, total, and due date — relay that
summary. Warnings on stderr (skipped non-billable entries, missing rates) are
worth surfacing to the user. Offer to open the PDF.
