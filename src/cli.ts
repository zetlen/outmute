#!/usr/bin/env bun
/**
 * outmute — generate a PDF invoice from a time-tracking report ("in voice" ⇒ "out mute").
 *
 * Interactive:      outmute
 * Non-interactive:  outmute report.csv -o invoice.pdf [flags]
 * Starter config:   outmute --init
 */
import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { AdapterError, adapterNames, parseTimesheet } from "./adapters";
import type { Timesheet } from "./core/timesheet";
import { computeInvoice, InvoiceError } from "./core/invoice";
import { renderInvoicePdf } from "./core/pdf";
import { fmtDay, fmtHours, money, symbolForCurrency } from "./core/format";
import { DEFAULT_CONFIG, mergeConfig, type GroupBy, type InvoiceConfig } from "./core/types";
import { anchorFontPaths, FontError, resolveFontSlots } from "./core/fonts";
import { VERSION } from "./core/version";
import index from "./web/index.html";
import skillTemplate from "../skill/SKILL.md" with { type: "text" };

const PROG = "outmute";
const GROUPS: GroupBy[] = ["description", "project", "day", "entry"];

/** VERSION is injected via --define for compiled binaries; running uncompiled
 * (`bun run src/cli.ts`) falls back to reading it from package.json. */
function getVersion(): string {
  if (VERSION) return VERSION;
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, "../package.json"), "utf8"));
  return pkg.version;
}

const USAGE = `\
${PROG} — generate a PDF invoice from a time-tracking report (e.g. a Clockify Detailed CSV)

Usage:
  ${PROG}                         interactive: prompts for anything missing
  ${PROG} <report.csv> [options]  non-interactive when all required info is available
  ${PROG} serve [--port <n>]      host the browser version at localhost (default port 4520)
  ${PROG} --init                  write a starter config and exit
  ${PROG} --install-skill         install the Claude Code skill and exit
  ${PROG} --version               print the version and exit

Options:
  -o, --output <path>       output PDF path (default: <number>.pdf)
  -c, --config <path>       config file, TOML or JSON by extension
                             (default: ~/.config/outmute/config.toml; an existing
                             .json config from before TOML is also read)
  -n, --number <id>         invoice number (default: prefix + last entry date)
  -g, --group <mode>        line item grouping: description|project|day|entry (default: description)
      --input-format <name> time report format (default: auto-detect; formats: ${adapterNames.join("|")})
      --all                 include entries marked non-billable
      --appendix            append a per-entry detail table on its own page
      --no-input            never prompt; fail if required info is missing
      --save-config         save the effective settings back to the config file
      --init                write a starter config and exit
  -h, --help                show this help

Config overrides (each replaces the corresponding config value):
      --from-name <name>        --to-name <name>
      --from-lines <a;b;c>      --to-lines <a;b;c>     address lines, ";"-separated
      --rate <n>                default hourly rate for entries without one
      --currency <symbol>       --tax-percent <n>      --tax-label <text>
      --net-days <n>            --round-up <minutes>   --notes <text>
      --accent <#rrggbb>        --paper letter|a4
      --subtotals               add a subtotal row after each project's line items
      --no-items                collapse each project into a single summary row
                                (--no-subtotals / --items turn either back off;
                                per-project settings live in the config file)

Typefaces (each value is sans|serif|mono — Inter, Source Serif 4, JetBrains
Mono — or your own "regular.ttf" / "regular.ttf,bold.ttf", TTF or OTF only):
      --font-heading <value>    title, sender/client names, section labels
      --font-body <value>       everything else
      --font <value>            sets both slots; a per-slot flag wins over it

Export the CSV in Clockify: Reports > Detailed > Export > Save as CSV.
`;

function die(message: string): never {
  console.error(`${PROG}: ${message}`);
  process.exit(1);
}

function warn(message: string): void {
  console.error(`${PROG}: warning: ${message}`);
}

function defaultConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
  const dir = resolve(base, "outmute");
  // Fall back to the pre-rename location so existing configs keep working.
  const legacyDir = resolve(base, "clockify-invoice");
  if (!existsSync(dir) && existsSync(legacyDir)) return legacyDir;
  return dir;
}

