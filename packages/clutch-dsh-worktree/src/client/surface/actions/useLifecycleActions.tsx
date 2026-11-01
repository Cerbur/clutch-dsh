import type { WorktreeRecord } from '../../../contract/index.js';
import {
  mergeWorktreeView,
  toWorktreeViewError,
  type WorktreeViewError,
} from '../../view/worktree-view.js';
import type { WorktreeNotification } from '../notification-queue.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useLifecycleState } from '../state/useLifecycleState.js';
import type { useSurfaceMutation } from './useSurfaceMutation.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';

type Input = {
  read: Pick<
    ReturnType<typeof useSurfaceRefresh>,
    'viewByWorkspace' | 'readStateRef' | 'refresh' | 'setReadState'
  >;
  lifecycleState: Pick<
    ReturnType<typeof useLifecycleState>,
    | 'worktreeCleanDisk'
    | 'worktreeForget'
    | 'cleanupGuard'
    | 'setWorktreeBranchAdoption'
    | 'worktreeBranchAdoption'
    | 'branchAdoptionGuard'
  >;
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    'mode' | 'workspaceIdsRef'
  >;
  props: Pick<
    WorktreeSurfaceProps,
    'manager' | 't' | 'viewReader'
  >;
  mutation: Pick<
    ReturnType<typeof useSurfaceMutation>,
    'actionPending' | 'setActionPending' | 'runMutation' | 'setActionError'
  >;
};

export function useLifecycleActions({ read, lifecycleState, source, props, mutation }: Input) {
  const { viewByWorkspace, refresh, setReadState } = read;
  const {
    worktreeCleanDisk,
    worktreeForget,
    setWorktreeBranchAdoption,
    worktreeBranchAdoption,
    branchAdoptionGuard,
  } = lifecycleState;
  const { workspaceIdsRef } = source;
  const { manager, t, viewReader } = props;
  const { actionPending, setActionPending, runMutation, setActionError } = mutation;
  const latestLifecycleTarget = (target: WorktreeRecord | undefined) =>
    target === undefined
      ? undefined
      : viewByWorkspace
          .get(target.workspaceId)
          ?.worktrees.find((record) => record.worktreeId === target.worktreeId);
  const cleanDiskTarget = latestLifecycleTarget(worktreeCleanDisk);
  const forgetTarget = latestLifecycleTarget(worktreeForget);
  const recoveryAction = (
    error: WorktreeViewError | undefined,
  ): NonNullable<WorktreeNotification['actions']>[number] | null => {
    const workspaceId = error?.details?.workspaceId;
    if (
      !manager ||
      error === undefined ||
      ![
        'WORKTREE_RECOVERY_REQUIRED',
        'SIDECAR_SYNC_REQUIRED',
        'WORKTREE_IDENTITY_CHANGED',
      ].includes(error.code) ||
      typeof workspaceId !== 'string'
    )
      return null;
    return {
      label: t('worktree.retryRecovery'),
      disabled: actionPending,
      onClick: () => {
          void runMutation(() => manager.recoverWorktrees({ workspaceId }), {
            scope: { kind: 'workspace', workspaceId },
            preserveCurrent: true,
          });
      },
    };
  };
  const branchActions = (record: WorktreeRecord) => ({
    onAdoptBranch:
      record.health === 'branch-drift' && typeof record.currentBranch === 'string'
        ? () => {
            setWorktreeBranchAdoption(record);
            setActionError(undefined);
          }
        : undefined,
    onRecover:
      record.health === 'recovery-needed'
        ? () => {
            if (!manager) return;
            void runMutation(() => manager.recoverWorktrees({ workspaceId: record.workspaceId }), {
              scope: { kind: 'workspace', workspaceId: record.workspaceId },
              preserveCurrent: true,
            });
          }
        : undefined,
  });
  const refreshBranchAdoption = async (): Promise<void> => {
    const target = worktreeBranchAdoption;
    if (!manager || !target) return;
    const generation = branchAdoptionGuard.current.begin();
    const isCurrent = () => branchAdoptionGuard.current.isCurrent(generation);
    setActionPending(true);
    try {
      await refresh({
        scope: { kind: 'workspace', workspaceId: target.workspaceId },
        preserveCurrent: true,
      });
      if (!isCurrent()) return;
      const view = await viewReader.read(target.workspaceId);
      if (!isCurrent()) return;
      if (!workspaceIdsRef.current.includes(target.workspaceId)) {
        setWorktreeBranchAdoption(undefined);
        setActionError(undefined);
        return;
      }
      const latest = view.worktrees.find((record) => record.worktreeId === target.worktreeId);
      setReadState((current) => ({ ...current, views: mergeWorktreeView(current.views, view) }));
      setWorktreeBranchAdoption(
        latest?.health === 'branch-drift' && typeof latest.currentBranch === 'string'
          ? latest
          : undefined,
      );
      setActionError(undefined);
    } catch (error) {
      if (isCurrent()) setActionError(toWorktreeViewError(error));
    } finally {
      if (isCurrent()) setActionPending(false);
    }
  };
  const branchLabel = (record: WorktreeRecord): string =>
    record.health === 'branch-drift'
      ? `${record.branch} → ${record.currentHead?.name ?? record.currentBranch ?? t('worktree.detachedHead')}`
      : record.branch;
  return {
    latestLifecycleTarget,
    cleanDiskTarget,
    forgetTarget,
    recoveryAction,
    branchActions,
    refreshBranchAdoption,
    branchLabel,
  };
}
