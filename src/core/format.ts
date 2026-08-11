const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  NZD: "NZ$",
  INR: "₹",
  JPY: "¥",
  CHF: "CHF",
  SEK: "kr",
};

/** Display symbol for an ISO 4217 code; unknown codes render as the code itself. */
export function symbolForCurrency(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return CURRENCY_SYMBOLS[code] ?? code;
}

/** "2026-08-05" -> "Aug 5, 2026" */
export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

export function todayISO(): string {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function toISO(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Add whole days to an ISO date string. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function money(symbol: string, amount: number): string {
  const sep = symbol.length > 1 ? " " : "";
  return `${symbol}${sep}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtHours(hours: number): string {
  return hours.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Lenient numeric parse: strips currency symbols, handles "1.234,56" and "1,234.56". */
export function parseNumber(raw: string | undefined | null): number {
  let s = (raw ?? "").replace(/[^\d.,-]/g, "").trim();
  if (!s) return 0;
  if (s.includes(",") && !s.includes(".")) s = s.replace(/,/g, ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
