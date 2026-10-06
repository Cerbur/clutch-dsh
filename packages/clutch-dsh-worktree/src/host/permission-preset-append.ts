import { Inject, resolveConfig, type Context, type Fiber } from '@deepseek-ai/cordis';
import { WORKTREE_FULL_ACCESS_PRESET } from '../contract/index.js';

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Startup gate for the lifecycle-owned permission config contribution. */
    clutchWorktreePermissionPresets: boolean;
  }
}

interface PermissionFiber extends Fiber {
  readonly entry?: {
    readonly options: {
      readonly id?: string;
      readonly name?: string;
      readonly config?: unknown;
      readonly inject?: Inject;
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Append one preset before the native permission service validates its config.
 * The bundle gates that entry on this contribution, so the hook is installed
 * before its first activation and is removed with the plugin. The raw Loader
 * config and the native runtime catalog (including Auto review) remain owned by DSH.
 */
export function apply(ctx: Context): void {
  let permissionFiber: PermissionFiber | undefined;
  // Registered first, so it runs after the hook and startup gate are removed.
  // Removing the bundle may remount the native entry before removing this row;
  // re-resolve that still-live fiber from its untouched raw config in that case.
  ctx.effect(() => async () => {
    if (
      ctx.root.fiber.uid === null ||
      !permissionFiber ||
      permissionFiber.uid === null ||
      !permissionFiber.entry
    ) return;
    // HMR still needs the gate until the replacement contributor activates.
    if (Object.hasOwn(Inject.resolve(permissionFiber.entry.options.inject), 'clutchWorktreePermissionPresets')) return;
    // Older Loaders merge changed injections into the live fiber. Remove only
    // our withdrawn gate before reactivating the unchanged native configuration.
    delete permissionFiber.inject.clutchWorktreePermissionPresets;
    await permissionFiber.update(permissionFiber.entry.options.config, true);
    await permissionFiber.await();
  });
  ctx.on('internal/config', function (this: Fiber, _config, next) {
    const raw: unknown = next();
    const entry = (this as PermissionFiber).entry;
    if (
      entry?.options.id !== 'permission' ||
      entry.options.name !== '@deepseek-ai/dsh-permission-presets' ||
      (this.parent.fiber as PermissionFiber | undefined)?.entry === entry ||
      this.runtime === null
    ) return raw;
    permissionFiber = this as PermissionFiber;

    // Obtain schema defaults from the native plugin instead of copying its
    // built-in table. Keep all other raw fields, including volatile settings.
    const resolved: unknown = resolveConfig(this.runtime, raw);
    if (!isRecord(resolved) || !isRecord(resolved.presets)) return raw;
    if (Object.hasOwn(resolved.presets, WORKTREE_FULL_ACCESS_PRESET)) return raw;
    return {
      ...(isRecord(raw) ? raw : {}),
      presets: {
        ...resolved.presets,
        [WORKTREE_FULL_ACCESS_PRESET]: {
          sandbox: 'danger-full-access',
          approval: 'ask',
          name: 'Worktree Full Access',
          description: 'Full file access for Worktree metadata while keeping approval prompts enabled.',
        },
      },
    };
  }, { global: true, prepend: true });
  ctx.provide('clutchWorktreePermissionPresets', true);
}
