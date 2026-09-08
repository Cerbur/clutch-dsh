#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "${1:-}" = "--help" ]; then
  echo "Usage: $0 [deepseek-harness-directory]"
  echo "Without a path or DSH_REPO_ROOT, shallow-clone GitHub source into a temporary directory."
  echo "DSH_SOURCE_REF selects a source branch, tag, or commit (default master)."
  echo "DSH_INSTALL_DIR selects the install parent (default /Applications)."
  exit 0
fi
if [ "$#" -gt 1 ]; then echo "Expected at most one repository path" >&2; exit 1; fi
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo "This local packager requires an Apple Silicon Mac" >&2; exit 1
fi
for tool in git node pnpm codesign ditto plutil; do
  command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
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
  SOURCE_REF="${DSH_SOURCE_REF:-master}"
  REPO_ROOT="$SOURCE_TMP/repo"
  echo "[1/5] Fetching source: $SOURCE_REF"
  if [[ "$SOURCE_REF" =~ ^[0-9a-fA-F]{40}$ ]]; then
    git init --quiet "$REPO_ROOT"
    git -C "$REPO_ROOT" fetch --depth 1 https://github.com/deepseek-ai/deepseek-harness.git "$SOURCE_REF"
    git -C "$REPO_ROOT" checkout --quiet --detach FETCH_HEAD
  else
    git clone --depth 1 --single-branch --branch "$SOURCE_REF" \
      https://github.com/deepseek-ai/deepseek-harness.git "$REPO_ROOT"
  fi
  SOURCE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  export DSH_CLIENT_COMMIT_HASH="$SOURCE_SHA"
  echo "Source commit: $SOURCE_SHA"
else
  echo "[1/5] Using local source: $REPO_ROOT"
fi
REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
test -d "$REPO_ROOT/apps/desktop"
export DSH_DESKTOP_TARGET_PLATFORM=darwin
export DSH_DESKTOP_TARGET_ARCH=arm64
TARGET_DIR="$REPO_ROOT/apps/desktop/.desktop-build/targets/mac-arm64"
cd "$REPO_ROOT"
echo '[2/5] Installing dependencies and Electron'
pnpm install --frozen-lockfile
node "$SCRIPT_DIR/local-app.mjs" electron "$REPO_ROOT"
echo '[3/5] Building and packing packages'
pnpm run build:official
pnpm run release:pack --family dsh --out "$TARGET_DIR/packed/dsh"
pnpm --dir apps/desktop-host pack --pack-destination "$TARGET_DIR/packed/dsh"
pnpm run release:pack --family vendor --out "$TARGET_DIR/packed/vendor"
mkdir -p "$TARGET_DIR/packed/landlock"
pnpm --dir native/landlock-run run build:ts
pnpm --dir native/landlock-run/packages/entry pack --pack-destination "$TARGET_DIR/packed/landlock"
echo '[4/5] Preparing runtime, offline seed and desktop shell'
pnpm --filter @deepseek-ai/dsh-desktop run prepare:runtime
pnpm --filter @deepseek-ai/dsh-desktop run prepare:packages
node "$SCRIPT_DIR/local-app.mjs" seed "$REPO_ROOT"
pnpm --filter @deepseek-ai/dsh-desktop run build
echo '[5/5] Assembling, signing and installing App'
node "$SCRIPT_DIR/local-app.mjs" assemble "$REPO_ROOT"
