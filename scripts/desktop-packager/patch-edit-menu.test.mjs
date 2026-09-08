import assert from 'node:assert/strict';
import process from 'node:process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { patchEditMenu } from './patch-edit-menu.mjs';

const repo = resolve(process.env.DSH_REPO_ROOT || '.');
const ts = createRequire(join(repo, 'package.json'))('typescript');
const template = (items) =>
  `import { Menu as M } from 'electron'; M.setApplicationMenu(M.buildFromTemplate([${items}]));`;
test('adds a top-level edit menu once and preserves the application submenu', () => {
  const source = template('{ label: "App", submenu: [{ role: "quit" }] }');
  const result = patchEditMenu(source, ts);
  assert.equal(
    result,
    template('{ label: "App", submenu: [{ role: "quit" }] }, { role: \'editMenu\' }'),
  );
  assert.equal(patchEditMenu(result, ts), result);
});
test('a nested editMenu does not replace the required top-level menu', () => {
  assert.match(
    patchEditMenu(template('{ submenu: [{role:"editMenu"}] }'), ts),
    /, \{ role: 'editMenu' \}\]/,
  );
});
test('rejects changed or ambiguous output', () => {
  for (const source of [
    'const x = 1;',
    template('{role:"editMenu"}, {label:"App"}'),
    template('{role:"editMenu"},{role:"editMenu"}'),
    template('...items'),
    template('').replace('[]', 'items'),
    template('{}') + 'M.buildFromTemplate([]);',
    template('{}').replace('setApplicationMenu', 'unknown'),
    template('{}') + ' invalid syntax {',
  ])
    assert.throws(() => patchEditMenu(source, ts), /edit menu:/);
});
test('patches the real compiled Desktop shell idempotently', () => {
  const source = readFileSync(join(repo, 'apps/desktop/lib/main.js'), 'utf8');
  const result = patchEditMenu(source, ts);
  assert.equal(patchEditMenu(result, ts), result);
});
