import type { Context } from '@deepseek-ai/cordis';
import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorktreeError } from '../contract/index.js';
import { NativeSessionCreationPreflightError, type ForgeSessionGate } from './native-session.js';

export const FORGE_BUNDLE = '@deepseek-ai/dsh-experimental-forge-bundle';

interface Bundle {
  name: string;
  enabled: boolean;
  availability: string;
  error?: { code: string };
  readOnlyReason?: string;
  rows: readonly { rowId: string; moduleName: string; entryId?: string }[];
}
interface PluginEntry { entryId: string; moduleName: string; enabled: boolean; fiberPhase: string | null }
interface PluginManager {
  listBundles(): Promise<readonly Bundle[]>;
  listPlugins(): Promise<readonly PluginEntry[]>;
  setBundleEnabled(name: string, enabled: boolean): Promise<{
    application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled';
    error?: { code: string };
  }>;
}
type UnavailableReason = 'starting' | 'disabled' | 'restart-required' | 'failed' | 'unavailable';
type Selection = 'applied' | Bundle | 'blocked';

const readBundle = async (manager: PluginManager) => (await manager.listBundles()).find(item => item.name === FORGE_BUNDLE);
const readinessTimeout = 15_000;

async function hasLiveForgeRows(manager: PluginManager, bundle: Bundle | undefined): Promise<boolean> {
  if (!bundle?.enabled || bundle.error || bundle.availability === 'missing') return false;
  // RC.1+ shares `worktree` between the panel and tool. If the bundle still
  // declares an isolated panel backend, a live global one must not mask it.
  const backend = bundle.rows.some(row => row.rowId === 'forge-worktree') ? 'forge-worktree' : 'worktree';
  const plugins = await manager.listPlugins();
  const active = (id: string, moduleName: string) => {
    const row = bundle.rows.find(row => row.rowId === id && row.moduleName === moduleName);
    return !!row?.entryId && plugins.some(entry => entry.entryId === row.entryId &&
      entry.moduleName === moduleName && entry.enabled && entry.fiberPhase === 'active');
  };
  return active('forge-panel', '@deepseek-ai/dsh-experimental-client-ui-forge') &&
    active(backend, '@deepseek-ai/dsh-experimental-worktree');
}

/** This preference is per profile, not a Workspace relationship or Session fact. */
async function claimActivation(dshHome: string, profile: string): Promise<boolean> {
  const key = createHash('sha256').update(profile).digest('hex');
  const filename = path.join(dshHome, 'clutch-dsh-worktree', 'forge-activation', key + '.json');
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = filename + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify({ version: 1, bundle: FORGE_BUNDLE }) + '\n');
      await handle.sync();
    } finally { await handle.close(); }
    try {
      await link(temporary, filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const saved = JSON.parse(await readFile(filename, 'utf8')) as { version?: unknown; bundle?: unknown };
      if (saved.version !== 1 || saved.bundle !== FORGE_BUNDLE) throw new Error('Invalid Forge activation preference', { cause: error });
      return false;
    }
    return true;
  } finally { await unlink(temporary); }
}

function unavailable(reason: UnavailableReason, diagnostic = '') {
  const instructions: Record<UnavailableReason, string> = {
    starting: 'Official Forge is starting. Retry after it finishes loading.',
    disabled: 'Official Forge is not ready. Enable Forge and its Worktree components in Plugins, then retry.',
    'restart-required': 'Official Forge has been enabled. Restart DSH before creating a Worktree Session.',
    failed: 'Automatic Forge activation failed. Check the official Forge bundle in Plugins, then retry.',
    unavailable: 'Official Forge is unavailable. Install or enable the official Forge bundle in Plugins.',
  };
  return Object.assign(new NativeSessionCreationPreflightError(instructions[reason]),
    createWorktreeError('WORKTREE_FORGE_UNAVAILABLE', instructions[reason], { reason, diagnostic }));
}

function describe(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 300); }

