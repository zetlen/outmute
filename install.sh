#!/bin/sh
# Install outmute. Usage:
#   curl -fsSL https://zetlen.github.io/outmute/install.sh | sh
#
# Environment:
#   OUTMUTE_INSTALL_DIR  where to put the binary (default: ~/.local/bin)
#   OUTMUTE_VERSION      pin a version, e.g. 2.0.0 (default: latest release)
#   OUTMUTE_DOWNLOAD_URL override the asset base URL (testing only)
#
# Re-run to update; the existing binary is overwritten.

set -eu

REPO="zetlen/outmute"
RELEASES_PAGE="https://github.com/$REPO/releases"

say() { printf 'outmute: %s\n' "$1"; }
warn() { printf 'outmute: %s\n' "$1" >&2; }
die() {
  printf 'outmute: %s\n' "$1" >&2
  exit 1
}

# Echo the release-asset platform slug for this machine, or fail.
detect_target() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Linux)
      case "$arch" in
        x86_64 | amd64) echo "linux-x64" ;;
        *) die "unsupported architecture: $os $arch. Prebuilt binaries are linux-x64, macos-arm64, and windows-x64." ;;
      esac
      ;;
    Darwin)
      case "$arch" in
        arm64 | aarch64) echo "macos-arm64" ;;
        *) die "unsupported architecture: $os $arch. macOS builds are Apple Silicon (arm64) only." ;;
      esac
      ;;
    MINGW* | MSYS* | CYGWIN* | Windows_NT)
      die "this installer does not support Windows. Download the windows-x64 zip from $RELEASES_PAGE"
      ;;
    *)
      die "unsupported platform: $os $arch. See $RELEASES_PAGE"
      ;;
  esac
}

# fetch <url> <dest>
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "neither curl nor wget is available"
  fi
}

# Echo the base URL that release assets live under.
asset_base_url() {
  if [ -n "${OUTMUTE_DOWNLOAD_URL:-}" ]; then
    echo "${OUTMUTE_DOWNLOAD_URL%/}"
  elif [ -n "${OUTMUTE_VERSION:-}" ]; then
    echo "$RELEASES_PAGE/download/v${OUTMUTE_VERSION#v}"
  else
    echo "$RELEASES_PAGE/latest/download"
  fi
}

# asset_for <target> <shasums-file> — the archive name for this target.
# Asset names carry the version, so SHASUMS256.txt (whose name does not) is
# what tells us which version "latest" resolved to.
asset_for() {
  awk -v suffix="-$1.tar.gz" '
    { name = $NF }
    substr(name, length(name) - length(suffix) + 1) == suffix { print name; found = 1; exit }
    END { exit !found }
  ' "$2"
}

# verify_sha <file> <name> <shasums-file>
verify_sha() {
  expected=$(awk -v name="$2" '$NF == name || $NF == "*" name { print $1; exit }' "$3")
  [ -n "$expected" ] || die "no checksum for $2 in SHASUMS256.txt"
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$1" | awk '{ print $1 }')
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$1" | awk '{ print $1 }')
  else
    die "neither sha256sum nor shasum is available to verify the download"
  fi
  [ "$actual" = "$expected" ] || die "checksum mismatch for $2 (expected $expected, got $actual)"
}

main() {
  target=$(detect_target)
  base=$(asset_base_url)
  dir=${OUTMUTE_INSTALL_DIR:-$HOME/.local/bin}

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT INT TERM

  say "fetching checksums from $base"
  fetch "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt" ||
    die "could not download SHASUMS256.txt from $base"

  asset=$(asset_for "$target" "$tmp/SHASUMS256.txt") ||
    die "no $target asset listed in SHASUMS256.txt"

  say "downloading $asset"
  fetch "$base/$asset" "$tmp/$asset" || die "could not download $asset from $base"

  verify_sha "$tmp/$asset" "$asset" "$tmp/SHASUMS256.txt"

  tar -xzf "$tmp/$asset" -C "$tmp" || die "could not extract $asset"
  [ -f "$tmp/outmute" ] || die "$asset did not contain an outmute binary"

  mkdir -p "$dir"
  chmod +x "$tmp/outmute"
  mv -f "$tmp/outmute" "$dir/outmute" ||
    die "could not install to $dir (set OUTMUTE_INSTALL_DIR to choose another location)"

  say "installed $dir/outmute"
  case ":$PATH:" in
    *":$dir:"*) ;;
    *) warn "$dir is not on your PATH; add it, e.g. export PATH=\"$dir:\$PATH\"" ;;
  esac
}

# Set OUTMUTE_INSTALL_LIB=1 to source the functions above without installing.
[ "${OUTMUTE_INSTALL_LIB:-}" = "1" ] || main "$@"