/** Where to read the config from: prefer TOML, but keep reading an existing
 * JSON config left over from before this tool switched formats. */
function defaultConfigPath(): string {
  const dir = defaultConfigDir();
  const toml = resolve(dir, "config.toml");
  if (existsSync(toml)) return toml;
  const json = resolve(dir, "config.json");
  return existsSync(json) ? json : toml;
}

function isJsonConfigPath(path: string): boolean {
  return path.toLowerCase().endsWith(".json");
}

const JSON_CONFIG_TEMPLATE: unknown = {
  from: {
    name: "Your Name",
    lines: ["123 Example Street", "Springfield, ST 00000", "you@example.com"],
  },
  to: { name: "Client, Inc.", lines: ["456 Client Avenue", "Métropole, ST 11111"] },
  invoice: { ...DEFAULT_CONFIG.invoice, fonts: { ...DEFAULT_CONFIG.invoice.fonts } },
  projects: { default: { rate: 100, ...DEFAULT_CONFIG.projects.default } },
};

const defaultInvoice = DEFAULT_CONFIG.invoice;
const TOML_CONFIG_TEMPLATE = `\
# outmute config — every value here is used whenever a flag doesn't override it.

[from]
name = "Your Name"
lines = ["123 Example Street", "Springfield, ST 00000", "you@example.com"]

[to]
name = "Client, Inc."
lines = ["456 Client Avenue", "Métropole, ST 11111"]

[invoice]
# Default invoice number is "<numberPrefix><last entry date as YYYYMMDD>".
numberPrefix = "${defaultInvoice.numberPrefix}"
# Due date = issue date + netDays.
netDays = ${defaultInvoice.netDays}
# Currency symbol; empty string takes it from the CSV, else "$".
currency = "${defaultInvoice.currency}"
# 0 disables the tax line.
taxPercent = ${defaultInvoice.taxPercent}
taxLabel = "${defaultInvoice.taxLabel}"
# e.g. 15 rounds each line item's hours up to the quarter hour.
roundUpMinutes = ${defaultInvoice.roundUpMinutes}
# May contain a {net_days} placeholder.
notes = "${defaultInvoice.notes}"
# Accent color, #rrggbb.
accent = "${defaultInvoice.accent}"
paper = "${defaultInvoice.paper}" # letter | a4

# Typeface per slot — heading styles the title, party names and section
# labels, body everything else. Each is sans | serif | mono, or your own
# TTF/OTF file(s): { regular = "path/to/regular.ttf", bold = "path/to/bold.ttf" }
# (bold optional; paths are relative to this file).
[invoice.fonts]
heading = "sans"
body = "sans"

# Per-project settings, keyed by the project name in the time report.
# "default" covers every project not listed, and a named entry only needs
# the keys it changes.
#   rate     hourly rate for entries that carry none of their own
#   items    false collapses the project into a single summary row (one per
#            rate, if its entries are billed at different rates, plus a
#            subtotal) instead of listing its itemized rows
#   subtotal true adds a subtotal row after the project's itemized rows
[projects.default]
rate = 100
items = true
subtotal = false

# [projects."Retainer Client"]
# rate = 80
# items = false
`;

interface Answers {
  serve: boolean;
  port: number;
  installSkill: boolean;
  csvPath?: string;
  inputFormat?: string;
  output?: string;
  number?: string;
  group: GroupBy;
  all: boolean;
  appendix: boolean;
  saveConfig: boolean;
  configPath: string;
  configExplicit: boolean;
  interactive: boolean;
}

type Overrides = Record<string, string | boolean | undefined>;

