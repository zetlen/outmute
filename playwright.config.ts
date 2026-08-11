import { defineConfig, devices } from "@playwright/test";

/** Kept off the CLI's default 4520 so a dev session running `outmute serve`
 * doesn't collide with the suite. */
const PORT = Number(process.env.OUTMUTE_E2E_PORT ?? 4521);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // `bun test` owns *.test.ts; e2e specs use a suffix it won't pick up.
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The HTML report is what CI uploads as an artifact when something fails.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  // Chromium alone: the page uses no browser-specific APIs worth a matrix.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun run src/cli.ts serve --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
