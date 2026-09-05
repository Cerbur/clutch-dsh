import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPackageModule } from './load-module.mjs';
const { decodeTemplates, validateTemplate, templateMutation, DEFAULT_TEMPLATE } =
  await loadPackageModule('templates');

test('default is immutable even when externally replaced', () => {
  const state = decodeTemplates({ active: 'default', templates: { default: 'template: hacked' } });
  assert.equal(state.effective, 'default');
  assert.equal(state.rows[0].source, DEFAULT_TEMPLATE);
  assert.ok(state.errors.length);
  assert.throws(() =>
    templateMutation(state, { kind: 'save', id: 'default', source: DEFAULT_TEMPLATE }),
  );
  assert.throws(() => templateMutation(state, { kind: 'delete', id: 'default' }));
});
test('external invalid and missing active templates fall back without hiding broken rows', () => {
  for (const source of ['template: "${missing}"', 'template: [', 12, null]) {
    const state = decodeTemplates({ active: 'bad', templates: { bad: source } });
    assert.equal(state.effective, 'default');
    assert.ok(state.rows.find((row) => row.id === 'bad').error);
    assert.throws(() => templateMutation(state, { kind: 'activate', id: 'bad' }));
  }
  assert.equal(decodeTemplates({ active: 'gone' }).effective, 'default');
});
test('valid YAML supports custom fields and rejects unsafe or malformed definitions', () => {
  assert.equal(validateTemplate('template: hello').template, 'hello');
  for (const source of [
    '[]',
    'template: "${desc.x}"',
    'template: hi\nfields:\n  desc:\n    kind: unknown',
    'template: a\ntemplate: b',
    'provider: secret',
  ]) {
    assert.throws(() => validateTemplate(source));
  }
});
test('save, activate, disable and delete mutations preserve unrelated invalid entries', () => {
  const state = decodeTemplates({
    enabled: false,
    active: 'ok',
    templates: { ok: 'template: hi', bad: 'template: [' },
  });
  assert.equal(state.enabled, false);
  assert.equal(state.effective, 'ok');
  assert.deepEqual(templateMutation(state, { kind: 'delete', id: 'ok' }), [
    { op: 'set', path: ['templates'], value: { bad: 'template: [' } },
    { op: 'set', path: ['active'], value: 'default' },
  ]);
  assert.deepEqual(templateMutation(state, { kind: 'enabled', enabled: true }), [
    { op: 'set', path: ['enabled'], value: true },
  ]);
  assert.throws(() =>
    templateMutation(state, { kind: 'save', id: '__proto__', source: 'template: hi' }),
  );
  assert.throws(() =>
    templateMutation(state, { kind: 'create', id: 'ok', source: 'template: hi' }),
  );
});
test('corrupt settings containers never throw or become valid active templates', () => {
  for (const raw of [null, [], 1, { templates: [] }, { enabled: 'false', active: 12 }]) {
    const state = decodeTemplates(raw);
    assert.equal(state.effective, 'default');
    assert.ok(state.errors.length);
  }
});
