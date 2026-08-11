/** Injected via `--define OUTMUTE_VERSION=...` in compiled/web builds. */
declare const OUTMUTE_VERSION: string | undefined;

export const VERSION: string | undefined =
  typeof OUTMUTE_VERSION !== "undefined" ? OUTMUTE_VERSION : undefined;
