import { useEffect, useRef, useState } from 'react';
import type { WorktreeRecord } from '../../../contract/index.js';
import { createWorktreeRefreshGuard } from '../../view/worktree-view.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useSurfaceMutation } from '../actions/useSurfaceMutation.js';
import type { useSurfaceSources } from './useSurfaceSources.js';

type Input = {
  props: Pick<WorktreeSurfaceProps, 'manager'>;
  source: Pick<ReturnType<typeof useSurfaceSources>, 'mode'>;
  mutation: Pick<ReturnType<typeof useSurfaceMutation>, 'setActionPending'>;
};

export function useLifecycleState({ props, source, mutation }: Input) {
  const { manager } = props;
  const { mode } = source;
  const { setActionPending } = mutation;
  const [worktreeBranchAdoption, setWorktreeBranchAdoption] = useState<WorktreeRecord>();
  const [worktreeRemoval, setWorktreeRemoval] = useState<WorktreeRecord>();
  const [worktreeCleanDisk, setWorktreeCleanDisk] = useState<WorktreeRecord>();
  const [worktreeForget, setWorktreeForget] = useState<WorktreeRecord>();
  const cleanupGuard = useRef(createWorktreeRefreshGuard());
  const branchAdoptionGuard = useRef(createWorktreeRefreshGuard());
  useEffect(() => {
    const guard = branchAdoptionGuard.current;
    setWorktreeBranchAdoption(undefined);
    return () => guard.invalidate();
  }, [manager, mode]);
  const permissionRetryPending = useRef(false);
  useEffect(() => {
    const guard = cleanupGuard.current;
    permissionRetryPending.current = false;
    setActionPending(false);
    return () => guard.invalidate();
  }, [manager, mode]);
  return {
    worktreeBranchAdoption,
    setWorktreeBranchAdoption,
    worktreeRemoval,
    setWorktreeRemoval,
    worktreeCleanDisk,
    setWorktreeCleanDisk,
    worktreeForget,
    setWorktreeForget,
    cleanupGuard,
    branchAdoptionGuard,
    permissionRetryPending,
  };
}
