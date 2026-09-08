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

type Input = {
  source: Pick<ReturnType<typeof useSurfaceSources>, 'workspaces' | 'sessionOrderSnapshot'>;
  props: Pick<
    WorktreeSurfaceProps,
    'insertWorkspaceBefore' | 'insertSessionBefore' | 'sessionOrder' | 'insertWorktreeBefore'
  >;
  mutation: Pick<ReturnType<typeof useSurfaceMutation>, 'setActionError'>;
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'refresh'>;
};

export function useDragActions({ source, props, mutation, read }: Input) {
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
    const targetIndex = sessionIds.indexOf(over.sessionId);
    const sourceIndex = sessionIds.indexOf(activeDrag.sessionId);
    if (targetIndex === -1 || sourceIndex === -1) return;
    const beforeSessionId = over.half === 'before' ? over.sessionId : sessionIds[targetIndex + 1];
    const anchorIndex =
      beforeSessionId === undefined ? sessionIds.length : sessionIds.indexOf(beforeSessionId);
    if (
      beforeSessionId === activeDrag.sessionId ||
      anchorIndex === sourceIndex ||
      anchorIndex === sourceIndex + 1
    ) {
      return;
    }
    if (insertSessionBefore === undefined) {
      setActionError({
        code: 'SESSION_ORDER_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setActionError(undefined);
    const currentOrder = sessionOrderSnapshot.accounts[activeDrag.groupKey]?.order ?? sessionIds;
    void insertSessionBefore(workspaceId, activeDrag.sessionId, beforeSessionId)
      .then(() => {
        sessionOrder.actions.setOrder(
          activeDrag.groupKey,
          reorderSessionIds(currentOrder, activeDrag.sessionId, over.sessionId, over.half),
        );
      })
      .catch((error) => {
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
