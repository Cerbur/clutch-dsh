import type { WorktreeRecord } from '../../../contract/index.js';
import {
  mergeWorktreeView,
  toWorktreeViewError,
  type WorktreeViewError,
} from '../../view/worktree-view.js';
import styles from '../../worktree.css';
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
    | 'permissionRetryPending'
    | 'cleanupGuard'
    | 'setWorktreeBranchAdoption'
    | 'worktreeBranchAdoption'
    | 'branchAdoptionGuard'
  >;
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    'mode' | 'permissionNoticeSnapshot' | 'workspaceIdsRef'
  >;
  props: Pick<
    WorktreeSurfaceProps,
    'permission' | 'permissionNotice' | 'onPermissionNotice' | 'manager' | 't' | 'viewReader'
  >;
  mutation: Pick<
    ReturnType<typeof useSurfaceMutation>,
    'actionPending' | 'setActionPending' | 'runMutation' | 'setActionError'
  >;
};

export function useLifecycleActions({ read, lifecycleState, source, props, mutation }: Input) {
  const { viewByWorkspace, readStateRef, refresh, setReadState } = read;
  const {
    worktreeCleanDisk,
    worktreeForget,
    permissionRetryPending,
    cleanupGuard,
    setWorktreeBranchAdoption,
    worktreeBranchAdoption,
    branchAdoptionGuard,
  } = lifecycleState;
  const { mode, permissionNoticeSnapshot, workspaceIdsRef } = source;
  const { permission, permissionNotice, onPermissionNotice, manager, t, viewReader } = props;
  const { actionPending, setActionPending, runMutation, setActionError } = mutation;
  const latestLifecycleTarget = (target: WorktreeRecord | undefined) =>
    target === undefined
      ? undefined
      : viewByWorkspace
          .get(target.workspaceId)
          ?.worktrees.find((record) => record.worktreeId === target.worktreeId);
  const cleanDiskTarget = latestLifecycleTarget(worktreeCleanDisk);
  const forgetTarget = latestLifecycleTarget(worktreeForget);
  const permissionRetryTarget =
    mode === 'worktree' &&
    permissionNoticeSnapshot?.result.retryable === true &&
    permission?.normalizeDetachedWorktreePermissions !== undefined
      ? viewByWorkspace
          .get(permissionNoticeSnapshot.workspaceId)
          ?.worktrees.find(
            (record) =>
              record.worktreeId === permissionNoticeSnapshot.worktreeId &&
              record.diskCleanup === 'completed',
          )
      : undefined;
  const retryCleanupPermissions = async (): Promise<void> => {
    if (!permissionRetryTarget || !permission || actionPending || permissionRetryPending.current)
      return;
    const target = {
      workspaceId: permissionRetryTarget.workspaceId,
      worktreeId: permissionRetryTarget.worktreeId,
    };
    const notice = permissionNoticeSnapshot;
    const generation = cleanupGuard.current.begin();
    const isCurrent = () =>
      cleanupGuard.current.isCurrent(generation) &&
      permissionNotice?.getSnapshot() === notice &&
      readStateRef.current.views.some(
        (view) =>
          view.workspaceId === target.workspaceId &&
          view.worktrees.some(
            (record) =>
              record.worktreeId === target.worktreeId && record.diskCleanup === 'completed',
          ),
      );
    if (!isCurrent()) return;
    permissionRetryPending.current = true;
    setActionPending(true);
    try {
      const result = await permission.normalizeDetachedWorktreePermissions(target);
      if (isCurrent()) onPermissionNotice?.(target, result);
    } catch {
      if (isCurrent()) onPermissionNotice?.(target, { status: 'unverified', retryable: true });
    } finally {
      if (cleanupGuard.current.isCurrent(generation)) {
        permissionRetryPending.current = false;
        setActionPending(false);
      }
    }
  };
  const recoveryAction = (error: WorktreeViewError | undefined) => {
    const workspaceId = error?.details?.workspaceId;
    if (!manager || error?.code !== 'WORKTREE_RECOVERY_REQUIRED' || typeof workspaceId !== 'string')
      return null;
    return (
      <button
        type="button"
        className={styles.retryButton}
        disabled={actionPending}
        onClick={() => {
          void runMutation(() => manager.recoverWorktrees({ workspaceId }), {
            scope: { kind: 'workspace', workspaceId },
            preserveCurrent: true,
          });
        }}
      >
        {t('worktree.retryRecovery')}
      </button>
    );
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
      ? `${record.branch} → ${record.currentBranch ?? t('worktree.detachedHead')}`
      : record.branch;
  return {
    latestLifecycleTarget,
    cleanDiskTarget,
    forgetTarget,
    permissionRetryTarget,
    retryCleanupPermissions,
    recoveryAction,
    branchActions,
    refreshBranchAdoption,
    branchLabel,
  };
}
