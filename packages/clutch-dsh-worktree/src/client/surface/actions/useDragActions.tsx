import { useRef, useState } from 'react';
import { reorderSessionIds } from '../../session/worktree-session-order.js';
import {
  resolveWorktreeMove,
  toRetryableWorktreeOrderError,
  toWorktreeViewError,
} from '../../view/worktree-view.js';
import type {
  SessionDragState,
  WorkspaceDragState,
  WorktreeDragState,
  WorktreeSurfaceProps,
} from '../types.js';
import type { useSurfaceMutation } from './useSurfaceMutation.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';

export interface SessionOrderCommitInput {
  readonly groupKey: string;
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly beforeSessionId?: string;
  readonly nextOrder: readonly string[];
  readonly insertSessionBefore?: WorktreeSurfaceProps['insertSessionBefore'];
  readonly setOrder: (groupKey: string, order: readonly string[]) => void;
}

/**
 * Persist one visual Session move without crossing the Worktree membership boundary.
 * Worktree Sessions are plugin-local projections, while Main Sessions remain native DSH members.
 */
export async function commitSessionOrder(input: SessionOrderCommitInput): Promise<void> {
  if (input.groupKey.startsWith('worktree:')) {
    input.setOrder(input.groupKey, input.nextOrder);
    return;
  }
  if (input.insertSessionBefore === undefined) {
    throw new Error('Native Session ordering is unavailable');
  }
  await input.insertSessionBefore(
    input.workspaceId,
    input.sessionId,
    input.beforeSessionId,
  );
  input.setOrder(input.groupKey, input.nextOrder);
}

export interface SessionDragOrderInput {
  readonly visibleSessionIds: readonly string[];
  readonly currentOrder: readonly string[];
  readonly sessionId: string;
  readonly over: {
    readonly sessionId: string;
    readonly half: 'before' | 'after';
  };
}

export interface SessionDragOrderResult {
  readonly beforeSessionId?: string;
  readonly nextOrder: string[];
}

/** Resolve a visual drop against the full account order, retaining filtered IDs. */
export function resolveSessionDragOrder(
  input: SessionDragOrderInput,
): SessionDragOrderResult | undefined {
  const targetIndex = input.visibleSessionIds.indexOf(input.over.sessionId);
  const sourceIndex = input.visibleSessionIds.indexOf(input.sessionId);
  if (targetIndex === -1 || sourceIndex === -1) return undefined;

  const currentOrder = [...input.currentOrder];
  const knownIds = new Set(currentOrder);
  for (const id of input.visibleSessionIds) {
    if (!knownIds.has(id)) {
      knownIds.add(id);
      currentOrder.push(id);
    }
  }
  const nextOrder = reorderSessionIds(
    currentOrder,
    input.sessionId,
    input.over.sessionId,
    input.over.half,
  );
  if (
    nextOrder.length === currentOrder.length &&
    nextOrder.every((id, index) => id === currentOrder[index])
  ) {
    return undefined;
  }
  const nextIndex = nextOrder.indexOf(input.sessionId);
  if (nextIndex === -1) return undefined;
  return {
    beforeSessionId: nextOrder[nextIndex + 1],
    nextOrder,
  };
}

type Input = {
  source: Pick<ReturnType<typeof useSurfaceSources>, 'workspaces' | 'sessionOrderSnapshot'>;
  orderedSessionIdsByAccount: ReadonlyMap<string, readonly string[]>;
  props: Pick<
    WorktreeSurfaceProps,
    'insertWorkspaceBefore' | 'insertSessionBefore' | 'sessionOrder' | 'insertWorktreeBefore'
  >;
  mutation: Pick<ReturnType<typeof useSurfaceMutation>, 'setActionError'>;
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'refresh'>;
};

