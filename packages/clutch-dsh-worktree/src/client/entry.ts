import {
  createSnapshotStore,
  type ClientContext,
  type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type { WorktreeLocaleKey } from './locales.js';
import { WORKTREE_NS, en, zh } from './locales.js';
import { createWorktreeConnectionAdapter } from './worktree-connection.js';
import { WorktreeHeaderContext } from './WorktreeContext.js';
import { WorktreeModeAction } from './WorktreeModeAction.js';
import { WorktreeOverlay } from './WorktreeOverlay.js';
import { createWorktreeContextProjection } from './worktree-context-store.js';
import { createWorktreeExpandStateStore } from './worktree-expand-state.js';
import { createWorktreeSessionOrderStore } from './worktree-session-order.js';
import { createWorktreeViewStore } from './view-mode-store.js';
import {
  createVirtualWorkspaceMembership,
  type WritableWorkspaceList,
} from './virtual-workspace-membership.js';
import {
  createWorktreeSessionConnector,
  type WorktreeSessionSnapshotReader,
} from './worktree-session.js';
import {
  createWorktreeFullAccessConfirmationController,
} from './worktree-permission.js';
import { installWorktreePermissionIcon } from './worktree-permission-icon.js';
import type {
  WorktreePermissionResult,
} from '../contract/index.js';
import type {
  WorktreePermissionNotice,
} from './worktree-surface-types.js';
import type { VirtualWorkspaceBinding } from './view-mode.js';

declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionHandle;
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    worktree: WorktreeLocaleKey;
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

/** The current upstream runtime exposes create(), while the published Client type omits it. */
interface WorktreeSessionCreator {
  create(input: { cwd: string }): Promise<SessionId>;
}

interface WorkspaceListSnapshot {
  readonly items: readonly {
    readonly workspaceId: string;
    readonly path: string;
    readonly title: string;
    readonly sessionIds: readonly string[];
  }[];
  readonly recentWorkspaceId?: string;
  readonly archivedSessionIds?: readonly string[];
}

/** Required DSH Client services; Connection is the sole Worktree wire dependency. */
export const inject = ['connection', 'locale', 'slots', 'sessions', 'workspaces'];

/**
 * DSH Client entry. The adapter is composed once per plugin fiber and is disposed
 * with that fiber, so slot consumers share one manager and one request lifetime.
 */
export function apply(ctx: ClientContext): void {
  if (typeof document !== 'undefined') {
    ctx.effect(
      () => installWorktreePermissionIcon(document),
      'clutch-dsh-worktree: permission icon cleanup',
    );
  }
  ctx.effect(
    () => ctx.locale.register(WORKTREE_NS, { zh, en }),
    'clutch-dsh-worktree: locale dictionaries',
  );
  const manager = createWorktreeConnectionAdapter(ctx.connection.rpc);
  const fullAccessConfirmation = createWorktreeFullAccessConfirmationController();
  const permissionNotice = createSnapshotStore<WorktreePermissionNotice | undefined>(undefined);
  const permissionManager = typeof document !== 'undefined' ? manager : undefined;
  const reportPermissionNotice = (
    input: {
      readonly workspaceId: string;
      readonly worktreeId: string;
      readonly sessionId?: string;
    },
    result: WorktreePermissionResult,
  ): void => {
    const visible = result.status === 'fallback-workspace-write' ||
      result.status === 'user-restricted' ||
      result.status === 'unverified';
    permissionNotice.set(visible ? { ...input, result } : undefined);
  };
  const sessions = ctx.sessions as typeof ctx.sessions & WorktreeSessionCreator;
  const virtualWorkspaceMembership = createVirtualWorkspaceMembership(
    ctx.workspaces.list as unknown as WritableWorkspaceList<WorkspaceListSnapshot>,
  );
  const contextProjection = createWorktreeContextProjection({
    sessions: ctx.sessions.list,
    workspaces: ctx.workspaces.list,
    manager,
    storeFactory: createSnapshotStore,
  });
  ctx.effect(() => () => manager.dispose(), 'clutch-dsh-worktree: connection cleanup');
  ctx.effect(
    () => () => fullAccessConfirmation.dispose(),
    'clutch-dsh-worktree: Full Access confirmation cleanup',
  );
  ctx.effect(
    () => () => virtualWorkspaceMembership.dispose(),
    'clutch-dsh-worktree: Workspace membership cleanup',
  );
  ctx.effect(
    () => () => contextProjection.dispose(),
    'clutch-dsh-worktree: Session context cleanup',
  );
  void contextProjection.refresh();
  const viewStore = createWorktreeViewStore();
  const expandState = createWorktreeExpandStateStore(createSnapshotStore);
  const sessionOrder = createWorktreeSessionOrderStore(createSnapshotStore);
  ctx.effect(() => () => sessionOrder.dispose(), 'clutch-dsh-worktree: Session order cleanup');

  const ensureSessionWorkspace = (workspaceId: string, sessionId: string): void => {
    virtualWorkspaceMembership.ensure({ workspaceId, sessionId });
  };
  const syncSessionWorkspaces = (bindings: readonly VirtualWorkspaceBinding[]): void => {
    virtualWorkspaceMembership.sync(bindings);
  };
  const worktreeSessionConnector = createWorktreeSessionConnector({
    manager,
    sessions: ctx.sessions.list as unknown as WorktreeSessionSnapshotReader,
    archivedSessionIds: () =>
      (ctx.workspaces.list.getSnapshot() as unknown as WorkspaceListSnapshot).archivedSessionIds ??
      [],
    createSession: async (input) => String(await sessions.create(input)),
    ensureSessionWorkspace,
    permission: permissionManager,
    confirmFullAccess: permissionManager === undefined
      ? undefined
      : fullAccessConfirmation.request,
    onPermissionResult: reportPermissionNotice,
    openSession: (sessionId) => {
      ctx.sessions.open(sessionId as SessionId);
    },
  });
  ctx.effect(
    () => () => worktreeSessionConnector.dispose(),
    'clutch-dsh-worktree: Worktree Session connector cleanup',
  );

  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.actions',
        id: 'clutch-dsh-worktree-context-header',
        order: -5,
        locale: WORKTREE_NS,
        inject: () => ({ hooks: { worktreeContext: contextProjection.store } }),
      },
      WorktreeHeaderContext,
    ),
  );

  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'clutch-dsh-worktree-mode-action',
        store: viewStore,
        locale: WORKTREE_NS,
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
        locale: WORKTREE_NS,
        inject: () => ({
          available: true,
          expandState,
          sessionOrder,
          hooks: { worktreeContext: contextProjection.store },
          manager,
          permission: permissionManager,
          confirmFullAccess: permissionManager === undefined
            ? undefined
            : fullAccessConfirmation.request,
          fullAccessConfirmation: typeof document === 'undefined'
            ? undefined
            : fullAccessConfirmation,
          onPermissionResult: reportPermissionNotice,
          onPermissionNotice: reportPermissionNotice,
          permissionNotice,
          createWorkspace: async () => {
            const workspacePath = await ctx.workspaces.pickDirectory();
            if (workspacePath !== null) await ctx.workspaces.create({ path: workspacePath });
          },
          createSessionForWorktree: (input) => worktreeSessionConnector.create(input),
          invalidateWorktreeContext: (workspaceId?: string) =>
            contextProjection.invalidate(workspaceId),
          createMainSession: (workspaceId: string) => {
            ctx.workspaces.startSession(
              workspaceId as Parameters<typeof ctx.workspaces.startSession>[0],
            );
          },
          renameWorkspace: async (workspaceId: string, title: string) => {
            await ctx.workspaces.rename(
              workspaceId as Parameters<typeof ctx.workspaces.rename>[0],
              title,
            );
          },
          deleteWorkspace: async (workspaceId: string) => {
            await ctx.workspaces.delete(workspaceId as Parameters<typeof ctx.workspaces.delete>[0]);
          },
          insertWorkspaceBefore: async (workspaceId: string, beforeWorkspaceId?: string) => {
            await ctx.workspaces.insertBefore(
              workspaceId as Parameters<typeof ctx.workspaces.insertBefore>[0],
              beforeWorkspaceId as Parameters<typeof ctx.workspaces.insertBefore>[1],
            );
          },
          insertSessionBefore: async (
            workspaceId: string,
            sessionId: string,
            beforeSessionId?: string,
          ) => {
            await ctx.workspaces.insertSessionBefore(
              workspaceId as Parameters<typeof ctx.workspaces.insertSessionBefore>[0],
              sessionId as Parameters<typeof ctx.workspaces.insertSessionBefore>[1],
              beforeSessionId as Parameters<typeof ctx.workspaces.insertSessionBefore>[2],
            );
          },
          insertWorktreeBefore: (
            workspaceId: string,
            worktreeId: string,
            beforeWorktreeId?: string,
          ) =>
            manager.insertWorktreeBefore({
              workspaceId,
              worktreeId,
              beforeWorktreeId,
            }),
          renameSession: async (sessionId: string, title: string) => {
            const session = ctx.sessions.binding(sessionId as SessionId)?.session;
            if (session === undefined) throw new Error(`unknown session "${sessionId}"`);
            const result = await session.rename(title);
            if (!result.ok) throw new Error(result.error.message);
          },
          forkSession: (sessionId: string) => {
            void ctx.sessions
              .fork({
                sessionId: sessionId as SessionId,
                increaseTitle: true,
              })
              .then((childId) => {
                ctx.sessions.open(childId);
              })
              .catch(() => {
                // Fork failure leaves the current Session and Worktree projection unchanged.
              });
          },
          archiveSession: (sessionId: string) =>
            ctx.workspaces.archiveSession(
              sessionId as Parameters<typeof ctx.workspaces.archiveSession>[0],
            ),
          ensureSessionWorkspace,
          syncSessionWorkspaces,
          openSession: (sessionId: string) => {
            ctx.sessions.open(sessionId as SessionId);
          },
        }),
      },
      WorktreeOverlay,
    ),
  );
}
