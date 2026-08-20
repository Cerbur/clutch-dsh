import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import { createWorktreeConnectionAdapter } from './worktree-connection.js';
import { WorktreeModeAction } from './WorktreeModeAction.js';
import { WorktreeSurface } from './WorktreeSurface.js';
import { createWorktreeViewStore } from './view-mode-store.js';

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionHandle;
  }
}

export {
  WORKTREE_CONNECTION_CHANNEL,
  WORKTREE_CONNECTION_ENDPOINTS,
  WorktreeConnectionError,
  createWorktreeConnectionAdapter,
} from './worktree-connection.js';
export type {
  WorktreeConnectionAdapter,
  WorktreeConnectionErrorOptions,
  WorktreeConnectionRpc,
} from './worktree-connection.js';
export type { WorktreeViewActions, WorktreeViewMode, WorktreeViewState } from './view-mode.js';

/** Required DSH Client services; Connection is the sole Worktree wire dependency. */
export const inject = ['connection', 'slots', 'sessions', 'workspaces'];

/**
 * DSH Client entry. The adapter is composed once per plugin fiber and is disposed
 * with that fiber, so slot consumers share one manager and one request lifetime.
 */
export function apply(ctx: ClientContext): void {
  const manager = createWorktreeConnectionAdapter(ctx.connection.rpc);
  ctx.effect(() => () => manager.dispose(), 'clutch-dsh-worktree: connection cleanup');
  const viewStore = createWorktreeViewStore();

  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'clutch-dsh-worktree-mode-action',
        store: viewStore,
        inject: () => ({ available: true }),
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
        inject: () => ({
          available: true,
          manager,
          openSession: (sessionId: string) => {
            ctx.sessions.open(sessionId as SessionId);
          },
        }),
      },
      WorktreeSurface,
    ),
  );
}