export function useDragActions({
  source,
  orderedSessionIdsByAccount,
  props,
  mutation,
  read,
}: Input) {
  const { workspaces, sessionOrderSnapshot } = source;
  const { insertWorkspaceBefore, insertSessionBefore, sessionOrder, insertWorktreeBefore } = props;
  const { setActionError } = mutation;
  const { refresh } = read;
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragState>();
  const workspaceDropCommitted = useRef(false);
  const [sessionDrag, setSessionDrag] = useState<SessionDragState>();
  const sessionDropCommitted = useRef(false);
  const [worktreeDrag, setWorktreeDrag] = useState<WorktreeDragState>();
  const worktreeDropCommitted = useRef(false);
  const commitWorkspaceDrag = (
    activeDrag: WorkspaceDragState,
    over: NonNullable<WorkspaceDragState['over']>,
  ): void => {
    if (workspaceDropCommitted.current) return;
    workspaceDropCommitted.current = true;
    setWorkspaceDrag(undefined);
    const rows = workspaces.items;
    const targetIndex = rows.findIndex((workspace) => workspace.workspaceId === over.workspaceId);
    const sourceIndex = rows.findIndex(
      (workspace) => workspace.workspaceId === activeDrag.workspaceId,
    );
    if (targetIndex === -1 || sourceIndex === -1) return;
    const beforeWorkspaceId =
      over.half === 'before' ? over.workspaceId : rows[targetIndex + 1]?.workspaceId;
    const anchorIndex =
      beforeWorkspaceId === undefined
        ? rows.length
        : rows.findIndex((workspace) => workspace.workspaceId === beforeWorkspaceId);
    if (
      beforeWorkspaceId === activeDrag.workspaceId ||
      anchorIndex === sourceIndex ||
      anchorIndex === sourceIndex + 1
    ) {
      return;
    }
    if (insertWorkspaceBefore === undefined) {
      setActionError({
        code: 'WORKSPACE_ORDER_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setActionError(undefined);
    void insertWorkspaceBefore(activeDrag.workspaceId, beforeWorkspaceId).catch((error) => {
      setActionError(toWorktreeViewError(error));
    });
  };
  const commitSessionDrag = (
    activeDrag: SessionDragState,
    over: NonNullable<SessionDragState['over']>,
    sessionIds: readonly string[],
    workspaceId: string,
  ): void => {
    if (sessionDropCommitted.current) return;
    sessionDropCommitted.current = true;
    setSessionDrag(undefined);
    const currentOrder =
      orderedSessionIdsByAccount.get(activeDrag.groupKey) ??
      sessionOrderSnapshot.accounts[activeDrag.groupKey]?.order ??
      sessionIds;
    const move = resolveSessionDragOrder({
      visibleSessionIds: sessionIds,
      currentOrder,
      sessionId: activeDrag.sessionId,
      over,
    });
    if (move === undefined) return;
    const isWorktreeSession = activeDrag.groupKey.startsWith('worktree:');
    if (!isWorktreeSession && insertSessionBefore === undefined) {
      setActionError({
        code: 'SESSION_ORDER_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setActionError(undefined);
    void commitSessionOrder({
      groupKey: activeDrag.groupKey,
      workspaceId,
      sessionId: activeDrag.sessionId,
      beforeSessionId: move.beforeSessionId,
      nextOrder: move.nextOrder,
      insertSessionBefore,
      setOrder: sessionOrder.actions.setOrder,
    }).catch((error) => {
      setActionError(toWorktreeViewError(error));
    });
  };
  const commitWorktreeDrag = (
    activeDrag: WorktreeDragState,
    over: NonNullable<WorktreeDragState['over']>,
    worktreeIds: readonly string[],
    workspaceId: string,
  ): void => {
    if (worktreeDropCommitted.current) return;
    worktreeDropCommitted.current = true;
    setWorktreeDrag(undefined);
    if (activeDrag.workspaceId !== workspaceId) return;
    const move = resolveWorktreeMove(
      worktreeIds,
      activeDrag.worktreeId,
      over.worktreeId,
      over.half,
    );
    if (move === undefined) return;
    if (insertWorktreeBefore === undefined) {
      setActionError({
        code: 'WORKTREE_ORDER_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setActionError(undefined);
    void insertWorktreeBefore(workspaceId, activeDrag.worktreeId, move.beforeWorktreeId)
      .then(() =>
        refresh({
          scope: { kind: 'workspace', workspaceId },
          preserveCurrent: true,
          invalidateContext: false,
        }),
      )
      .catch((error) => {
        setActionError(toRetryableWorktreeOrderError(error));
      });
  };
  return {
    workspaceDrag,
    setWorkspaceDrag,
    workspaceDropCommitted,
    sessionDrag,
    setSessionDrag,
    sessionDropCommitted,
    worktreeDrag,
    setWorktreeDrag,
    worktreeDropCommitted,
    commitWorkspaceDrag,
    commitSessionDrag,
    commitWorktreeDrag,
  };
}