function parseCliArgs(): { answers: Answers; overrides: Overrides } {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        config: { type: "string", short: "c" },
        number: { type: "string", short: "n" },
        group: { type: "string", short: "g" },
        all: { type: "boolean" },
        appendix: { type: "boolean" },
        init: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
        "no-input": { type: "boolean" },
        "save-config": { type: "boolean" },
        "install-skill": { type: "boolean" },
        "input-format": { type: "string" },
        port: { type: "string" },
        font: { type: "string" },
        "font-heading": { type: "string" },
        "font-body": { type: "string" },
        "from-name": { type: "string" },
        "from-lines": { type: "string" },
        "to-name": { type: "string" },
        "to-lines": { type: "string" },
        rate: { type: "string" },
        currency: { type: "string" },
        "tax-percent": { type: "string" },
        "tax-label": { type: "string" },
        "net-days": { type: "string" },
        "round-up": { type: "string" },
        notes: { type: "string" },
        accent: { type: "string" },
        paper: { type: "string" },
        items: { type: "boolean" },
        "no-items": { type: "boolean" },
        subtotals: { type: "boolean" },
        "no-subtotals": { type: "boolean" },
      },
    });
  } catch (err) {
    die(`${(err as Error).message}\n\nRun \`${PROG} --help\` for usage.`);
  }
  const { values, positionals } = parsed;

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (values.version) {
    console.log(getVersion());
    process.exit(0);
  }

  if (values.init) {
    // Bare --init always targets the new TOML path, even if an old JSON
    // config already exists alongside it — that's how you opt into TOML.
    const initPath = values.config
      ? resolve(values.config)
      : resolve(defaultConfigDir(), "config.toml");
    if (existsSync(initPath)) die(`${initPath} already exists; not overwriting`);
    mkdirSync(dirname(initPath), { recursive: true });
    const contents = isJsonConfigPath(initPath)
      ? JSON.stringify(JSON_CONFIG_TEMPLATE, null, 2) + "\n"
      : TOML_CONFIG_TEMPLATE;
    writeFileSync(initPath, contents);
    console.log(`Wrote ${initPath} — edit it, then run: ${PROG} report.csv`);
    process.exit(0);
  }

  const configPath = values.config ? resolve(values.config) : defaultConfigPath();

  if (positionals.length > 1) die(`unexpected arguments: ${positionals.slice(1).join(" ")}`);
  const group = (values.group ?? "description") as GroupBy;
  if (!GROUPS.includes(group))
    die(`invalid --group ${JSON.stringify(values.group)}; use ${GROUPS.join("|")}`);
  if (values.paper && !["letter", "a4"].includes(values.paper))
    die(`invalid --paper ${JSON.stringify(values.paper)}; use letter|a4`);
  for (const flag of ["rate", "tax-percent", "net-days", "round-up"] as const) {
    if (values[flag] !== undefined && !Number.isFinite(Number(values[flag]))) {
      die(`invalid --${flag} ${JSON.stringify(values[flag])}; expected a number`);
    }
  }
  if (values.accent && !/^#[0-9a-fA-F]{6}$/.test(values.accent)) {
    die(`invalid --accent ${JSON.stringify(values.accent)}; expected #rrggbb`);
  }
  if (values.port && !(Number.isInteger(Number(values.port)) && Number(values.port) > 0)) {
    die(`invalid --port ${JSON.stringify(values.port)}; expected a port number`);
  }
  if (values["input-format"] && !adapterNames.includes(values["input-format"])) {
    die(
      `invalid --input-format ${JSON.stringify(values["input-format"])}; use ${adapterNames.join("|")}`,
    );
  }

  return {
    answers: {
      serve: positionals[0] === "serve",
      port: Number(values.port ?? 4520),
      installSkill: Boolean(values["install-skill"]),
      csvPath: positionals[0] === "serve" ? undefined : positionals[0],
      inputFormat: values["input-format"],
      output: values.output,
      number: values.number,
      group,
      all: Boolean(values.all),
      appendix: Boolean(values.appendix),
      saveConfig: Boolean(values["save-config"]),
      configPath,
      configExplicit: values.config !== undefined,
      interactive:
        !values["no-input"] && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY),
    },
    overrides: {
      fromName: values["from-name"],
      fromLines: values["from-lines"],
      toName: values["to-name"],
      toLines: values["to-lines"],
      rate: values.rate,
      currency: values.currency,
      taxPercent: values["tax-percent"],
      taxLabel: values["tax-label"],
      netDays: values["net-days"],
      roundUp: values["round-up"],
      notes: values.notes,
      accent: values.accent,
      paper: values.paper,
      font: values.font,
      fontHeading: values["font-heading"],
      fontBody: values["font-body"],
      items: values["no-items"] ? false : values.items ? true : undefined,
      subtotals: values["no-subtotals"] ? false : values.subtotals ? true : undefined,
    },
  };
}

