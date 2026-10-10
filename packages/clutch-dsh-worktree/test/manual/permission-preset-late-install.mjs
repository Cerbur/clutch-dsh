// Intentionally red repro: baseline late insertion must expose Worktree Full Access.
// Run after building this package. Native catalog is a fixture; Cordis/Loader and
// the permission contribution are real. This does not touch any installed profile.
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import { z } from 'zod';
import { URL } from 'node:url';
import * as contribution from '../../lib/host/permission-preset-append.js';

class NativeCatalog {
  static Config = z.object({ presets: z.record(z.string(), z.object({
    sandbox: z.string(), approval: z.string(), name: z.string().optional(),
  })).default({
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
  }) });
  constructor(ctx, config) { this.config = config; ctx.provide('permissionPresets', this); }
  get names() { return Object.keys(this.config.presets); }
}
const ctx = new Context();
ctx.baseUrl = new URL('../../cordis.fixture.yml', import.meta.url).href;
try {
  await ctx.plugin(Loader);
  ctx.loader.internal = { version: 'v2', async import(name) {
    return name === '@deepseek-ai/dsh-permission-presets' ? { default: NativeCatalog } : contribution;
  } };
  await ctx.loader.root.update([{ id: 'permission', name: '@deepseek-ai/dsh-permission-presets', config: {} }]);
  await ctx.loader.await();
  assert.deepEqual(ctx.permissionPresets.names, ['workspace-write', 'danger-full-access']);
  await ctx.loader.create({ id: 'mkt-worktree-contribution', name: '@cerbur/clutch-dsh-worktree/permission-presets' });
  await ctx.loader.await();
  assert.deepEqual(ctx.permissionPresets.names, ['workspace-write', 'danger-full-access', 'worktree-full-access']);
} finally {
  await ctx.fiber.dispose();
}
