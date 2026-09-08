#!/usr/bin/env bash

# Parse the complete function before running any installation commands.
dsh_desktop_install() (
  set -euo pipefail
  if [ "${1:-}" = --help ]; then
    echo 'Usage: bash install.sh [deepseek-harness-directory]'
    echo 'DSH_PACKAGER_REF: clutch-dsh branch/tag/commit (default main)'
    echo 'DSH_SOURCE_REF: deepseek-harness branch/tag/commit (default master)'
    echo 'DSH_INSTALL_DIR: installation parent (default /Applications)'
    exit 0
  fi
  if [ "$#" -gt 1 ]; then echo 'Expected at most one repository path' >&2; exit 1; fi
  if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
    echo 'This local packager requires an Apple Silicon Mac' >&2; exit 1
  fi
  for tool in git node pnpm codesign ditto plutil; do
    command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
  done
  local installer_tmp
  installer_tmp="$(mktemp -d /tmp/dsh-installer-XXXXXX)"
  trap 'rm -rf -- "$installer_tmp"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  echo 'Preparing desktop packager…'
  local ref="${DSH_PACKAGER_REF:-main}"
  if [[ "$ref" =~ ^[0-9a-fA-F]{40}$ ]]; then
    git init --quiet "$installer_tmp/packager"
    git -C "$installer_tmp/packager" fetch --depth 1 https://github.com/Cerbur/clutch-dsh.git "$ref"
    git -C "$installer_tmp/packager" checkout --quiet --detach FETCH_HEAD
  else
    git clone --depth 1 --single-branch --branch "$ref" \
      https://github.com/Cerbur/clutch-dsh.git "$installer_tmp/packager"
  fi
  local entry="$installer_tmp/packager/scripts/desktop-packager/package-desktop.sh"
  for file in package-desktop.sh local-app.mjs patch-edit-menu.mjs extension-overlay.mjs extension-runtime.mjs renderer/plugin-manager.html renderer/plugin-manager.js renderer/plugin-manager.css; do
    if [ ! -s "$(dirname "$entry")/$file" ]; then
      echo "Incomplete packager checkout: missing $file" >&2; exit 1
    fi
  done
  # Build tools must not consume a curl | bash input stream.
  bash "$entry" "$@" </dev/null
)

dsh_desktop_install "$@"
