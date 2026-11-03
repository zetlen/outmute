#!/usr/bin/env python3
"""Independent check: Clockify detailed CSV vs outmute invoice PDF.
usage: python3 -I check_invoice.py report.csv invoice.pdf [rate]"""
import csv, re, subprocess, sys
from collections import defaultdict
from decimal import Decimal as D, ROUND_HALF_UP

csv_path, pdf_path = sys.argv[1], sys.argv[2]
rate = D(sys.argv[3]) if len(sys.argv) > 3 else None
cents = lambda x: x.quantize(D("0.01"), ROUND_HALF_UP)

# --- CSV: seconds per (project, client), billable only ---
secs, dec, skipped = defaultdict(int), defaultdict(D), []
with open(csv_path, newline="") as f:
    for r in csv.DictReader(f):
        if r["Billable"] != "Yes":
            skipped.append(r); continue
        h, m, s = map(int, r["Duration (h)"].split(":"))
        key = r["Project"]  # keyed by project; client suffix handled at match time
        secs[key] += h * 3600 + m * 60 + s
        dec[key] += D(r["Duration (decimal)"])

# --- PDF: line items, rate, totals ---
txt = subprocess.run(["pdftotext", "-layout", pdf_path, "-"], check=True, capture_output=True, text=True).stdout
line_re = re.compile(r"^\s*(.+?)\s{2,}([\d.]+)\s+\$([\d,.]+)\s+\$([\d,.]+)\s*$", re.M)
items = {d: (D(h), D(r), D(a.replace(",", ""))) for d, h, r, a in line_re.findall(txt)}
# fee lines: description + amount only, no hours/rate (anything in the Fees section)
fee_re = re.compile(r"^\s*(?!Subtotal|Total Due)(\S.*?)\s{2,}\$([\d,.]+)\s*$", re.M)
fees = {d: D(a.replace(",", "")) for d, a in fee_re.findall(txt) if d not in items and not re.search(r"\d+\.\d+\s+\$", d)}
# normalise "Project (Client)" labels down to the CSV project name
norm = lambda d: re.sub(r" \([^()]*\)$", "", d)
items = {norm(d): v for d, v in items.items()}
money = lambda label: D(re.search(rf"{label}\s+\$([\d,.]+)", txt).group(1).replace(",", ""))
subtotal, total = money("Subtotal"), money("Total Due")

# --- compare ---
bad = 0
def fail(msg):
    global bad; bad += 1; print("DISCREPANCY:", msg)

for k in sorted(set(secs) | set(items)):
    if k not in items: fail(f"{k}: in CSV ({secs[k]/3600:.2f}h) but not on invoice"); continue
    if k not in secs: fail(f"{k}: on invoice but not in CSV"); continue
    pdf_h, pdf_rate, pdf_amt = items[k]
    exact_h = D(secs[k]) / 3600
    before = bad
    if cents(exact_h) != pdf_h:
        fail(f"{k}: hours from exact seconds {cents(exact_h)} ({secs[k]}s) vs PDF {pdf_h}"
             f" (sum of Clockify's per-row rounded decimals = {dec[k]})")
    if rate and pdf_rate != rate: fail(f"{k}: rate {pdf_rate} != {rate}")
    # amount is computed from exact seconds, not the displayed 2-decimal hours
    exact_amt = cents(D(secs[k]) * pdf_rate / 3600)  # multiply first: exact, no repeating decimals
    if exact_amt != pdf_amt:
        fail(f"{k}: exact {secs[k]}s x {pdf_rate} = {exact_amt} but PDF shows {pdf_amt}")
    if bad == before: print(f"ok  {k:45} {pdf_h:>7}h  ${pdf_amt:>10}")

for d, a in fees.items(): print(f"fee {d:45} {'':>8}  ${a:>10}  (not from CSV)")
sum_amt = sum(a for _, _, a in items.values()) + sum(fees.values())
if sum_amt != subtotal: fail(f"line items sum {sum_amt} != Subtotal {subtotal}")
if subtotal != total: fail(f"Subtotal {subtotal} != Total Due {total}")
if skipped: print(f"note: {len(skipped)} non-billable rows excluded")
total_secs = sum(secs.values())
if rate:
    exact_total = cents(D(total_secs) * rate / 3600) + sum(fees.values())
    if exact_total != total: fail(f"exact seconds {total_secs}s x {rate} + fees = {exact_total} != Total Due {total}")
print(f"CSV exact total {total_secs//3600}:{total_secs%3600//60:02}:{total_secs%60:02} ({D(total_secs)/3600:.4f}h)"
      f" -> ${cents(D(total_secs)*rate/3600) if rate else '?'} + fees ${sum(fees.values())}   PDF Total Due ${total}")
print("RESULT:", "FAIL" if bad else "PASS, no discrepancies")
sys.exit(1 if bad else 0)
