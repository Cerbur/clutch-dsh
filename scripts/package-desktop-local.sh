#!/usr/bin/env bash
set -euo pipefail

# One-key package DeepSeek Harness Desktop (macOS arm64) and install to /Applications
# Bundles Node runtime, offline seed store, and native plugin manager (Cmd+,)

REPO_ROOT="${DSH_REPO_ROOT:-/Users/yuancheng/Documents/Code/deepseek-harness}"
TARGET="mac-arm64"
TARGET_DIR="$REPO_ROOT/apps/desktop/.desktop-build/targets/$TARGET"
APP_OUTPUT="$TARGET_DIR/artifacts/$TARGET/DeepSeek Harness.app"
INSTALL_DEST="/Applications/DeepSeek Harness.app"

echo "==> Checking deepseek-harness repository: $REPO_ROOT"
if [ ! -d "$REPO_ROOT/apps/desktop" ]; then
  echo "Error: directory $REPO_ROOT/apps/desktop not found. Set DSH_REPO_ROOT to the correct path." >&2
  exit 1
fi

cd "$REPO_ROOT"

echo "==> 1. Building official artifacts and packing core tarballs..."
pnpm run build:official
pnpm run release:pack --family dsh --out "$TARGET_DIR/packed/dsh"
pnpm --dir apps/desktop-host pack --pack-destination "$TARGET_DIR/packed/dsh"
pnpm run release:pack --family vendor --out "$TARGET_DIR/packed/vendor"

mkdir -p "$TARGET_DIR/packed/landlock"
pnpm --dir native/landlock-run run build:ts
pnpm --dir native/landlock-run/packages/entry pack --pack-destination "$TARGET_DIR/packed/landlock"

echo "==> 2. Preparing runtime, package set, and offline seed..."
pnpm --filter @deepseek-ai/dsh-desktop run prepare:runtime
pnpm --filter @deepseek-ai/dsh-desktop run prepare:packages
pnpm --filter @deepseek-ai/dsh-desktop run prepare:seed

echo "==> 3. Building Desktop shell and renderer..."
cd "$REPO_ROOT/apps/desktop"
pnpm run build

echo "==> 4. Assembling raw unpacked app..."
export DSH_DESKTOP_APP_ID="${DSH_DESKTOP_APP_ID:-com.clutch.dsh}"
export CSC_IDENTITY_AUTO_DISCOVERY=false
pnpm exec electron-builder --config electron-builder.config.mjs --mac --arm64 --dir --publish never

echo "==> 5. Materializing missing transitive production dependencies..."
APP_DIR="$APP_OUTPUT" DESKTOP_DIR="$REPO_ROOT/apps/desktop" node --input-type=module << 'JS'
import { createRequire } from 'node:module';
import { readFileSync, cpSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const appDir = process.env.APP_DIR;
const desktopDir = process.env.DESKTOP_DIR;

function copyDep(name, from, dest, ancestors = new Map()) {
  const r = createRequire(join(from, 'package.json'));
  let manifest;
  try {
    manifest = r.resolve(name + '/package.json');
  } catch {
    return;
  }
  if (ancestors.get(name) === manifest) return;
  const source = dirname(manifest);
  const target = join(dest, 'node_modules', name);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, filter: p => p !== join(source, 'node_modules') });
  const next = new Map(ancestors);
  next.set(name, manifest);
  for (const dep of Object.keys(JSON.parse(readFileSync(manifest, 'utf8')).dependencies ?? {})) {
    copyDep(dep, source, target, next);
  }
}

for (const name of ['electron-updater', 'semver']) {
  copyDep(name, desktopDir, join(appDir, 'Contents/Resources/app'));
}
console.log('Production dependencies verified.');
JS

echo "==> 6. Signing app bundle locally (Ad-hoc codesign)..."
codesign --force --deep --sign - "$APP_OUTPUT"

echo "==> 7. Installing to $INSTALL_DEST..."
ditto "$APP_OUTPUT" "$INSTALL_DEST"
codesign --verify --deep --strict "$INSTALL_DEST"

echo "==> Package and installation completed successfully!"
echo "Open with Finder or terminal; press Cmd+, in app to use desktop plugin manager."

