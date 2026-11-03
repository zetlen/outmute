# Agent instructions for outmute

## Documentation

No emojis in documentation. That covers `README.md`, this file, everything
under `docs/`, the issue and pull request templates, and any other Markdown
in the repo. Use plain prose, headings, and code fences instead — no emoji
section markers, no emoji status bullets.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `zetlen/outmute` (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map 1:1 to labels of the same name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root (created lazily). See `docs/agents/domain.md`.

## Developer-side crosscheck

`scripts/check_invoice.py` verifies a generated invoice PDF against the
Clockify Detailed CSV it came from, independently of outmute's own code. It
sums exact h:mm:ss seconds per project, extracts the PDF with `pdftotext`
(poppler), and checks each line's hours and amount, fee lines, subtotal,
and total due. Run it after any change to the adapters, invoice math, or
PDF layout:

```
python3 -I scripts/check_invoice.py report.csv invoice.pdf [rate]
```

Exit status is non-zero on any discrepancy.
