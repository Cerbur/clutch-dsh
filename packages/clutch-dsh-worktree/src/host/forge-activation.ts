import type { Context } from '@deepseek-ai/cordis';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createWorktreeError } from '../contract/index.js';
import { NativeSessionCreationPreflightError } from '../tool/native-session.js';

export const FORGE_BUNDLE = '@deepseek-ai/dsh-experimental-forge-bundle';

interface Bundle {
  name: string;
  enabled: boolean;
  availability: string;
  error?: { code: string };
}
interface PluginManager {
  listBundles(): Promise<readonly Bundle[]>;
  listPlugins(): Promise<readonly { patchId?: string; moduleName: string; enabled: boolean; fiberPhase: string | null }[]>;
  setBundleEnabled(name: string, enabled: boolean): Promise<{
    application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled';
    error?: { code: string };
  }>;
}
type UnavailableReason = 'starting' | 'disabled' | 'restart-required' | 'failed' | 'unavailable';

/** This preference is per profile, not a Workspace relationship or Session fact. */
async function claimActivation(dshHome: string, profile: string): Promise<boolean> {
  const key = createHash('sha256').update(profile).digest('hex');
  const filename = path.join(dshHome, 'clutch-dsh-worktree', 'forge-activation', key + '.json');
  await mkdir(path.dirname(filename), { recursive: true });
  let handle;
  try { handle = await open(filename, 'wx', 0o600); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const saved = JSON.parse(await readFile(filename, 'utf8')) as { version?: unknown; bundle?: unknown };
    if (saved.version !== 1 || saved.bundle !== FORGE_BUNDLE) throw new Error('Invalid Forge activation preference', { cause: error });
    return false;
  }
  try {
    await handle.writeFile(JSON.stringify({ version: 1, bundle: FORGE_BUNDLE }) + '\n');
    await handle.sync();
  } catch (error) {
    await unlink(filename).catch(() => undefined);
    throw error;
  } finally { await handle.close(); }
  return true;
}

/** Enables a separately owned official bundle once. Disposal never disables or removes it. */
export function registerForgeActivation(ctx: Context, dshHome: string): { assertReady(): Promise<void> } {
  let reason: UnavailableReason = 'starting';
  let diagnostic = '';
  let disposed = false;
  let started = false;
  let managerGeneration = 0;
  ctx.effect(() => () => { disposed = true; }, 'clutch-dsh-worktree: Forge activation observer');

  ctx.inject(['pluginManager'], (managerCtx) => {
    let active = true;
    managerGeneration++;
    // Do not await HMR/profile mutation from plugin initialization: reconciliation
    // can dispose/reload this very plugin while holding the profile lock.
    const timer = setTimeout(() => {
      if (disposed || !active || started) return;
      started = true;
      const manager = managerCtx.get('pluginManager') as PluginManager;
      void (async () => {
        const profile = ctx.get('profileContext') as { dir?: string } | undefined;
        if (!profile?.dir || !path.isAbsolute(profile.dir)) { reason = 'unavailable'; return; }
        const bundle = (await manager.listBundles()).find(item => item.name === FORGE_BUNDLE);
        if (disposed || !active) return;
        const first = await claimActivation(dshHome, profile.dir);
        if (disposed || !active) return;
        if (!bundle || bundle.availability === 'missing' || bundle.error) {
          reason = 'unavailable';
          diagnostic = bundle?.error?.code ?? 'official-bundle-unavailable';
          return;
        }
        if (bundle.enabled) { reason = 'disabled'; return; }
        if (!first) { reason = 'disabled'; return; }
        const result = await manager.setBundleEnabled(FORGE_BUNDLE, true);
        if (disposed || !active) return;
        reason = result.application === 'restart-required' ? 'restart-required'
          : result.application === 'applied' || result.application === 'overridden' ? 'disabled' : 'failed';
        diagnostic = result.error?.code ?? '';
      })().catch((error: unknown) => {
        if (disposed || !active) return;
        reason = 'failed';
        diagnostic = (error instanceof Error ? error.message : String(error)).slice(0, 300);
      });
    }, 0);
    managerCtx.effect(() => () => {
      active = false;
      managerGeneration++;
      clearTimeout(timer);
    }, 'clutch-dsh-worktree: deferred Forge activation');
  });

  return {
    async assertReady() {
      const manager = ctx.get('pluginManager') as PluginManager | undefined;
      const generation = managerGeneration;
      if (!disposed && manager) {
        try {
          const [bundles, plugins] = await Promise.all([manager.listBundles(), manager.listPlugins()]);
          // Contextual service proxies can see the global Worktree backend even
          // when the panel's isolated one is disabled. Use the official inventory.
          const bundle = bundles.find(item => item.name === FORGE_BUNDLE);
          const active = (id: string, moduleName: string) => plugins.some(row =>
            row.patchId === id && row.moduleName === moduleName && row.enabled && row.fiberPhase === 'active');
          if (!disposed && generation === managerGeneration && ctx.get('pluginManager') &&
            bundle?.enabled && !bundle.error && ctx.get('forgePanel') &&
            active('forge-panel', '@deepseek-ai/dsh-experimental-client-ui-forge') &&
            active('forge-worktree', '@deepseek-ai/dsh-experimental-worktree')) return;
        } catch (error) {
          reason = 'failed';
          diagnostic = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        }
      }
      const current = disposed ? 'unavailable' : !ctx.get('pluginManager') ? 'unavailable' : reason;
      const instructions: Record<UnavailableReason, string> = {
        starting: 'Official Forge is starting. Retry after it finishes loading.',
        disabled: 'Official Forge is not ready. Enable Forge and its Worktree components in Plugins, then retry.',
        'restart-required': 'Official Forge has been enabled. Restart DSH before creating a Worktree Session.',
        failed: 'Automatic Forge activation failed. Enable the official Forge bundle in Plugins, then retry.',
        unavailable: 'Official Forge is unavailable. Install or enable the official Forge bundle in Plugins.',
      };
      throw Object.assign(new NativeSessionCreationPreflightError(instructions[current]),
        createWorktreeError('WORKTREE_FORGE_UNAVAILABLE', instructions[current], { reason: current, diagnostic }));
    },
  };
}