function loadConfigFile(
  path: string,
  explicit: boolean,
  interactive: boolean,
): { config: InvoiceConfig; found: boolean } {
  if (!existsSync(path)) {
    // Interactive mode can still create the file at the end via the save prompt.
    if (explicit && !interactive) {
      die(`no config at ${path} — run \`${PROG} --init -c ${path}\` to create one`);
    }
    return { config: mergeConfig({}), found: false };
  }
  try {
    const text = readFileSync(path, "utf8");
    const raw = isJsonConfigPath(path) ? JSON.parse(text) : parseToml(text);
    const config = mergeConfig(raw, (message) => warn(`${path}: ${message}`));
    // Custom font paths in a config file are relative to that file.
    config.invoice.fonts = anchorFontPaths(config.invoice.fonts, (p) => resolve(dirname(path), p));
    return { config, found: true };
  } catch (err) {
    die(`couldn't parse ${path}: ${(err as Error).message}`);
  }
}

function applyOverrides(config: InvoiceConfig, o: Overrides): void {
  const str = (key: string) => (typeof o[key] === "string" ? o[key] : undefined);
  const bool = (key: string) => (typeof o[key] === "boolean" ? o[key] : undefined);
  const list = (raw: string) =>
    raw
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
  const fromName = str("fromName"),
    fromLines = str("fromLines"),
    toName = str("toName"),
    toLines = str("toLines"),
    rate = str("rate"),
    currency = str("currency"),
    taxPercent = str("taxPercent"),
    taxLabel = str("taxLabel"),
    netDays = str("netDays"),
    roundUp = str("roundUp"),
    notes = str("notes"),
    accent = str("accent"),
    paper = str("paper"),
    items = bool("items"),
    subtotals = bool("subtotals");
  if (fromName !== undefined) config.from.name = fromName;
  if (fromLines !== undefined) config.from.lines = list(fromLines);
  if (toName !== undefined) config.to.name = toName;
  if (toLines !== undefined) config.to.lines = list(toLines);
  if (rate !== undefined)
    config.projects["default"] = { ...config.projects["default"], rate: Number(rate) };
  if (currency !== undefined) config.invoice.currency = currency;
  if (taxPercent !== undefined) config.invoice.taxPercent = Number(taxPercent);
  if (taxLabel !== undefined) config.invoice.taxLabel = taxLabel;
  if (netDays !== undefined) config.invoice.netDays = Number(netDays);
  if (roundUp !== undefined) config.invoice.roundUpMinutes = Number(roundUp);
  if (notes !== undefined) config.invoice.notes = notes;
  if (accent !== undefined) config.invoice.accent = accent;
  if (paper !== undefined) config.invoice.paper = paper as "letter" | "a4";
  if (items !== undefined) config.projects["default"] = { ...config.projects["default"], items };
  if (subtotals !== undefined)
    config.projects["default"] = { ...config.projects["default"], subtotal: subtotals };
  // CLI font paths are relative to the working directory, unlike config ones.
  try {
    config.invoice.fonts = resolveFontSlots(
      config.invoice.fonts,
      { font: str("font"), heading: str("fontHeading"), body: str("fontBody") },
      (path) => resolve(path),
    );
  } catch (err) {
    if (err instanceof FontError) die(err.message);
    throw err;
  }
}

// ---- Web server & Claude skill ----

async function serveWeb(port: number): Promise<void> {
  const server = Bun.serve({ port, routes: { "/*": index } });
  console.log(`${PROG}: invoice generator running at ${server.url} — Ctrl-C to stop`);
}

function skillPath(): string {
  return resolve(homedir(), ".claude", "skills", "outmute", "SKILL.md");
}

