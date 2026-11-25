import { useCallback, useEffect, useRef, useState } from 'react';
import { toWorktreeViewError, type WorktreeViewError } from '../../view/worktree-view.js';
import { worktreeNotifications } from '../notification-center.js';
import type { RefreshOptions } from '../types.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';

type Input = {
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'refresh'>;
  source?: Pick<ReturnType<typeof useSurfaceSources>, 'mode'>;
};

export function useSurfaceMutation({ read, source }: Input) {
  const { refresh } = read;
  const alive = useRef(true);
  const modeRef = useRef(source?.mode);
  modeRef.current = source?.mode;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const [actionError, setCurrentError] = useState<WorktreeViewError>();
  const clearActionError = useCallback(() => {
    if (alive.current) setCurrentError(undefined);
  }, []);
  const reportActionError = useCallback((error: WorktreeViewError) => {
    const active = alive.current && (modeRef.current === undefined || modeRef.current === 'worktree');
    const reported = worktreeNotifications.reportError(error, active ? {} : { origin: 'retired' });
    if (active) setCurrentError(reported);
    return reported;
  }, []);
  const [actionPending, setPendingState] = useState(false);
  const setActionPending = useCallback(
    (next: boolean | ((previous: boolean) => boolean)) => {
      if (alive.current) setPendingState(next);
    },
    [],
  );
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
