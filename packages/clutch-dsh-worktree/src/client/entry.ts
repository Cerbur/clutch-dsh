import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type {
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client';
import type {
  WorkspaceSnapshot,
} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
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
import { createWorktreeViewReader } from './worktree-view-read.js';
import {
  createVirtualWorkspaceMembership,
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
  SessionBinding,
  WorktreePermissionResult,
} from '../contract/index.js';
import type {
  WorktreePermissionNotice,
} from './worktree-surface-types.js';
import type { WorktreeSlotRegistry } from './dsh-slot-contract.js';
import type {} from './dsh-slot-contract.js';
import {
  createWorktreeSessionForkCoordinator,
  type WorktreeForkInput,
  type WorktreeForkBindingIndex,
  type WorktreeForkBindingLookupResult,
  type WorktreeForkSessionListReader,
} from './worktree-session-fork.js';
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

type WorkspaceListSnapshot = Pick<WorkspaceSnapshot, 'items'>;
type SessionLineageSnapshot = Pick<SessionListState, 'ids' | 'byId'>;

interface ForkableSessions {
  fork?: (input: WorktreeForkInput) => Promise<string>;
}

function forkRelatedSessionIds(
  snapshot: SessionLineageSnapshot,
): ReadonlySet<string> | undefined {
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    !Array.isArray(snapshot.ids) ||
    typeof snapshot.byId !== 'object' ||
    snapshot.byId === null ||
    Array.isArray(snapshot.byId)
  ) {
    return undefined;
  }
  const related = new Set<string>();
  for (const childSessionId of snapshot.ids) {
    if (typeof childSessionId !== 'string') return undefined;
    const summary = snapshot.byId[childSessionId];
    if (
      summary !== undefined &&
      (typeof summary !== 'object' || summary === null || Array.isArray(summary))
    ) {
      return undefined;
    }
    const parentSessionId = summary?.parentId;
    if (
      parentSessionId === undefined ||
      parentSessionId === childSessionId ||
      summary?.blank === true ||
      summary?.origin === 'subagent' ||
      snapshot.byId[parentSessionId] === undefined
    ) {
      continue;
    }
    related.add(childSessionId);
    related.add(parentSessionId);
  }
  return related;
}

function workspaceMembershipSignature(
  snapshot: WorkspaceListSnapshot,
  sessions: SessionLineageSnapshot,
): string | undefined {
  const relatedSessionIds = forkRelatedSessionIds(sessions);
  if (relatedSessionIds === undefined) return undefined;
  if (typeof snapshot !== 'object' || snapshot === null || !Array.isArray(snapshot.items)) {
    return undefined;
  }
  const facts: Array<readonly [string, readonly string[]]> = [];
  for (const workspace of snapshot.items) {
    if (
      typeof workspace !== 'object' ||
      workspace === null ||
      typeof workspace.workspaceId !== 'string' ||
      !Array.isArray(workspace.sessionIds) ||
      workspace.sessionIds.some((sessionId: string) => typeof sessionId !== 'string')
    ) {
      return undefined;
    }
    facts.push([
      workspace.workspaceId,
      workspace.sessionIds.filter((sessionId: string) => relatedSessionIds.has(sessionId)).sort(),
    ]);
  }
  // This signature tracks membership, not presentation order.
  facts.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return JSON.stringify(facts);
}

/** Required DSH Client services; Connection is the sole Worktree wire dependency. */
export const inject = ['connection', 'locale', 'slots', 'sessions', 'workspaces', 'uiWorkspace'];

/**
 * DSH Client entry. The adapter is composed once per plugin fiber and is disposed
 * with that fiber, so slot consumers share one manager and one request lifetime.
 */
