import { useCallback, useState } from 'react';
import { toWorktreeViewError, type WorktreeViewError } from '../../view/worktree-view.js';
import { worktreeNotifications } from '../notification-center.js';
import type { RefreshOptions } from '../types.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';

type Input = { read: Pick<ReturnType<typeof useSurfaceRefresh>, 'refresh'> };

export function useSurfaceMutation({ read }: Input) {
  const { refresh } = read;
  const [actionError, setCurrentError] = useState<WorktreeViewError>();
  const clearActionError = useCallback(() => setCurrentError(undefined), []);
  const reportActionError = useCallback((error: WorktreeViewError) => {
    const reported = worktreeNotifications.reportError(error);
    setCurrentError(reported);
    return reported;
  }, []);
  const [actionPending, setActionPending] = useState(false);
  const runMutation = async (
    operation: () => Promise<void>,
    refreshOptions?: RefreshOptions,
  ): Promise<void> => {
    setActionPending(true);
    clearActionError();
    try {
      await operation();
      if (refreshOptions !== undefined) await refresh(refreshOptions);
    } catch (error) {
      reportActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };
  return { actionError, clearActionError, reportActionError, actionPending, setActionPending, runMutation };
}
