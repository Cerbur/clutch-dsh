import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import { createWorktreeConnectionAdapter } from './worktree-connection.js';
import { WorktreeModeAction } from './WorktreeModeAction.js';
import { WorktreeSurface } from './WorktreeSurface.js';
import { createWorktreeViewStore } from './view-mode-store.js';
import {
  createVirtualWorkspaceMembership,
  type WritableWorkspaceList,
} from './virtual-workspace-membership.js';
import { createSessionForWorktree } from './worktree-view.js';
import type { VirtualWorkspaceBinding } from './view-mode.js';

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

/** rc.8 runtime exposes create(), while the published Client type omits it. */
interface WorktreeSessionCreator {
  create(input: { cwd: string }): Promise<SessionId>;
}

interface WorkspaceListSnapshot {
  readonly items: readonly {
    readonly workspaceId: string;
    readonly sessionIds: readonly string[];
  }[];
}

/** Required DSH Client services; Connection is the sole Worktree wire dependency. */
export const inject = ['connection', 'slots', 'sessions', 'workspaces'];

/**
 * DSH Client entry. The adapter is composed once per plugin fiber and is disposed
 * with that fiber, so slot consumers share one manager and one request lifetime.
 */
export function apply(ctx: ClientContext): void {
  const manager = createWorktreeConnectionAdapter(ctx.connection.rpc);
  const sessions = ctx.sessions as typeof ctx.sessions & WorktreeSessionCreator;
  const virtualWorkspaceMembership = createVirtualWorkspaceMembership(
    ctx.workspaces.list as unknown as WritableWorkspaceList<WorkspaceListSnapshot>,
  );
  ctx.effect(() => () => manager.dispose(), 'clutch-dsh-worktree: connection cleanup');
  ctx.effect(
    () => () => virtualWorkspaceMembership.dispose(),
    'clutch-dsh-worktree: Workspace membership cleanup',
  );
  const viewStore = createWorktreeViewStore();

  const ensureSessionWorkspace = (workspaceId: string, sessionId: string): void => {
    virtualWorkspaceMembership.ensure({ workspaceId, sessionId });
  };
  const syncSessionWorkspaces = (bindings: readonly VirtualWorkspaceBinding[]): void => {
    virtualWorkspaceMembership.sync(bindings);
  };

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
          createWorkspace: async () => {
            const workspacePath = await ctx.workspaces.pickDirectory();
            if (workspacePath !== null) await ctx.workspaces.create({ path: workspacePath });
          },
          createSessionForWorktree: (input) =>
            createSessionForWorktree({
              ...input,
              createSession: (sessionInput) => sessions.create(sessionInput),
              manager,
              beforeOpen: (sessionId) => {
                ensureSessionWorkspace(input.workspaceId, sessionId);
              },
              openSession: (sessionId) => {
                ctx.sessions.open(sessionId as SessionId);
              },
            }),
          createMainSession: (workspaceId: string) => {
            ctx.workspaces.startSession(
              workspaceId as Parameters<typeof ctx.workspaces.startSession>[0],
            );
          },
          ensureSessionWorkspace,
          syncSessionWorkspaces,
          openSession: (sessionId: string) => {
            ctx.sessions.open(sessionId as SessionId);
          },
        }),
      },
      WorktreeSurface,
    ),
  );
}
