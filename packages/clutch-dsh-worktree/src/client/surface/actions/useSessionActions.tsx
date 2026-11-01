import { useState } from 'react';
import { openWorktreeSession } from '../../view/navigation.js';
import { retryWorktreeSessionBinding } from '../../session/worktree-session.js';
import {
  toWorktreeViewError,
  WorktreeSessionBindingError,
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
      await createSessionCallback(input, (sessionId, projectionReady) => refresh({
        alreadyInvalidated: projectionReady,
        scope: { kind: 'workspace', workspaceId: input.workspaceId },
        preserveCurrent: true,
        openingSession: { sessionId, worktreeId: input.worktreeId },
      }));
    } catch (error) {
      if (error instanceof WorktreeSessionBindingError) {
        setPendingSessionBinding({ ...input, sessionId: error.sessionId, error: toWorktreeViewError(error) });
      }
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };
  const retrySessionBinding = async (): Promise<void> => {
    if (manager === undefined || pendingSessionBinding === undefined || pendingSessionArchived ||
      pendingSessionBinding.error?.retryable === false)
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
        openSession,
        beforeOpen: (sessionId) => refresh({
          scope: { kind: 'workspace', workspaceId: pending.workspaceId },
          preserveCurrent: true,
          openingSession: { sessionId, worktreeId: pending.worktreeId },
        }),
      });
      setPendingSessionBinding(undefined);
    } catch (error) {
      setPendingSessionBinding({ ...pending, error: toWorktreeViewError(error) });
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