export function apply(ctx: Context): void {
  const locale = ctx.locale as unknown as {
    register(
      namespace: typeof WORKTREE_NS,
      dictionaries: { readonly zh: typeof zh; readonly en: typeof en },
    ): () => void;
  };
  if (typeof document !== 'undefined') {
    ctx.effect(
      () => installWorktreePermissionIcon(document),
      'clutch-dsh-worktree: permission icon cleanup',
    );
  }
  ctx.effect(
    () => locale.register(WORKTREE_NS, { zh, en }),
    'clutch-dsh-worktree: locale dictionaries',
  );
  const manager = createWorktreeConnectionAdapter(ctx.connection.rpc);
  const viewReader = createWorktreeViewReader(manager);
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
  const sessions = ctx.sessions;
  const slots = ctx.slots as unknown as WorktreeSlotRegistry;
  const virtualWorkspaceMembership = createVirtualWorkspaceMembership(ctx.workspaces.list);
  const contextProjection = createWorktreeContextProjection({
    sessions: ctx.sessions.list,
    workspaces: ctx.workspaces.list,
    viewReader,
    storeFactory: createSnapshotStore,
  });
  ctx.effect(() => () => manager.dispose(), 'clutch-dsh-worktree: connection cleanup');
  ctx.effect(() => () => viewReader.dispose(), 'clutch-dsh-worktree: view reader cleanup');
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

  const forkableSessions = ctx.sessions as unknown as ForkableSessions;
  const nativeFork = forkableSessions.fork;
  const workspaceBindingReads = new Map<
    string,
    Promise<readonly SessionBinding[]>
  >();
  const readWorkspaceBindings = (workspaceId: string): Promise<readonly SessionBinding[]> => {
    const current = workspaceBindingReads.get(workspaceId);
    if (current !== undefined) return current;
    const promise = manager.listBindings({ workspaceId }).finally(() => {
      if (workspaceBindingReads.get(workspaceId) === promise) {
        workspaceBindingReads.delete(workspaceId);
      }
    });
    workspaceBindingReads.set(workspaceId, promise);
    return promise;
  };
  const findWorktreeSessionBindings = async (
    sessionIds: readonly string[],
  ): Promise<WorktreeForkBindingIndex> => {
    const requested = [...new Set(sessionIds)];
    const requestedSet = new Set(requested);
    const workspaces = ctx.workspaces.list.getSnapshot().items;
    const workspaceIds = [
      ...new Set<string>(workspaces.map((workspace) => workspace.workspaceId)),
    ];
    const owners = new Map<string, string[]>();
    for (const workspace of workspaces) {
      for (const sessionId of workspace.sessionIds) {
        if (!requestedSet.has(sessionId)) continue;
        const workspaceOwners = owners.get(sessionId) ?? [];
        if (!workspaceOwners.includes(workspace.workspaceId)) {
          workspaceOwners.push(workspace.workspaceId);
          owners.set(sessionId, workspaceOwners);
        }
      }
    }
    const unknownScope = requested.some((sessionId) => (owners.get(sessionId)?.length ?? 0) === 0);
    const selectedWorkspaceIds = unknownScope
      ? workspaceIds
      : workspaceIds.filter((workspaceId) =>
          requested.some((sessionId) => owners.get(sessionId)?.includes(workspaceId) === true),
        );
    const results = await Promise.allSettled(
      selectedWorkspaceIds.map((workspaceId) => readWorkspaceBindings(workspaceId)),
    );
    const resultByWorkspaceId = new Map(
      selectedWorkspaceIds.map((workspaceId, index) => [workspaceId, results[index]]),
    );
    const bySessionId = new Map<string, WorktreeForkBindingLookupResult>();
    for (const sessionId of requested) {
      const relevantWorkspaceIds = owners.get(sessionId) ?? selectedWorkspaceIds;
      let found: SessionBinding | undefined;
      let failed: unknown;
      for (const workspaceId of relevantWorkspaceIds) {
        const result = resultByWorkspaceId.get(workspaceId);
        if (result === undefined) continue;
        if (result.status === 'rejected') {
          failed ??= result.reason;
          continue;
        }
        const binding = result.value.find(
          (candidate) => candidate.sessionId === sessionId && candidate.status === 'active',
        );
        if (binding !== undefined) {
          found = binding;
          break;
        }
      }
      bySessionId.set(
        sessionId,
        found === undefined
          ? failed === undefined ? { status: 'missing' } : { status: 'error', error: failed }
          : { status: 'found', binding: found },
      );
    }
    return { bySessionId };
  };
  const forkCoordinator = typeof nativeFork !== 'function'
    ? undefined
    : createWorktreeSessionForkCoordinator({
        fork: (input) => nativeFork.call(ctx.sessions, input),
        findBindings: findWorktreeSessionBindings,
        bindSession: (input) => manager.bindSession(input),
        sessions: ctx.sessions.list as unknown as WorktreeForkSessionListReader,
      });
  if (forkCoordinator !== undefined) {
    forkableSessions.fork = (input) => forkCoordinator.fork(input);
    const reconcileForkChildren = (): void => {
      void forkCoordinator.reconcile();
    };
    let lastWorkspaceMembershipSignature = workspaceMembershipSignature(
      ctx.workspaces.list.getSnapshot(),
      ctx.sessions.list.getSnapshot(),
    );
    const reconcileForkChildrenForWorkspace = (): void => {
      const nextSignature = workspaceMembershipSignature(
        ctx.workspaces.list.getSnapshot(),
        ctx.sessions.list.getSnapshot(),
      );
      const changed =
        nextSignature !== undefined && nextSignature !== lastWorkspaceMembershipSignature;
      if (nextSignature !== undefined) lastWorkspaceMembershipSignature = nextSignature;
      void forkCoordinator.reconcile({ force: changed });
    };
    const unsubscribeSessionList = ctx.sessions.list.subscribe(reconcileForkChildren);
    const unsubscribeWorkspaceList = ctx.workspaces.list.subscribe(reconcileForkChildrenForWorkspace);
    ctx.effect(
      () => () => {
        unsubscribeSessionList();
        unsubscribeWorkspaceList();
        forkCoordinator.dispose();
        forkableSessions.fork = nativeFork;
      },
      'clutch-dsh-worktree: Session fork cleanup',
    );
    void forkCoordinator.reconcile();
  }
  const worktreeSessionConnector = createWorktreeSessionConnector({
    manager,
    sessions: ctx.sessions.list as unknown as WorktreeSessionSnapshotReader,
    archivedSessionIds: () => ctx.workspaces.list.getSnapshot().archivedSessionIds,
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

  slots.inject('conversation.session.header.actions', () =>
    slots.register(
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

  slots.inject('sidebar.footer.action', () =>
    slots.register(
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

  slots.inject('shell.overlay', () =>
    slots.register(
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
          viewReader,
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
            const workspacePath = await ctx.uiWorkspace.pickDirectory();
            if (workspacePath !== null) await ctx.workspaces.create({ path: workspacePath });
          },
          createSessionForWorktree: (input) => worktreeSessionConnector.create(input),
          invalidateWorktreeContext: (workspaceId?: string) =>
            contextProjection.invalidate(workspaceId),
          createMainSession: (workspaceId: string) => {
            ctx.uiWorkspace.startSession(workspaceId as WorkspaceId);
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
            if (forkableSessions.fork === undefined) return;
            void ctx.sessions.fork({
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
          forkRecovery: forkCoordinator?.recovery,
          retryForkSession: forkCoordinator === undefined
            ? undefined
            : async (key: string) => {
                await forkCoordinator.retry(key);
              },
          openSession: (sessionId: string) => {
            ctx.sessions.open(sessionId as SessionId);
          },
        }),
      },
      WorktreeOverlay,
    ),
  );
}
