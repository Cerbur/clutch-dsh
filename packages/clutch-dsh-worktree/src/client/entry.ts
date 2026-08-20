import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { WorktreeManager } from '../contract/index.js';
import { createWorktreeManagerFacade, type WorktreeRemoteNamespace } from './index.js';
import { WorktreeModeAction } from './WorktreeModeAction.js';
import { WorktreeSurface } from './WorktreeSurface.js';
import { createWorktreeViewStore } from './view-mode-store.js';

export { WorktreeRemoteCallError, createWorktreeManagerFacade } from './index.js';
export type { DshRemoteFailure, DshRemoteResult, WorktreeRemoteNamespace } from './index.js';
export type { WorktreeViewActions, WorktreeViewMode, WorktreeViewState } from './view-mode.js';

const WORKTREE_REMOTE_METHODS = [
  'listWorktrees',
  'listBranches',
  'createWorktree',
  'removeWorktree',
  'listBindings',
  'bindSession',
] as const;

function isWorktreeRemoteNamespace(value: unknown): value is WorktreeRemoteNamespace {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return WORKTREE_REMOTE_METHODS.every((method) => typeof candidate[method] === 'function');
}

/** Resolve only an already-mounted Worktree namespace; never mount a contribution here. */
function mountedWorktreeManager(ctx: ClientContext): WorktreeManager | undefined {
  const remote = ctx.remote;
  const namespace =
    remote === undefined || typeof remote !== 'object' || remote === null
      ? undefined
      : (remote as { readonly worktreeManager?: unknown }).worktreeManager;
  return isWorktreeRemoteNamespace(namespace) ? createWorktreeManagerFacade(namespace) : undefined;
}

/** The Remote carrier is required; the Worktree namespace inside it remains optional for degraded fallback. */
export const inject = ['remote', 'slots', 'sessions', 'workspaces'];

/**
 * DSH Client entry. Slot declaration order is intentionally unconstrained, so
 * both additive registrations wait on the official shell declarations. The
 * same root-scoped store handle is shared by the footer action and overlay.
 */
export function apply(ctx: ClientContext): void {
  const viewStore = createWorktreeViewStore();

  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'clutch-dsh-worktree-mode-action',
        store: viewStore,
        inject: () => ({ available: mountedWorktreeManager(ctx) !== undefined }),
      },
      WorktreeModeAction,
    ),
  );

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'clutch-dsh-worktree-navigation',
        store: viewStore,
        inject: () => {
          const manager = mountedWorktreeManager(ctx);
          return {
            available: manager !== undefined,
            manager,
            openSession: (sessionId: string) => {
              ctx.sessions.open(sessionId as SessionId);
            },
          };
        },
      },
      WorktreeSurface,
    ),
  );
}
