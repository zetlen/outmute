/**
 * Integration tests: spawn the real CLI as a subprocess against fixture CSVs.
 *
 * Every run gets a throwaway HOME (and XDG_CONFIG_HOME beneath it) so the
 * suite can never read the developer's own ~/.config/outmute/config.toml, and
 * cwd is that same temp dir so default-named PDFs don't land in the repo.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

const REPO = resolve(import.meta.dir, "..");
const CLI = resolve(REPO, "src/cli.ts");
const SAMPLE = resolve(REPO, "test/fixtures/clockify-sample.csv");
const RATED = resolve(REPO, "test/fixtures/clockify-rated.csv");
const MALFORMED = resolve(REPO, "test/fixtures/malformed.csv");

/** The sample fixture bills 12.5 h across 3 descriptions, plus a 0.5 h
 * non-billable entry, and its last entry is on 2026-07-10 (hence the default
 * INV-20260710). It carries no per-entry rates, so the effective rate comes
 * from the config or --rate — which is what makes the precedence tests below
 * meaningful. */
const BILLABLE_HOURS = "12.50";
const LAST_DAY = "20260710";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "outmute-cli-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the CLI entry point in a subprocess. `process.execPath` is the bun
 * binary running this test, which sidesteps any version-manager shim on PATH
 * that would misbehave under a rewritten HOME.
 */
function runCli(...args: string[]): CliResult {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, CLI, ...args],
    cwd: home,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/** Loads a generated PDF and returns the bits worth asserting on. */
async function inspectPdf(path: string) {
  const bytes = readFileSync(path);
  expect(bytes.byteLength).toBeGreaterThan(0);
  // Magic bytes first: a truncated or non-PDF file should fail here, loudly.
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const doc = await PDFDocument.load(bytes);
  return { bytes, pages: doc.getPageCount(), title: doc.getTitle(), creator: doc.getCreator() };
}

function writeJsonConfig(contents: unknown): string {
  const path = join(home, "config.json");
  writeFileSync(path, JSON.stringify(contents, null, 2));
  return path;
}

function writeTomlConfig(contents: unknown): string {
  const path = join(home, "config.toml");
  writeFileSync(path, stringifyToml(contents as Record<string, unknown>));
  return path;
}

const CONFIG = {
  from: { name: "Config Sender", lines: ["1 Config Way"] },
  to: { name: "Config Client", lines: ["2 Client Road"] },
  invoice: { numberPrefix: "ACME-", currency: "$" },
  rates: { default: 100 },
};

describe("cli happy path", () => {
  test("renders a valid PDF from a fixture CSV with no prompts", async () => {
    const out = join(home, "invoice.pdf");
    const result = runCli(
      SAMPLE,
      "--no-input",
      "-o",
      out,
      "--from-name",
      "Jane Dev",
      "--to-name",
      "Acme Corp",
      "--rate",
      "150",
    );

    expect(result.stderr).not.toContain("error");
    expect(result.code).toBe(0);
    expect(existsSync(out)).toBe(true);

    const pdf = await inspectPdf(out);
    expect(pdf.pages).toBe(1);
    expect(pdf.title).toBe(`Invoice INV-${LAST_DAY}`);
    expect(pdf.creator).toBe("outmute");

    // 12.5 billable hours at 150 = 1875, grouped by description into 3 lines.
    expect(result.stdout).toContain("3 line item(s)");
    expect(result.stdout).toContain(`${BILLABLE_HOURS} hours`);
    expect(result.stdout).toContain("$1,875.00");
  }, 30_000);

  test("warns about and excludes non-billable entries unless --all", async () => {
    const withoutAll = runCli(
      SAMPLE,
      "--no-input",
      "-o",
      join(home, "a.pdf"),
      "--from-name",
      "Jane Dev",
      "--to-name",
      "Acme Corp",
      "--rate",
      "150",
    );
    expect(withoutAll.code).toBe(0);
    expect(withoutAll.stderr).toContain("non-billable");
    expect(withoutAll.stdout).toContain("$1,875.00");

    const withAll = runCli(
      SAMPLE,
      "--no-input",
      "--all",
      "-o",
      join(home, "b.pdf"),
      "--from-name",
      "Jane Dev",
      "--to-name",
      "Acme Corp",
      "--rate",
      "150",
    );
    expect(withAll.code).toBe(0);
    // The extra half hour at 150 pushes the total to 13 h / 1950, and its
    // distinct description adds a fourth line item.
    expect(withAll.stdout).toContain("4 line item(s)");
    expect(withAll.stdout).toContain("13.00 hours");
    expect(withAll.stdout).toContain("$1,950.00");
  }, 30_000);

  test("bills per-entry rates from the CSV when it has them", async () => {
    const out = join(home, "rated.pdf");
    const result = runCli(RATED, "--no-input", "-o", out, "--from-name", "Jane Dev");

    expect(result.code).toBe(0);
    // 4 h at 150 plus 2 h at 250, with no --rate flag in sight.
    expect(result.stdout).toContain("6.00 hours");
    expect(result.stdout).toContain("$1,100.00");
    expect((await inspectPdf(out)).pages).toBe(1);
  }, 30_000);

  test("defaults the output filename to the invoice number", async () => {
    const result = runCli(
      SAMPLE,
      "--no-input",
      "--from-name",
      "Jane Dev",
      "--to-name",
      "Acme Corp",
      "--rate",
      "150",
    );
    expect(result.code).toBe(0);

    const expected = join(home, `INV-${LAST_DAY}.pdf`);
    expect(existsSync(expected)).toBe(true);
    expect((await inspectPdf(expected)).title).toBe(`Invoice INV-${LAST_DAY}`);
  }, 30_000);
});

