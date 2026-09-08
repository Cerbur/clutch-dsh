import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const scripts = dirname(fileURLToPath(import.meta.url));
function fixture(t, { failure = '', missing = false, local = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-installer-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const tool = (name, body) =>
    writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o755 });
  const packager = join(root, 'clutch/scripts/desktop-packager');
  mkdirSync(packager, { recursive: true });
  cpSync(join(scripts, 'package-desktop.sh'), join(packager, 'package-desktop.sh'));
  writeFileSync(join(packager, 'local-app.mjs'), '// fixture');
  if (!missing) writeFileSync(join(packager, 'patch-edit-menu.mjs'), '// fixture');
  const source = join(root, 'source/apps/desktop');
  mkdirSync(source, { recursive: true });
  const archive = (name, directory) => {
    const result = spawnSync('/usr/bin/tar', ['-czf', join(root, name), '-C', root, directory]);
    assert.equal(result.status, 0, result.stderr?.toString());
  };
  archive('packager.tgz', 'clutch');
  archive('source.tgz', 'source');
  tool('uname', 'if [ "$1" = -s ]; then echo Darwin; else echo arm64; fi');
  tool(
    'curl',
    `url=""; output=""
while [ "$#" -gt 0 ]; do
  case "$1" in https:*) url="$1";; --output) shift; output="$1";; esac
  shift
done
printf '%s\\n' "$url" >> "$TEST_ROOT/requests"
printf '%s\\n' "$(dirname "$output")" >> "$TEST_ROOT/temporary"
[ "$TEST_FAILURE" != download ] || exit 22
case "$url" in
  */Cerbur/clutch-dsh/*) cp "$TEST_ROOT/packager.tgz" "$output";;
  */deepseek-ai/deepseek-harness/*) cp "$TEST_ROOT/source.tgz" "$output";;
  *) exit 99;;
esac`,
  );
  tool(
    'pnpm',
    `printf '%s\\n' "$PWD" >> "$TEST_ROOT/build-roots"
test -d apps/desktop
test ! -d .git
if read -r line; then echo 'unexpected stdin' >&2; exit 90; fi
[ "$TEST_FAILURE" != build ] || exit 42`,
  );
  for (const name of ['node', 'codesign', 'ditto', 'plutil']) tool(name, 'exit 0');
  tool('git', "echo 'git must not be called' >&2; exit 91");
  const args = local ? ['-s', '--', join(root, 'source')] : ['-s'];
  const result = spawnSync('/bin/bash', args, {
    input: readFileSync(join(scripts, 'install.sh'), 'utf8'),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_ROOT: root,
      TEST_FAILURE: failure,
      DSH_REPO_ROOT: '',
      DSH_PACKAGER_REF: 'pinned-packager',
      DSH_SOURCE_REF: 'pinned-source',
    },
  });
  if (existsSync(join(root, 'temporary'))) {
    for (const path of readFileSync(join(root, 'temporary'), 'utf8').trim().split('\n')) {
      assert.equal(existsSync(path), false, `temporary directory leaked: ${path}`);
    }
  }
  return { result, root };
}

test('piped installer builds downloaded source archives without git or stdin', (t) => {
  const { result, root } = fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(root, 'requests'), 'utf8'), /clutch-dsh\/tar.gz\/pinned-packager/);
  assert.match(
    readFileSync(join(root, 'requests'), 'utf8'),
    /deepseek-harness\/tar.gz\/pinned-source/,
  );
  assert.ok(existsSync(join(root, 'build-roots')));
});
test('forwards an existing source path without downloading dsh', (t) => {
  const { result, root } = fixture(t, { local: true });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(readFileSync(join(root, 'requests'), 'utf8'), /deepseek-harness/);
  assert.ok(existsSync(join(root, 'source')));
});
test('preserves download failure exit code', (t) => {
  assert.equal(fixture(t, { failure: 'download' }).result.status, 22);
});
test('preserves build failure exit code and cleans both archives', (t) => {
  assert.equal(fixture(t, { failure: 'build' }).result.status, 42);
});
test('rejects an incomplete packager before any build', (t) => {
  const { result, root } = fixture(t, { missing: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Incomplete packager archive/);
  assert.equal(existsSync(join(root, 'build-roots')), false);
});
