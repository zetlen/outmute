# QC / CI / Release rollout plan

Execution plan for outmute's tooling, CI, and release process. Every design
decision below is **settled** — sessions executing a step should not reopen
them. Work the sessions in order; each is one commit (or PR, once branch
protection lands at Session E) unless noted. Check off steps as they land and
keep this file updated in the same commit/PR.

## Decisions ledger (do not relitigate)

- Repo goes **public**; canonical home is github.com/zetlen/outmute.
- **No history rewrite, no commitlint.** Squash-only merges; the PR title is
  the conventional commit, enforced by a semantic-PR-title CI check.
- License: **MIT**, `LICENSE` file + package.json field only. No SPDX headers.
- Tooling: **oxfmt** (format), **oxlint** (lint), **typescript@7** (GA
  2026-07-08; the native compiler is standard `tsc` in the `typescript`
  package), **lefthook** (hooks). Hook split: pre-commit = oxfmt + oxlint on
  staged files; pre-push = `tsc --noEmit` + `bun test --pass-with-no-tests`
  (the flag tolerates the test-free window before Session C lands). No
  commit-msg hook.
- Tests: **bun test**, colocated `src/**/*.test.ts`, pure core logic only
  (no PDF-content, CLI-interaction, or visual tests yet). No coverage gate.
  Test files are excluded from binaries automatically (only cli.ts's import
  graph is compiled).
- Binaries: `bun build --compile`, targets **linux-x64, darwin-arm64,
  windows-x64** only. Everything embedded (fonts, web app) — **no
  lazy-download machinery** (measured: Bun runtime is 90 MB of the 96 MB
  binary; the app is ~6 MB; tar.gz ships at ~36 MB).
- Required fix before compiling: `src/cli.ts` must load the web app with a
  **static** `import index from "./web/index.html"` — the current dynamic
  `await import(...)` compiles but crashes (`require_web is not defined`) in
  compiled binaries (Bun 1.3.14).
- Version: injected at build time from package.json via `--define`; surfaced
  as `outmute --version` and in the web page footer. Binary's served page and
  hosted page must show the same version for a given release.
- Assets: `outmute-v{version}-linux-x64.tar.gz`,
  `outmute-v{version}-macos-arm64.tar.gz`,
  `outmute-v{version}-windows-x64.zip`, each containing the single binary,
  plus one `SHASUMS256.txt` covering all three.
- Pages (plain `https://zetlen.github.io/outmute`, no custom domain) hosts the
  web app **and** `install.sh`; deploys **only** from the release workflow.
- install.sh: POSIX sh; platform detect via uname; downloads via
  `releases/latest/download/...` (no GitHub API); verifies SHASUMS256.txt;
  installs to `~/.local/bin` (warn if not on PATH); env overrides
  `OUTMUTE_INSTALL_DIR`, `OUTMUTE_VERSION`; update = re-run, unconditional
  overwrite; Windows unsupported → point at releases page (a `.ps1` may come
  later).
- **No npm publishing.**
- Branch protection ruleset on main: PRs required, **0 approvals**, required
  status checks = CI jobs + PR-title check, linear history required,
  squash-only (repo merge settings), no force-push/deletion, **no bypass
  actors**; auto-merge enabled.
- Release-please: **manifest mode pinned at 2.0.0**, strictly incremental
  from a manually created seed tag `v2.0.0`. Never configure bootstrap-sha or
  let it parse untagged history.

## Session A — visibility + license (model: small)

- [x] `gh repo edit zetlen/outmute --visibility public --accept-visibility-change-consequences`
- [x] Add `LICENSE` (MIT, copyright holder "James Zetlen", year 2026).
- [x] Add `"license": "MIT"` to package.json.
- [x] Commit: `chore: add MIT license` (visibility flip has no commit).

## Session B — tooling + compliance (model: mid)

- [x] Add devDeps: oxfmt, oxlint, `typescript@^7`, lefthook (`bun add -d`).
      Verify `tsc --noEmit` still passes under TS 7 before anything else;
      fix any TS7 divergences (expected: none or trivial).
- [x] Configure oxfmt and oxlint (config files at repo root). Start from
      defaults; use judgment to adjust rules to fit the existing style rather
      than rewriting the codebase to fit maximal rules. Ignore `dist/`,
      `node_modules/`, `src/fonts/`.
- [x] `lefthook.yml`: pre-commit runs oxfmt (write, staged files) + oxlint;
      pre-push runs `tsc --noEmit` + `bun test --pass-with-no-tests` (no
      test files exist until Session C). Add `"prepare": "lefthook install"`
      or document `bunx lefthook install` in README.
- [x] Add package.json scripts: `fmt`, `fmt:check`, `lint`, `test` (keep
      existing `typecheck`).
- [x] Run oxfmt + oxlint over the repo; commit the compliance changeset.
      Verify after: `bun run typecheck` passes and
      `bun run src/cli.ts <csv> --no-input ...` still produces a correct PDF
      (synthetic CSV: header with Project,Description,Billable,Start Date,
      Duration (h),Duration (decimal),Billable Rate (EUR) and a couple rows).
- [x] Two commits: `chore: add oxfmt, oxlint, typescript 7, and lefthook` and
      `style: bring codebase into fmt/lint compliance`.

## Session C — tests + compile fix (model: mid, quality matters most here)

