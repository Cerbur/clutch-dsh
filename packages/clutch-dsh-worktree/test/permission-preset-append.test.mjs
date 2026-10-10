import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { URL, pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import { z } from 'zod';
import * as contribution from '../lib/host/permission-preset-append.js';

// Cordis exposes Include as its optional peer; use that same installed graph.
const require = createRequire(import.meta.url);
const cordisRequire = createRequire(require.resolve('@deepseek-ai/cordis/package.json'));
const { applyEntryPatches, entryListSchema } = await import(pathToFileURL(
  cordisRequire.resolve('@deepseek-ai/cordis-plugin-include'),
).href);
const yaml = cordisRequire('js-yaml');
const patch = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), {
  schema: entryListSchema,
});

test('installing Worktree preserves the existing permission table and default', () => {
  const original = {
    id: 'permission',
    name: '@deepseek-ai/dsh-permission-presets',
    config: {
      defaultPreset: 'team-review',
      presets: {
        'team-review': { sandbox: 'workspace-write', approval: 'ask', name: 'Team review' },
      },
    },
  };
  const [permission] = applyEntryPatches([original], patch, assert.fail);
  assert.deepEqual(permission.config, original.config);
});

const nativeDefaults = {
  'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
  'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
};
const spec = z.object({ sandbox: z.string(), approval: z.string(), name: z.string().optional() });

class PermissionFixture {
  static Config = z.object({
    presets: z.record(z.string(), spec).default(nativeDefaults),
    defaultPreset: z.string().optional(),
  });

  constructor(ctx, config) {
    this.config = config;
    this.auto = false;
    ctx.provide('permissionPresets', this);
  }

  registerAuto(ctx) {
    ctx.effect(() => {
      this.auto = true;
      return () => { this.auto = false; };
    });
  }

  catalog() {
    const names = Object.keys(this.config.presets);
    return {
      options: [...names, ...(this.auto ? ['auto'] : [])],
      defaultOptions: names,
      defaultPreset: this.config.defaultPreset,
    };
  }
}

const autoFixture = {
  inject: ['permissionPresets'],
  apply(ctx) { ctx.permissionPresets.registerAuto(ctx); },
};

function entries(config) {
  return [{ id: 'permission', name: '@deepseek-ai/dsh-permission-presets', config }];
}

function withContribution(rows) {
  return applyEntryPatches(rows, patch, assert.fail)
    .filter(row => row.id !== 'clutch-dsh-worktree-host');
}

async function mounted(config) {
  const ctx = new Context();
  ctx.baseUrl = new URL('../cordis.fixture.yml', import.meta.url).href;
  await ctx.plugin(Loader);
  ctx.loader.internal = {
    version: 'v2',
    async import(name) {
      if (name === '@deepseek-ai/dsh-permission-presets') return { default: PermissionFixture };
      if (name === '@cerbur/clutch-dsh-worktree/permission-presets') {
        // Force the native entry to resolve first; its startup gate must wait.
        await setTimeout(10);
        return contribution;
      }
      throw new Error(`unexpected fixture module: ${name}`);
    },
  };
  try {
    await ctx.loader.root.update(withContribution(entries(config)));
    await ctx.loader.await();
    assert.ok(ctx.get('permissionPresets'), 'native permission service must activate');
    return ctx;
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}

test('appends once after native defaults and leaves Loader config untouched', async () => {
  const ctx = await mounted({});
  try {
    assert.deepEqual(ctx.permissionPresets.catalog().options, [
      'workspace-write', 'danger-full-access', 'worktree-full-access',
    ]);
    assert.deepEqual(ctx.loader.resolve('permission').options.config, {});
    assert.equal(ctx.permissionPresets.config.presets['worktree-full-access'].sandbox, 'danger-full-access');
    assert.equal(ctx.permissionPresets.config.presets['worktree-full-access'].approval, 'ask');
  } finally {
    await ctx.fiber.dispose();
  }
});

test('preserves configured presets, default and live Auto through reload and removal', async () => {
  const custom = { 'team-review': { sandbox: 'workspace-write', approval: 'ask', name: 'Team review' } };
  const raw = { presets: custom, defaultPreset: 'team-review' };
  const ctx = await mounted(raw);
  try {
    await ctx.plugin(autoFixture);
    assert.deepEqual(ctx.permissionPresets.catalog(), {
      options: ['team-review', 'worktree-full-access', 'auto'],
      defaultOptions: ['team-review', 'worktree-full-access'],
      defaultPreset: 'team-review',
    });
    assert.deepEqual(ctx.loader.resolve('permission').options.config, raw);
    const updated = { ...raw, presets: { ...custom, audit: { sandbox: 'read-only', approval: 'ask' } } };
    await ctx.loader.root.update(withContribution(entries(updated)));
    await ctx.loader.await();
    assert.deepEqual(ctx.permissionPresets.catalog().options, [
      'team-review', 'audit', 'worktree-full-access', 'auto',
    ]);
    assert.equal(ctx.permissionPresets.config.defaultPreset, 'team-review');
    assert.deepEqual(ctx.loader.resolve('permission').options.config, updated);

    await ctx.loader.root.update(entries(updated));
    await ctx.loader.await();
    assert.equal(ctx.get('clutchWorktreePermissionPresets'), undefined);
    assert.deepEqual(ctx.permissionPresets.catalog().options, ['team-review', 'audit', 'auto']);
    assert.deepEqual(ctx.permissionPresets.config, updated);
    assert.deepEqual(custom, raw.presets);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('does not replace an existing same-name preset', async () => {
  const existing = { sandbox: 'danger-full-access', approval: 'ask', name: 'My Worktree' };
  const ctx = await mounted({ presets: { ...nativeDefaults, 'worktree-full-access': existing } });
  try {
    assert.deepEqual(ctx.permissionPresets.config.presets['worktree-full-access'], existing);
    assert.equal(ctx.permissionPresets.catalog().options.filter(name => name === 'worktree-full-access').length, 1);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('reloading the contributor keeps native permissions and live Auto available', async () => {
  const ctx = await mounted({});
  try {
    await ctx.plugin(autoFixture);
    await ctx.loader.resolve('clutch-dsh-worktree-permission-presets').fiber.restart();
    await ctx.loader.await();
    assert.deepEqual(ctx.permissionPresets.catalog().options, [
      'workspace-write', 'danger-full-access', 'worktree-full-access', 'auto',
    ]);
    assert.deepEqual(ctx.loader.resolve('permission').options.config, {});
  } finally {
    await ctx.fiber.dispose();
  }
});

test('scopes the contribution to the native permission entry', async () => {
  const ctx = await mounted({});
  try {
    await ctx.loader.root.update(withContribution(entries({})).filter(row => row.id !== 'permission'));
    await ctx.loader.await();
    const raw = { presets: { isolated: { sandbox: 'read-only', approval: 'ask' } } };
    const otherId = await ctx.loader.create({ id: 'other-permission', name: '@deepseek-ai/dsh-permission-presets', config: raw });
    await ctx.loader.await();
    const other = ctx.loader.resolve(otherId);
    assert.deepEqual(other.fiber.config, raw);
    assert.deepEqual(other.options.config, raw);
  } finally {
    await ctx.fiber.dispose();
  }
});