// A caller can leave an uninterruptible DSH profile RPC without cancelling another caller's wait.
async function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([pending, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

/** Bootstrap is once per profile; only an actual new Session request may re-enable Forge later. */
export function registerForgeActivation(ctx: Context, dshHome: string): ForgeSessionGate {
  let reason: UnavailableReason = 'starting';
  let diagnostic = '';
  let disposed = false;
  let assertReady: ForgeSessionGate['assertReady'] | undefined;
  let ensureForCreation: ForgeSessionGate['ensureForCreation'] | undefined;
  ctx.effect(() => () => { disposed = true; }, 'clutch-dsh-worktree: Forge activation observer');

  ctx.inject(['pluginManager'], (managerCtx) => {
    const lifetime = new AbortController();
    const active = () => !disposed && !lifetime.signal.aborted;
    const manager = managerCtx.get('pluginManager') as PluginManager;
    const demand = new Set<AbortSignal>();
    let claimed = false;
    let pendingClaim: Promise<boolean> | undefined;
    let selection: Promise<Selection> | undefined;
    let warmingUntil = 0;
    let inventory: Promise<boolean> | undefined;
    function liveInventory(selected?: Bundle): Promise<boolean> {
      if (inventory) return inventory;
      const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(readinessTimeout)]);
      const read = selected ? hasLiveForgeRows(manager, selected) : readBundle(manager).then(bundle => {
        signal.throwIfAborted();
        return hasLiveForgeRows(manager, bundle);
      });
      return inventory = waitFor(read, signal).finally(() => { inventory = undefined; });
    }
    reason = 'starting';
    diagnostic = '';
    // Do not await HMR/profile mutation from plugin initialization: reconciliation
    // can dispose/reload this very plugin while holding the profile lock.
    async function selectBundle(): Promise<Selection> {
      const profile = ctx.get('profileContext') as { dir?: string } | undefined;
      if (!profile?.dir || !path.isAbsolute(profile.dir)) { reason = 'unavailable'; return 'blocked'; }
      // Retire a stalled inventory read before claiming the profile or changing its selection.
      const readSignal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(readinessTimeout)]);
      const bundle = await waitFor(readBundle(manager), readSignal);
      if (!active()) return 'blocked';
      const first = !claimed && await (pendingClaim = claimActivation(dshHome, profile.dir));
      claimed = true;
      if (!active()) return 'blocked';
      diagnostic = '';
      if (!bundle || bundle.availability === 'missing' || bundle.error) {
        reason = 'unavailable';
        diagnostic = bundle?.error?.code ?? 'official-bundle-unavailable';
        return 'blocked';
      }
      if (bundle.enabled) {
        if (reason !== 'restart-required') reason = 'disabled';
        return bundle;
      }
      if (bundle.readOnlyReason || (!first && ![...demand].some(signal => !signal.aborted))) {
        reason = 'disabled'; return 'blocked';
      }
      const result = await manager.setBundleEnabled(FORGE_BUNDLE, true);
      if (!active()) return 'blocked';
      reason = result.application === 'restart-required' ? 'restart-required'
        : result.application === 'applied' || result.application === 'overridden' ? 'disabled' : 'failed';
      diagnostic = result.error?.code ?? '';
      warmingUntil = result.application === 'applied' ? Date.now() + readinessTimeout : 0;
      return result.application === 'applied' ? 'applied' : 'blocked';
    }
    const select = () => selection ??= selectBundle().catch((error: unknown) => {
      if (active()) { reason = 'failed'; diagnostic = describe(error); }
      return 'blocked' as const;
    }).finally(() => { selection = undefined; });
    const timer = setTimeout(() => { if (active() && !claimed) void select(); }, 0);

    assertReady = async (caller) => {
      const signal = caller ? AbortSignal.any([lifetime.signal, caller]) : lifetime.signal;
      try {
        signal.throwIfAborted();
        const live = await waitFor(liveInventory(), signal);
        signal.throwIfAborted();
        if (live && active() && ctx.get('forgePanel')) return;
      } catch (error) {
        if (!active()) throw unavailable('unavailable');
        caller?.throwIfAborted();
        if (error instanceof Error && error.name === 'TimeoutError') throw unavailable('starting', 'Forge readiness check timed out');
        throw unavailable('failed', describe(error));
      }
      throw unavailable(reason, diagnostic);
    };

    ensureForCreation = async (caller) => {
      const deadline = AbortSignal.timeout(readinessTimeout);
      const signal = AbortSignal.any([lifetime.signal, deadline, ...(caller ? [caller] : [])]);
      demand.add(signal);
      try {
        signal.throwIfAborted();
        // A live installation needs no profile claim or mutation permission.
        if (await waitFor(liveInventory(), signal) && active() && !signal.aborted && ctx.get('forgePanel')) {
          warmingUntil = 0;
          return;
        }
        signal.throwIfAborted();
        const result = await waitFor(select(), signal);
        if (result === 'blocked') throw unavailable(reason, diagnostic);
        let selected = result === 'applied' ? undefined : result;
        do {
          signal.throwIfAborted();
          if (await waitFor(liveInventory(selected), signal) && active() && !signal.aborted && ctx.get('forgePanel')) {
            warmingUntil = 0;
            return;
          }
          selected = undefined;
          if (Date.now() >= warmingUntil) throw unavailable(reason, diagnostic);
          // HMR can acknowledge the selection before the official services are live.
          await delay(100, undefined, { signal });
        } while (active());
        throw unavailable('unavailable');
      } catch (error) {
        if (!active()) throw unavailable('unavailable');
        if (caller?.aborted) throw new NativeSessionCreationPreflightError('Worktree Session creation cancelled before native creation');
        if (deadline.aborted) throw unavailable('starting', 'Forge creation preflight timed out');
        if (error instanceof NativeSessionCreationPreflightError) throw error;
        throw unavailable('failed', describe(error));
      } finally { demand.delete(signal); }
    };
    managerCtx.effect(() => async () => {
      lifetime.abort();
      ensureForCreation = undefined;
      assertReady = undefined;
      clearTimeout(timer);
      // Finish only our local publication. Profile RPCs may be waiting for this disposal.
      await pendingClaim?.catch(() => undefined);
    }, 'clutch-dsh-worktree: deferred Forge activation');
  });

  return {
    ensureForCreation: (signal) => ensureForCreation?.(signal) ?? Promise.reject(unavailable('unavailable')),
    assertReady: (signal) => assertReady?.(signal) ?? Promise.reject(unavailable('unavailable')),
  };
}