- [ ] Write colocated bun tests for the pure core:
  - `src/adapters/clockify.test.ts`: `parseCsv` (quoting, embedded quotes,
    newlines-in-fields, BOM, CRLF); `detect()` (accepts Clockify headers,
    rejects arbitrary CSV); `parse()` (date-format picking incl. ambiguous
    US/EU dates, `Duration (h)` vs `(decimal)` fallback, rate>0 → `rate` set /
    blank rate → `rate` absent, currency code extraction from
    `Billable Rate (EUR)` header, Billable yes/no).
  - `src/core/invoice.test.ts`: `computeInvoice` grouping modes
    (description/project/day/entry), rate resolution (entry rate beats config,
    project rate beats default, missing-rate warning), round-up-minutes
    (rounds up per line, not per entry), tax math, non-billable filtering +
    warning + error when nothing billable, period start/end, default invoice
    number from prefix+periodEnd, currency precedence
    (config symbol > timesheet ISO code > "$"), no mutation of input.
  - `src/core/format.test.ts`: `fmtDay`, `addDays` (month/year rollover),
    `parseNumber` (1.234,56 vs 1,234.56, currency-symbol stripping),
    `symbolForCurrency` (known code, unknown code passthrough, undefined).
- [ ] Change `src/cli.ts` serve path to a static top-level
      `import index from "./web/index.html"` and drop the dynamic import +
      its laziness comment. Verify: `bun build --compile src/cli.ts --outfile /tmp/outmute-smoke`
      then `/tmp/outmute-smoke serve --port 4599` + curl returns the app, and
      PDF generation from the compiled binary works.
- [ ] Commits: `test: cover core parsing, invoice math, and formatting` and
      `fix: static web import so serve works in compiled binaries`.

## Session D — version plumbing + CI (model: mid)

- [ ] Version injection: `--define OUTMUTE_VERSION=...` (from package.json) in
      compiled/web builds, with a runtime fallback for `bun run` dev use
      (read package.json). Add `--version` flag to the CLI and a small footer
      on the web page (`outmute v{version}`). Same constant for both.
- [ ] `.github/workflows/ci.yml` on `pull_request`: jobs for
      `bun run fmt:check`, `bun run lint`, `bun run typecheck`, `bun test`
      (oven-sh/setup-bun; bun install --frozen-lockfile), plus a
      `pr-title` job using amannn/action-semantic-pull-request.
      Note the exact check names — Session E's ruleset references them.
- [ ] Commits: `feat: add --version flag and web footer version` and
      `ci: check fmt, lint, types, tests, and PR title on pull requests`.

## Session E — branch protection (model: mid; gh api work)

Prereq: CI from Session D has run at least once (check names must exist).

- [ ] Repo merge settings: enable squash merge ONLY (disable merge commits
      and rebase merges); enable auto-merge; enable "automatically delete
      head branches".
- [ ] Ruleset on `main` (gh api /repos/zetlen/outmute/rulesets): require PRs
      (0 approvals), require status checks (all Session D check names),
      require linear history, block force pushes and deletions, no bypass
      actors.
- [ ] Verify: direct push to main is rejected; a trivial PR with green checks
      can auto-merge via squash.
- [ ] From here on, ALL changes land via squash-merged PRs with
      conventional-commit titles (`feat:`/`fix:`/`chore:`/`ci:`/...).

## Session F — release workflow + install.sh (model: mid/strong; highest retry risk)

- [ ] `.github/workflows/release.yml` triggered by published releases (and
      `workflow_dispatch` for rehearsal). Jobs:
  1. Build: for each target (`bun-linux-x64`, `bun-darwin-arm64`,
     `bun-windows-x64`), `bun build --compile --target=... src/cli.ts` with
     the version define; package per naming convention (tar.gz for unix, zip
     for windows, binary named `outmute`/`outmute.exe` inside); generate one
     `SHASUMS256.txt`; upload all as release assets (`gh release upload`).
  2. Pages: `bun run build:web` (with version define) into `dist/`, copy
     `install.sh` (and a `.nojekyll`) into it, deploy via
     actions/upload-pages-artifact + actions/deploy-pages. Enable Pages
     (source: GitHub Actions) via `gh api` if not already.
- [ ] `install.sh` at repo root per the decisions ledger. Test locally by
      sourcing its platform-detect + download logic against a fake asset dir,
      and shellcheck it.
- [ ] PR titles: `ci: build release binaries and deploy pages on release` and
      `feat: curl-able install script` (separate PRs or one; keep titles
      conventional — `feat` makes release-please include it in the changelog).

## Session G — seed release + release-please (model: mid)

- [ ] Confirm package.json version is `2.0.0` and main is green.
- [ ] Seed release: `gh release create v2.0.0 --title "v2.0.0" --generate-notes`
      at main's HEAD. This triggers release.yml — the dress rehearsal. Verify:
      three assets + SHASUMS256.txt attached; Pages live at
      https://zetlen.github.io/outmute with the version in the footer;
      `curl -fsSL https://zetlen.github.io/outmute/install.sh | sh` installs a
      working binary on this machine (`outmute --version` → 2.0.0).
- [ ] release-please via the googleapis/release-please-action workflow on
      pushes to main, manifest mode:
      `.release-please-manifest.json` = `{".": "2.0.0"}`;
      `release-please-config.json` with `release-type: node`,
      `include-component-in-tag: false` (tags are `vX.Y.Z`),
      `changelog` defaults. NO bootstrap-sha. Because tag v2.0.0 exists,
      release-please operates incrementally — this is the reliability recipe.
      The action needs `contents: write` + `pull-requests: write`; releases it
      publishes will trigger release.yml. If release.yml doesn't fire on
      release-please's GITHUB_TOKEN-created releases (GitHub suppresses
      workflow-triggering-workflows), switch release-please to a PAT or add
      `workflow_dispatch` chaining — this is the known gotcha to check.
- [ ] Verify end-to-end: merge a `fix:`-titled PR → release-please PR appears
      → merge it → v2.0.1 release with assets + Pages deploy.
- [ ] When everything works, delete this PLAN.md in the final PR.
