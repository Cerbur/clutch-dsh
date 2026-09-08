import { useState } from 'react';
import { toWorktreeViewError, type WorktreeViewError } from '../../view/worktree-view.js';
import type { RefreshOptions } from '../types.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';

type Input = { read: Pick<ReturnType<typeof useSurfaceRefresh>, 'refresh'> };

export function useSurfaceMutation({ read }: Input) {
  const { refresh } = read;
  const [actionError, setActionError] = useState<WorktreeViewError>();
  const [actionPending, setActionPending] = useState(false);
  const runMutation = async (
    operation: () => Promise<void>,
    refreshOptions?: RefreshOptions,
  ): Promise<void> => {
    setActionPending(true);
    setActionError(undefined);
    try {
      await operation();
      if (refreshOptions !== undefined) await refresh(refreshOptions);
    } catch (error) {
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };
  return { actionError, setActionError, actionPending, setActionPending, runMutation };
}
