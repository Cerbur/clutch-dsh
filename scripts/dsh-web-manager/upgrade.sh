#!/usr/bin/env bash

# DeepSeek Harness Web Manager (dwm) Upgrader
#
# Quick upgrade via curl:
#   curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/dsh-web-manager/upgrade.sh | bash

dwm_upgrade() (
  set -euo pipefail

  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo 'DeepSeek Harness Web Manager (dwm) Upgrader'
    echo ''
    echo 'Usage: bash upgrade.sh'
    echo ''
    echo 'Environment variables:'
    echo '  DWM_REF:           clutch-dsh branch, tag, or commit (default: main)'
    echo '  DWM_INSTALL_DIR:   Target directory for dwm code (default: ~/.dwm/manager)'
    echo '  DWM_REPO_URL:      Git repository URL (default: https://github.com/Cerbur/clutch-dsh.git)'
    echo '  DWM_SKIP_LINK:     Set to 1 to skip running npm link'
    exit 0
  fi

  echo '==> Upgrading DeepSeek Harness Web Manager (dwm)...'

  # 1. Verify dependencies
  for tool in node git npm; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "❌ Error: missing required tool: $tool" >&2
      exit 1
    fi
  done

  local node_major
  node_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "$node_major" -lt 18 ]; then
    echo "❌ Error: Node.js 18+ is required (found $(node -v))" >&2
    exit 1
  fi

  # 2. Determine target directories
  local install_dir="${DWM_INSTALL_DIR:-$HOME/.dwm/manager}"
  local repo_url="${DWM_REPO_URL:-https://github.com/Cerbur/clutch-dsh.git}"
  local ref="${DWM_REF:-main}"

  local upgrader_tmp
  upgrader_tmp="$(mktemp -d /tmp/dwm-upgrader-XXXXXX)"
  trap 'rm -rf -- "$upgrader_tmp"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  echo "==> Fetching latest dwm source from ${repo_url} (${ref})..."
  if [[ "$ref" =~ ^[0-9a-fA-F]{40}$ ]]; then
    git init --quiet "$upgrader_tmp/repo"
    git -C "$upgrader_tmp/repo" fetch --depth 1 "$repo_url" "$ref"
    git -C "$upgrader_tmp/repo" checkout --quiet --detach FETCH_HEAD
  else
    git clone --depth 1 --single-branch --branch "$ref" "$repo_url" "$upgrader_tmp/repo"
  fi

  local src_dir="$upgrader_tmp/repo/scripts/dsh-web-manager"
  if [ ! -f "$src_dir/bin/dwm.mjs" ]; then
    echo "❌ Error: incomplete checkout, missing scripts/dsh-web-manager/bin/dwm.mjs" >&2
    exit 1
  fi

  echo "==> Updating dwm in $install_dir..."
  mkdir -p "$(dirname "$install_dir")"
  rm -rf "$install_dir"
  cp -R "$src_dir" "$install_dir"

  chmod +x "$install_dir/bin/dwm.mjs"

  # 3. Global linking
  local link_succeeded=0
  if [ "${DWM_SKIP_LINK:-0}" != "1" ]; then
    echo '==> Updating global link via npm link...'
    if (cd "$install_dir" && npm link </dev/null >/dev/null 2>&1); then
      link_succeeded=1
    elif (cd "$install_dir" && npm link </dev/null); then
      link_succeeded=1
    else
      echo '⚠️  npm link failed (possibly permissions). Creating local binary symlinks instead.'
    fi
  fi

  # Always ensure symlink in ~/.dwm/bin/dwm and ~/.local/bin/dwm if writable
  mkdir -p "$HOME/.dwm/bin"
  ln -sf "$install_dir/bin/dwm.mjs" "$HOME/.dwm/bin/dwm"

  if [ -d "$HOME/.local/bin" ] || mkdir -p "$HOME/.local/bin" 2>/dev/null; then
    ln -sf "$install_dir/bin/dwm.mjs" "$HOME/.local/bin/dwm" 2>/dev/null || true
  fi

  local new_version
  new_version="$(node "$install_dir/bin/dwm.mjs" --version 2>/dev/null || echo 'unknown')"

  echo ''
  echo '==================================================='
  echo "  🎉 DeepSeek Harness Web Manager upgraded to ${new_version}!"
  echo '==================================================='
  echo ''
  echo "Location: $install_dir"
  echo "Binary:   $install_dir/bin/dwm.mjs"
  echo ''
)

dwm_upgrade "$@"
