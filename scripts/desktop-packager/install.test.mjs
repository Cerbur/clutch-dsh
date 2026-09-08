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
const sourceSha = '0123456789abcdef0123456789abcdef01234567';
function fixture(
  t,
  { failure = '', missing = false, local = false, sha = false, concurrency = '' } = {},
) {
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
  for (const file of ['extension-overlay.mjs', 'extension-runtime.mjs']) {
    writeFileSync(join(packager, file), '// fixture');
  }
  mkdirSync(join(packager, 'renderer'));
  for (const file of ['plugin-manager.html', 'plugin-manager.js', 'plugin-manager.css']) {
    writeFileSync(join(packager, 'renderer', file), '// fixture');
  }
  if (!missing) writeFileSync(join(packager, 'patch-edit-menu.mjs'), '// fixture');
  const source = join(root, 'source/apps/desktop');
  mkdirSync(source, { recursive: true });
  tool('uname', 'if [ "$1" = -s ]; then echo Darwin; else echo arm64; fi');
  tool(
    'git',
    `printf '%s\\n' "$*" >> "$TEST_ROOT/requests"
[ "$TEST_FAILURE" != download ] || exit 22
if [ "$1" = -C ]; then
  destination="$2"; shift 2
else
  destination="\${!#}"
fi
case "$1" in
  clone|init)
    printf '%s\\n' "$(dirname "$destination")" >> "$TEST_ROOT/temporary"
    case "$destination" in
      */packager) cp -R "$TEST_ROOT/clutch" "$destination";;
      */repo) cp -R "$TEST_ROOT/source" "$destination";;
      *) exit 99;;
    esac
    mkdir "$destination/.git";;
  fetch) [[ "$*" = *'--depth 1'* ]] || exit 98;;
  checkout) test "$*" = 'checkout --quiet --detach FETCH_HEAD';;
  rev-parse) echo '${sourceSha}';;
  *) exit 97;;
esac`,
  );
  tool(
    'pnpm',
    `printf '%s\\n' "$PWD" >> "$TEST_ROOT/build-roots"
printf '%s\\n' "$*" >> "$TEST_ROOT/pnpm-requests"
test -d apps/desktop
if [ "$TEST_LOCAL" = false ]; then
  test -d .git
  test "\${DSH_CLIENT_COMMIT_HASH:-}" = '${sourceSha}' || { echo 'missing checkout commit metadata' >&2; exit 89; }
fi
if read -r line; then echo 'unexpected stdin' >&2; exit 90; fi
if [ "$TEST_FAILURE" = pack ] && [ "$1" = run ] && [ "$2" = release:pack ]; then
  echo 'fixture pack failure' >&2; exit 43
fi
[ "$TEST_FAILURE" != build ] || exit 42`,
  );
  tool('node', 'if [ "$1" = --eval ]; then exec "$TEST_NODE" "$@"; fi');
  for (const name of ['codesign', 'ditto', 'plutil']) tool(name, 'exit 0');
  tool('curl', "echo 'archive downloads must not be called' >&2; exit 91");
  const args = local ? ['-s', '--', join(root, 'source')] : ['-s'];
  const result = spawnSync('/bin/bash', args, {
    input: readFileSync(join(scripts, 'install.sh'), 'utf8'),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_ROOT: root,
      TEST_FAILURE: failure,
      TEST_LOCAL: String(local),
      TEST_NODE: process.execPath,
      DSH_CLIENT_COMMIT_HASH: 'ffffffffffffffffffffffffffffffffffffffff',
      DSH_REPO_ROOT: '',
      DSH_PACKAGER_REF: sha ? sourceSha : 'pinned-packager',
      DSH_SOURCE_REF: sha ? sourceSha : 'pinned-source',
      DSH_PACK_CONCURRENCY: concurrency,
    },
  });
  if (existsSync(join(root, 'temporary'))) {
    for (const path of readFileSync(join(root, 'temporary'), 'utf8').trim().split('\n')) {
      assert.equal(existsSync(path), false, `temporary directory leaked: ${path}`);
    }
  }
  return { result, root };
}

test('piped installer shallow-clones selected refs and builds without stdin', (t) => {
  const { result, root } = fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(join(root, 'requests'), 'utf8'),
    /clone --depth 1 --single-branch --branch pinned-packager https:\/\/github.com\/Cerbur\/clutch-dsh.git/,
  );
  assert.match(
    readFileSync(join(root, 'requests'), 'utf8'),
    /clone --depth 1 --single-branch --branch pinned-source https:\/\/github.com\/deepseek-ai\/deepseek-harness.git/,
  );
  assert.ok(existsSync(join(root, 'build-roots')));
  const packRequests = readFileSync(join(root, 'pnpm-requests'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('run release:pack'));
  assert.equal(packRequests.length, 2);
  for (const request of packRequests) assert.match(request, / --concurrency 4$/);
});
test('full commit SHAs use shallow fetch and detached checkout', (t) => {
  const { result, root } = fixture(t, { sha: true });
  assert.equal(result.status, 0, result.stderr);
  const requests = readFileSync(join(root, 'requests'), 'utf8');
  assert.equal((requests.match(/fetch --depth 1/g) || []).length, 2);
  assert.equal((requests.match(/checkout --quiet --detach FETCH_HEAD/g) || []).length, 2);
  assert.doesNotMatch(requests, /clone /);
});
test('forwards an existing source path without downloading dsh', (t) => {
  const { result, root } = fixture(t, { local: true, concurrency: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(readFileSync(join(root, 'requests'), 'utf8'), /deepseek-harness/);
  assert.ok(existsSync(join(root, 'source')));
  const packRequests = readFileSync(join(root, 'pnpm-requests'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('run release:pack'));
  assert.equal(packRequests.length, 2);
  for (const request of packRequests) assert.match(request, / --concurrency 1$/);
});
test('preserves download failure exit code', (t) => {
  assert.equal(fixture(t, { failure: 'download' }).result.status, 22);
});
test('preserves build failure exit code and cleans both checkouts', (t) => {
  assert.equal(fixture(t, { failure: 'build' }).result.status, 42);
});
test('rejects invalid packing concurrency before fetching dsh or building', (t) => {
  for (const concurrency of ['0', '-1', '1.5', 'four', '9007199254740992']) {
    const { result, root } = fixture(t, { concurrency });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DSH_PACK_CONCURRENCY must be a positive safe integer/);
    assert.doesNotMatch(readFileSync(join(root, 'requests'), 'utf8'), /deepseek-harness/);
    assert.equal(existsSync(join(root, 'build-roots')), false);
  }
});
test('packing failure stops before seed preparation and preserves the exit code', (t) => {
  const { result, root } = fixture(t, { failure: 'pack' });
  assert.equal(result.status, 43);
  assert.match(result.stderr, /fixture pack failure/);
  assert.doesNotMatch(readFileSync(join(root, 'pnpm-requests'), 'utf8'), /prepare:|desktop-host/);
  assert.doesNotMatch(result.stdout, /Packed dsh packages in/);
});
test('rejects an incomplete packager before any build', (t) => {
  const { result, root } = fixture(t, { missing: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Incomplete packager checkout/);
  assert.equal(existsSync(join(root, 'build-roots')), false);
});