describe("cli error paths", () => {
  test("rejects a CSV it can't recognize and writes no PDF", () => {
    const out = join(home, "nope.pdf");
    const result = runCli(
      MALFORMED,
      "--no-input",
      "-o",
      out,
      "--from-name",
      "Jane Dev",
      "--to-name",
      "Acme Corp",
      "--rate",
      "150",
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unrecognized time report format");
    expect(result.stdout).toBe("");
    expect(existsSync(out)).toBe(false);
  }, 30_000);

  test("rejects an empty CSV and writes no PDF", () => {
    const empty = join(home, "empty.csv");
    writeFileSync(empty, "");
    const out = join(home, "nope.pdf");
    const result = runCli(empty, "--no-input", "-o", out, "--rate", "150");

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("outmute:");
    expect(existsSync(out)).toBe(false);
  }, 30_000);

  test("requires a CSV path under --no-input", () => {
    const result = runCli("--no-input");

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("csv file is required in non-interactive mode");
  }, 30_000);

  test("rejects an explicit -c config that doesn't exist", () => {
    const missing = join(home, "absent.json");
    const result = runCli(SAMPLE, "--no-input", "-c", missing);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`no config at ${missing}`);
  }, 30_000);

  test("rejects an unparseable JSON config file", () => {
    const bad = join(home, "bad.json");
    writeFileSync(bad, "{ not json");
    const result = runCli(SAMPLE, "--no-input", "-c", bad);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("couldn't parse");
  }, 30_000);

  test("rejects an unparseable TOML config file", () => {
    const bad = join(home, "bad.toml");
    writeFileSync(bad, "not = valid = toml [[");
    const result = runCli(SAMPLE, "--no-input", "-c", bad);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("couldn't parse");
  }, 30_000);

  test("rejects an invalid flag value before doing any work", () => {
    const result = runCli(SAMPLE, "--no-input", "--group", "sideways");

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("invalid --group");
  }, 30_000);
});

describe("cli config precedence (JSON, still read for configs from before TOML)", () => {
  test("a -c config supplies defaults", async () => {
    const config = writeJsonConfig(CONFIG);
    const out = join(home, "from-config.pdf");
    const result = runCli(SAMPLE, "--no-input", "-c", config, "-o", out);

    expect(result.code).toBe(0);
    // The config's rate (100) and numberPrefix (ACME-) both take effect.
    expect(result.stdout).toContain("$1,250.00");
    expect((await inspectPdf(out)).title).toBe(`Invoice ACME-${LAST_DAY}`);
  }, 30_000);

  test("flags override the values from -c", async () => {
    const config = writeJsonConfig(CONFIG);
    const out = join(home, "overridden.pdf");
    const result = runCli(
      SAMPLE,
      "--no-input",
      "-c",
      config,
      "-o",
      out,
      "--rate",
      "200",
      "-n",
      "CUSTOM-1",
      "--to-name",
      "Flag Client",
    );

    expect(result.code).toBe(0);
    // 12.5 h at the flag's 200 rather than the config's 100.
    expect(result.stdout).toContain("$2,500.00");
    expect((await inspectPdf(out)).title).toBe("Invoice CUSTOM-1");
  }, 30_000);

  test("per-entry CSV rates outrank the config's default rate", async () => {
    const config = writeJsonConfig(CONFIG);
    const out = join(home, "rated-with-config.pdf");
    const result = runCli(RATED, "--no-input", "-c", config, "-o", out, "--rate", "1");

    expect(result.code).toBe(0);
    // Neither the config's 100 nor --rate 1 displaces the CSV's own rates;
    // rates.default only fills in entries that have none.
    expect(result.stdout).toContain("$1,100.00");
  }, 30_000);
});

