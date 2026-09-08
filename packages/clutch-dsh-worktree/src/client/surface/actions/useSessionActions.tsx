import { useState } from 'react';
import { openWorktreeSession } from '../../view/navigation.js';
import { retryWorktreeSessionBinding } from '../../session/worktree-session.js';
import {
  toWorktreeViewError,
  WorktreeSessionBindingError,
  WorktreeSessionPermissionError,
  type CreateSessionForWorktreeInput,
} from '../../view/worktree-view.js';
import { toNativeWorktreeViewError } from '../shared.js';
import type { PendingSessionBinding, WorktreeSurfaceProps } from '../types.js';
import type { useSurfaceMutation } from './useSurfaceMutation.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';

type Input = {
  source: Pick<ReturnType<typeof useSurfaceSources>, 'archivedSessionIds'>;
  props: Pick<
    WorktreeSurfaceProps,
    | 'createSessionForWorktree'
    | 'manager'
    | 'ensureSessionWorkspace'
    | 'permission'
    | 'confirmFullAccess'
    | 'onPermissionResult'
    | 'openSession'
    | 'retryForkSession'
  >;
  mutation: Pick<ReturnType<typeof useSurfaceMutation>, 'setActionError' | 'setActionPending'>;
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'refresh'>;
};

export function useSessionActions({ source, props, mutation, read }: Input) {
  const { archivedSessionIds } = source;
  const {
    createSessionForWorktree: createSessionCallback,
    manager,
    ensureSessionWorkspace,
    permission,
    confirmFullAccess,
    onPermissionResult,
    openSession,
    retryForkSession,
  } = props;
  const { setActionError, setActionPending } = mutation;
  const { refresh } = read;
  const [pendingSessionBinding, setPendingSessionBinding] = useState<PendingSessionBinding>();
  const [forkRetryKey, setForkRetryKey] = useState<string>();
  const pendingSessionArchived =
    pendingSessionBinding !== undefined &&
    archivedSessionIds.includes(pendingSessionBinding.sessionId);
  const createSession = async (input: CreateSessionForWorktreeInput): Promise<void> => {
    if (createSessionCallback === undefined) {
      setActionError({
        code: 'SESSION_CREATE_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setActionPending(true);
    setActionError(undefined);
    setPendingSessionBinding(undefined);
    try {
      await createSessionCallback(input);
      await refresh({
        scope: { kind: 'workspace', workspaceId: input.workspaceId },
        preserveCurrent: true,
      });
    } catch (error) {
      if (error instanceof WorktreeSessionBindingError && error.retryable) {
        setPendingSessionBinding({ ...input, sessionId: error.sessionId });
      }
      if (error instanceof WorktreeSessionPermissionError && error.retryable) {
        setPendingSessionBinding({
          ...input,
          sessionId: error.sessionId,
          permissionRequired: true,
        });
      }
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };
  const retrySessionBinding = async (): Promise<void> => {
    if (manager === undefined || pendingSessionBinding === undefined || pendingSessionArchived)
      return;
    const pending = pendingSessionBinding;
    setActionPending(true);
    setActionError(undefined);
    try {
      await retryWorktreeSessionBinding({
        manager,
        pending,
        archived: false,
        ensureSessionWorkspace: (workspaceId, sessionId) => {
          ensureSessionWorkspace?.(workspaceId, sessionId);
        },
        permission,
        confirmFullAccess,
        onPermissionResult,
        openSession,
      });
      setPendingSessionBinding(undefined);
      await refresh({
        scope: { kind: 'workspace', workspaceId: pending.workspaceId },
        preserveCurrent: true,
      });
    } catch (error) {
      if (error instanceof WorktreeSessionBindingError && !error.retryable) {
        setPendingSessionBinding(undefined);
      }
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };
  const retryForkBinding = async (key: string): Promise<void> => {
    if (retryForkSession === undefined || forkRetryKey !== undefined) return;
    setForkRetryKey(key);
    try {
      await retryForkSession(key);
    } catch (error) {
      setActionError(toNativeWorktreeViewError(error));
    } finally {
      setForkRetryKey(undefined);
    }
  };
  const openWorkspaceSession = (workspaceId: string, sessionId: string): void => {
    ensureSessionWorkspace?.(workspaceId, sessionId);
    openWorktreeSession({ open: openSession }, sessionId);
  };
  return {
    pendingSessionBinding,
    setPendingSessionBinding,
    forkRetryKey,
    setForkRetryKey,
    pendingSessionArchived,
    createSession,
    retrySessionBinding,
    retryForkBinding,
    openWorkspaceSession,
  };
}
