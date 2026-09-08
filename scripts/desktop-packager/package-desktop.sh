#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "${1:-}" = "--help" ]; then
  echo "Usage: $0 [deepseek-harness-directory]"
  echo "Without a path or DSH_REPO_ROOT, download the GitHub source archive into a temporary directory."
  echo "DSH_SOURCE_REF selects a source branch, tag, or commit (default master)."
  echo "DSH_INSTALL_DIR selects the install parent (default /Applications)."
  exit 0
fi
if [ "$#" -gt 1 ]; then echo "Expected at most one repository path" >&2; exit 1; fi
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo "This local packager requires an Apple Silicon Mac" >&2; exit 1
fi
for tool in curl tar node pnpm codesign ditto plutil; do command -v "$tool" >/dev/null; done
REPO_ROOT="${1:-${DSH_REPO_ROOT:-}}"
SOURCE_TMP=""
cleanup() {
  if [ -n "$SOURCE_TMP" ]; then rm -rf -- "$SOURCE_TMP"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ -z "$REPO_ROOT" ]; then
  SOURCE_TMP="$(mktemp -d /tmp/dsh-source-XXXXXX)"
  curl --fail --show-error --silent --location --retry 3 \
    "https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/${DSH_SOURCE_REF:-master}" \
    --output "$SOURCE_TMP/source.tar.gz"
  mkdir "$SOURCE_TMP/repo"
  tar -xzf "$SOURCE_TMP/source.tar.gz" -C "$SOURCE_TMP/repo" --strip-components=1
  REPO_ROOT="$SOURCE_TMP/repo"
fi
REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
test -d "$REPO_ROOT/apps/desktop"
export DSH_DESKTOP_TARGET_PLATFORM=darwin
export DSH_DESKTOP_TARGET_ARCH=arm64
TARGET_DIR="$REPO_ROOT/apps/desktop/.desktop-build/targets/mac-arm64"
cd "$REPO_ROOT"
pnpm install --frozen-lockfile
pnpm run build:official
pnpm run release:pack --family dsh --out "$TARGET_DIR/packed/dsh"
pnpm --dir apps/desktop-host pack --pack-destination "$TARGET_DIR/packed/dsh"
pnpm run release:pack --family vendor --out "$TARGET_DIR/packed/vendor"
mkdir -p "$TARGET_DIR/packed/landlock"
pnpm --dir native/landlock-run run build:ts
pnpm --dir native/landlock-run/packages/entry pack --pack-destination "$TARGET_DIR/packed/landlock"
pnpm --filter @deepseek-ai/dsh-desktop run prepare:runtime
pnpm --filter @deepseek-ai/dsh-desktop run prepare:packages
node "$SCRIPT_DIR/local-app.mjs" seed "$REPO_ROOT"
pnpm --filter @deepseek-ai/dsh-desktop run build
node "$SCRIPT_DIR/local-app.mjs" assemble "$REPO_ROOT"