function installSkill(): void {
  // In a compiled binary, sources live in Bun's virtual filesystem where repo
  // paths don't exist — the skill must invoke the binary itself instead.
  const compiled = import.meta.dir.includes("$bunfs") || import.meta.dir.includes("~BUN");
  const cmd = compiled ? process.execPath : `bun run ${resolve(import.meta.dir, "cli.ts")}`;
  const target = skillPath();
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, skillTemplate.replaceAll("{{CMD}}", cmd));
  console.log(`Installed Claude skill at ${target}`);
}

// ---- Interactive prompting ----

/**
 * Buffers every input line as it arrives, so answers typed or pasted ahead of
 * the next prompt aren't dropped (readline discards lines with no pending
 * question).
 */
class Prompter {
  private rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  private queue: string[] = [];
  private waiter: ((line: string) => void) | null = null;

  constructor() {
    this.rl.on("line", (line) => {
      if (this.waiter) {
        const resolve = this.waiter;
        this.waiter = null;
        resolve(line);
      } else {
        this.queue.push(line);
      }
    });
    this.rl.on("close", () => {
      // stdin ended mid-conversation: treat as an aborted run.
      if (this.waiter) die("input closed before all questions were answered");
    });
  }

  question(prompt: string): Promise<string> {
    process.stdout.write(prompt);
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  close(): void {
    this.rl.close();
  }
}

async function ask(
  rl: Prompter,
  question: string,
  options: { fallback?: string; validate?: (raw: string) => string | null } = {},
): Promise<string> {
  const suffix = options.fallback ? ` [${options.fallback}]` : "";
  for (;;) {
    const raw = (await rl.question(`  ${question}${suffix}: `)).trim();
    const value = raw || options.fallback || "";
    const problem = options.validate?.(value) ?? null;
    if (!problem) return value;
    console.log(`    ${problem}`);
  }
}

async function askLines(rl: Prompter, question: string, existing: string[]): Promise<string[]> {
  if (existing.length) return existing;
  console.log(`  ${question} (one per line, empty line to finish):`);
  const lines: string[] = [];
  for (;;) {
    const raw = (await rl.question("    > ")).trim();
    if (!raw) return lines;
    lines.push(raw);
  }
}

const numberValidator = (raw: string) =>
  Number.isFinite(Number(raw)) ? null : "please enter a number";

async function loadCsvInteractive(
  rl: Prompter,
  initialPath: string | undefined,
  format: string | undefined,
): Promise<{ path: string; report: Timesheet }> {
  let path = initialPath;
  for (;;) {
    if (!path) {
      path = await ask(rl, "Path to the time report CSV (e.g. a Clockify export)", {
        validate: (raw) => (raw ? null : "a CSV path is required"),
      });
    }
    try {
      const report = loadCsv(path, format);
      const days = report.entries.map((e) => e.day).sort();
      console.log(
        `    ✓ ${report.entries.length} entries, ${fmtDay(days[0])} – ${fmtDay(days[days.length - 1])}`,
      );
      return { path, report };
    } catch (err) {
      console.log(`    ✗ ${(err as Error).message}`);
      path = undefined;
    }
  }
}

function loadCsv(path: string, format: string | undefined): Timesheet {
  if (!existsSync(path)) throw new Error(`no such file: ${path}`);
  try {
    return parseTimesheet(readFileSync(path, "utf8"), format);
  } catch (err) {
    if (err instanceof AdapterError) throw err;
    throw new Error(`couldn't read ${path}: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const { answers, overrides } = parseCliArgs();
  if (answers.installSkill) {
    installSkill();
    return;
  }
  if (answers.serve) {
    await serveWeb(answers.port);
    return;
  }
  const { config, found: configFound } = loadConfigFile(
    answers.configPath,
    answers.configExplicit,
    answers.interactive,
  );
  applyOverrides(config, overrides);

  let report: Timesheet;
  let rl: Prompter | undefined;

  if (answers.interactive) {
    rl = new Prompter();
    console.log(`${PROG} — PDF invoice from a time-tracking report\n`);
    if (configFound) console.log(`  Using config: ${answers.configPath}\n`);

    const loaded = await loadCsvInteractive(rl, answers.csvPath, answers.inputFormat);
    answers.csvPath = loaded.path;
    report = loaded.report;
    console.log();

    config.from.name = await ask(rl, "Your name (the sender)", {
      fallback: config.from.name !== DEFAULT_CONFIG.from.name ? config.from.name : undefined,
      validate: (raw) => (raw ? null : "a name is required"),
    });
    config.from.lines = await askLines(rl, "Your address / email / phone", config.from.lines);
    config.to.name = await ask(rl, "Client name (bill to)", {
      fallback: config.to.name !== DEFAULT_CONFIG.to.name ? config.to.name : undefined,
      validate: (raw) => (raw ? null : "a client name is required"),
    });
    config.to.lines = await askLines(rl, "Client address", config.to.lines);

    const needsRate = report.entries.some((e) => e.billable && e.rate === undefined);
    if (needsRate && !((config.projects["default"]?.rate ?? 0) > 0)) {
      config.projects["default"] = {
        ...config.projects["default"],
        rate: Number(
          await ask(rl, "Default hourly rate (some entries have no billable rate)", {
            validate: numberValidator,
          }),
        ),
      };
    }
    config.invoice.currency = await ask(rl, "Currency symbol", {
      fallback: config.invoice.currency || symbolForCurrency(report.currency) || "$",
    });
    config.invoice.taxPercent = Number(
      await ask(rl, "Tax percent (0 for none)", {
        fallback: String(config.invoice.taxPercent),
        validate: numberValidator,
      }),
    );
    config.invoice.netDays = Number(
      await ask(rl, "Payment due in how many days", {
        fallback: String(config.invoice.netDays),
        validate: numberValidator,
      }),
    );
  } else {
    if (!answers.csvPath) {
      die("csv file is required in non-interactive mode (or run with no --no-input on a terminal)");
    }
    try {
      report = loadCsv(answers.csvPath, answers.inputFormat);
    } catch (err) {
      die((err as Error).message);
    }
  }

  let invoice;
  try {
    invoice = computeInvoice(report, config, {
      group: answers.group,
      includeNonBillable: answers.all,
      appendix: answers.appendix,
      number: answers.number,
    });
  } catch (err) {
    if (err instanceof InvoiceError)
      die(`${err.message} (use --all to include non-billable entries)`);
    throw err;
  }

  if (rl) {
    invoice.number = await ask(rl, "Invoice number", { fallback: invoice.number });
  }
  const defaultOutput = `${invoice.number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
  let outputPath =
    answers.output ??
    (rl ? await ask(rl, "Output PDF path", { fallback: defaultOutput }) : defaultOutput);
  if (!outputPath.toLowerCase().endsWith(".pdf")) outputPath += ".pdf";

  if (rl) {
    const save = await ask(rl, `Save these settings to ${answers.configPath}? (y/n)`, {
      fallback: configFound ? "n" : "y",
      validate: (raw) => (/^[yn]/i.test(raw) ? null : "please answer y or n"),
    });
    answers.saveConfig = /^y/i.test(save);
    if (!existsSync(skillPath())) {
      const install = await ask(
        rl,
        "Install the Claude Code skill so Claude can generate invoices for you? (y/n)",
        { fallback: "n", validate: (raw) => (/^[yn]/i.test(raw) ? null : "please answer y or n") },
      );
      if (/^y/i.test(install)) installSkill();
    }
    rl.close();
    console.log();
  }

  if (answers.saveConfig) {
    mkdirSync(dirname(answers.configPath), { recursive: true });
    const contents = isJsonConfigPath(answers.configPath)
      ? JSON.stringify(config, null, 2) + "\n"
      : stringifyToml(config);
    writeFileSync(answers.configPath, contents);
    console.log(`Saved config to ${answers.configPath}`);
  }

  for (const message of invoice.warnings) warn(message);
  const pdf = await renderInvoicePdf(invoice);
  mkdirSync(dirname(resolve(outputPath)), { recursive: true });
  writeFileSync(outputPath, pdf);
  console.log(
    `${outputPath}: ${invoice.lines.length} line item(s), ${fmtHours(invoice.totalHours)} hours, ` +
      `${money(invoice.currency, invoice.total)} due ${fmtDay(invoice.due)}`,
  );
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
