import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
import { Context } from '@deepseek-ai/cordis';
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file';
import { parse, stringify } from 'yaml';
import { registerTemplateSettings } from '../lib/settings.js';
import { templateMutation } from '../lib/templates.js';

test('first template write preserves inherited legacy and deletion persists an empty map', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'title-legacy-'));
  const path = join(directory, 'settings.yaml');
  const ctx = new Context();
  try {
    await ctx.plugin(FileSettingsProvider, { path, watch: false });
    const read = registerTemplateSettings(ctx, { template: 'Legacy' });
    const write = (action) =>
      ctx.settings.mutate('clutch-dsh-title', templateMutation(read(), action));
    await write({ kind: 'delete', id: 'legacy' });
    assert.deepEqual(
      read().rows.map((row) => row.id),
      ['default'],
    );
    await ctx.settings.replace('clutch-dsh-title', {});
    assert.equal(read().effective, 'legacy');
    await write({ kind: 'create', id: 'personal', source: 'template: New' });
    assert.equal(read().effective, 'legacy');
    assert.equal(read().rows.length, 3);
    await write({ kind: 'delete', id: 'personal' });
    await write({ kind: 'delete', id: 'legacy' });
    assert.deepEqual(
      read().rows.map((row) => row.id),
      ['default'],
    );
    assert.deepEqual(parse(await readFile(path, 'utf8'))['clutch-dsh-title'].templates, {});
  } finally {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test('native settings file preserves other namespaces and rejects stale writes after external edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'title-settings-'));
  const path = join(directory, 'settings.yaml');
  const ctx = new Context();
  try {
    await writeFile(path, '# user settings\nother:\n  keep: true\n');
    await ctx.plugin(FileSettingsProvider, { path, watch: true, debounceMs: 10 });
    const read = registerTemplateSettings(ctx, {});
    const view = () => ctx.settings.describe().find((item) => item.ns === 'clutch-dsh-title');
    await ctx.settings.mutate(
      'clutch-dsh-title',
      templateMutation(read(), { kind: 'create', id: 'personal', source: 'template: Hello' }),
      view().revision,
    );
    await ctx.settings.mutate(
      'clutch-dsh-title',
      templateMutation(read(), { kind: 'activate', id: 'personal' }),
      view().revision,
    );
    assert.equal(read().effective, 'personal');
    const text = await readFile(path, 'utf8');
    assert.match(text, /# user settings/);
    assert.equal(parse(text).other.keep, true);
    const revision = view().revision;
    const doc = parse(text);
    doc['clutch-dsh-title'].templates.personal = 'template: "${missing}"';
    const changed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('settings watcher did not publish external edit'));
      }, 5000);
      const off = ctx.on('settings/document-updated', (ns) => {
        if (ns !== 'clutch-dsh-title') return;
        clearTimeout(timer);
        off();
        resolve();
      });
    });
    await writeFile(path, stringify(doc));
    await changed;
    await assert.rejects(
      ctx.settings.mutate(
        'clutch-dsh-title',
        [{ op: 'set', path: ['enabled'], value: false }],
        revision,
      ),
      /conflict|changed/i,
    );
    assert.equal(read().effective, 'default');
    assert.ok(read().rows.find((row) => row.id === 'personal').error);
    await ctx.settings.mutate(
      'clutch-dsh-title',
      templateMutation(read(), { kind: 'save', id: 'personal', source: 'template: Repaired' }),
      view().revision,
    );
    assert.equal(read().effective, 'personal');
    assert.equal(read().config.template, 'Repaired');
  } finally {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
