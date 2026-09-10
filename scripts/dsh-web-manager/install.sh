#!/usr/bin/env bash

# DeepSeek Harness Web Manager (dwm) Installer
#
# Quick install via curl:
#   curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/dsh-web-manager/install.sh | bash
#
# Pass custom DSH repository path:
#   curl -fsSL https://raw.githubusercontent.com/Cerbur/clutch-dsh/main/scripts/dsh-web-manager/install.sh | bash -s -- /path/to/deepseek-harness

dwm_install() (
  set -euo pipefail

  if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo 'DeepSeek Harness Web Manager (dwm) Installer'
    echo ''
    echo 'Usage: bash install.sh [deepseek-harness-directory]'
    echo ''
    echo 'Environment variables:'
    echo '  DWM_REF:           clutch-dsh branch, tag, or commit (default: main)'
    echo '  DWM_INSTALL_DIR:   Target directory for dwm code (default: ~/.dwm/manager)'
    echo '  DWM_REPO_URL:      Git repository URL (default: https://github.com/Cerbur/clutch-dsh.git)'
    echo '  DWM_SKIP_LINK:     Set to 1 to skip running npm link'
    exit 0
  fi

  local target_dsh="${1:-}"

  echo '==> Installing DeepSeek Harness Web Manager (dwm)...'

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

  local installer_tmp
  installer_tmp="$(mktemp -d /tmp/dwm-installer-XXXXXX)"
  trap 'rm -rf -- "$installer_tmp"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  echo "==> Fetching dwm source from ${repo_url} (${ref})..."
  if [[ "$ref" =~ ^[0-9a-fA-F]{40}$ ]]; then
    git init --quiet "$installer_tmp/repo"
    git -C "$installer_tmp/repo" fetch --depth 1 "$repo_url" "$ref"
    git -C "$installer_tmp/repo" checkout --quiet --detach FETCH_HEAD
  else
    git clone --depth 1 --single-branch --branch "$ref" "$repo_url" "$installer_tmp/repo"
  fi

  local src_dir="$installer_tmp/repo/scripts/dsh-web-manager"
  if [ ! -f "$src_dir/bin/dwm.mjs" ]; then
    echo "❌ Error: incomplete checkout, missing scripts/dsh-web-manager/bin/dwm.mjs" >&2
    exit 1
  fi

  echo "==> Materializing dwm in $install_dir..."
  mkdir -p "$(dirname "$install_dir")"
  rm -rf "$install_dir"
  cp -R "$src_dir" "$install_dir"

  chmod +x "$install_dir/bin/dwm.mjs"

  # 3. Global linking
  local link_succeeded=0
  if [ "${DWM_SKIP_LINK:-0}" != "1" ]; then
    echo '==> Linking dwm globally via npm link...'
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

  # 4. Configure DSH home if path given or environment variable detected
  local dwm_bin="$install_dir/bin/dwm.mjs"
  if [ -n "$target_dsh" ]; then
    echo "==> Configuring DSH Home to: $target_dsh"
    node "$dwm_bin" home "$target_dsh" </dev/null || true
  elif [ -n "$DSH_REPO_ROOT" ] && [ -d "$DSH_REPO_ROOT" ]; then
    echo "==> Configuring DSH Home from DSH_REPO_ROOT: $DSH_REPO_ROOT"
    node "$dwm_bin" home "$DSH_REPO_ROOT" </dev/null || true
  elif [ -n "$DSH_HOME" ] && [ -d "$DSH_HOME" ]; then
    echo "==> Configuring DSH Home from DSH_HOME: $DSH_HOME"
    node "$dwm_bin" home "$DSH_HOME" </dev/null || true
  fi

  echo ''
  echo '==================================================='
  echo '  🎉 DeepSeek Harness Web Manager (dwm) Installed! '
  echo '==================================================='
  echo ''
  echo "Location: $install_dir"
  echo "Binary:   $dwm_bin"
  echo ''

  if command -v dwm >/dev/null 2>&1; then
    echo '✅ "dwm" command is directly available in your terminal.'
  else
    echo '💡 Note: To use "dwm" directly, make sure one of these is in your PATH:'
    echo '   export PATH="$HOME/.dwm/bin:$HOME/.local/bin:$PATH"'
  fi

  echo ''
  echo 'Getting Started:'
  echo '  dwm home           # View configured DSH home'
  echo '  dwm status         # Check service status'
  echo '  dwm start          # Start DSH Web service in background'
  echo '  dwm logs -f        # View real-time logs'
  echo '  dwm down           # Stop DSH Web service'
  echo '  dwm uninstall      # Uninstall dwm'
  echo ''
)

dwm_install "$@"