describe("cli config precedence (TOML)", () => {
  test("a -c config supplies defaults", async () => {
    const config = writeTomlConfig(CONFIG);
    const out = join(home, "from-toml-config.pdf");
    const result = runCli(SAMPLE, "--no-input", "-c", config, "-o", out);

    expect(result.code).toBe(0);
    // The config's rate (100) and numberPrefix (ACME-) both take effect.
    expect(result.stdout).toContain("$1,250.00");
    expect((await inspectPdf(out)).title).toBe(`Invoice ACME-${LAST_DAY}`);
  }, 30_000);

  test("--init writes a commented TOML starter that outmute can then read back", async () => {
    const init = runCli("--init");
    expect(init.code).toBe(0);

    const defaultPath = join(home, ".config", "outmute", "config.toml");
    expect(existsSync(defaultPath)).toBe(true);
    expect(readFileSync(defaultPath, "utf8")).toContain("# outmute config");

    const out = join(home, "from-init.pdf");
    const result = runCli(
      SAMPLE,
      "--no-input",
      "-o",
      out,
      "--from-name",
      "Jane Dev",
      "--to-name",
      "Acme Corp",
    );
    expect(result.code).toBe(0);
    expect((await inspectPdf(out)).title).toBe(`Invoice INV-${LAST_DAY}`);
  }, 30_000);

  test("falls back to config.toml in XDG_CONFIG_HOME, which the temp HOME isolates", async () => {
    // Proves both that the default config location is honoured and that these
    // tests read it from the sandbox rather than the developer's real home.
    const defaultPath = join(home, ".config", "outmute", "config.toml");
    mkdirSync(join(home, ".config", "outmute"), { recursive: true });
    writeFileSync(defaultPath, stringifyToml({ ...CONFIG, invoice: { numberPrefix: "HOME-" } }));

    const out = join(home, "default-config.pdf");
    const generated = runCli(SAMPLE, "--no-input", "-o", out);
    expect(generated.code).toBe(0);
    expect(generated.stdout).toContain("$1,250.00");
    expect((await inspectPdf(out)).title).toBe(`Invoice HOME-${LAST_DAY}`);
  }, 30_000);

  test("--save-config writes TOML to the default config path", async () => {
    const out = join(home, "saved.pdf");
    const result = runCli(
      SAMPLE,
      "--no-input",
      "-o",
      out,
      "--save-config",
      "--from-name",
      "Jane Dev",
      "--to-name",
      "Acme Corp",
      "--rate",
      "150",
    );
    expect(result.code).toBe(0);

    const savedPath = join(home, ".config", "outmute", "config.toml");
    expect(existsSync(savedPath)).toBe(true);
    const saved = parseToml(readFileSync(savedPath, "utf8")) as any;
    expect(saved.from.name).toBe("Jane Dev");
    expect(saved.to.name).toBe("Acme Corp");
    expect(saved.rates.default).toBe(150);
  }, 30_000);
});

describe("cli config format fallback", () => {
  test("reads an existing outmute/config.json when no config.toml exists yet", async () => {
    const dir = join(home, ".config", "outmute");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(CONFIG));

    const out = join(home, "legacy-json.pdf");
    const result = runCli(SAMPLE, "--no-input", "-o", out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("$1,250.00");
    expect((await inspectPdf(out)).title).toBe(`Invoice ACME-${LAST_DAY}`);
  }, 30_000);

  test("prefers config.toml over an existing config.json in the same directory", async () => {
    const dir = join(home, ".config", "outmute");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ ...CONFIG, invoice: { numberPrefix: "JSON-" } }),
    );
    writeFileSync(
      join(dir, "config.toml"),
      stringifyToml({ ...CONFIG, invoice: { numberPrefix: "TOML-" } }),
    );

    const out = join(home, "toml-wins.pdf");
    const result = runCli(SAMPLE, "--no-input", "-o", out);
    expect(result.code).toBe(0);
    expect((await inspectPdf(out)).title).toBe(`Invoice TOML-${LAST_DAY}`);
  }, 30_000);

  test("--init writes config.toml even when an old config.json already exists", () => {
    const dir = join(home, ".config", "outmute");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(CONFIG));

    const result = runCli("--init");
    expect(result.code).toBe(0);
    expect(existsSync(join(dir, "config.toml"))).toBe(true);
  }, 30_000);
});

describe("cli --install-skill", () => {
  test("installs the skill with a bun-run command when run from source", () => {
    const result = runCli("--install-skill");
    expect(result.code).toBe(0);

    const skill = readFileSync(join(home, ".claude", "skills", "outmute", "SKILL.md"), "utf8");
    expect(skill).not.toContain("{{CMD}}");
    expect(skill).toContain(`bun run ${CLI}`);
  }, 30_000);

  test("installs the skill pointing at the binary itself when compiled", () => {
    // Regression: the compiled binary used to readFileSync a repo-relative
    // SKILL.md that only exists on disk, dying with ENOENT on /$bunfs paths.
    const bin = join(home, "outmute-compiled");
    const build = Bun.spawnSync({
      cmd: [process.execPath, "build", "--compile", CLI, "--outfile", bin],
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(build.exitCode).toBe(0);

    const proc = Bun.spawnSync({
      cmd: [bin, "--install-skill"],
      cwd: home,
      env: { PATH: process.env.PATH ?? "", HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.stderr.toString()).toBe("");
    expect(proc.exitCode).toBe(0);

    const skill = readFileSync(join(home, ".claude", "skills", "outmute", "SKILL.md"), "utf8");
    expect(skill).toContain(bin);
    expect(skill).not.toContain("bun run");
  }, 60_000);
});
