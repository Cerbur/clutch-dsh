import { useEffect, useRef } from 'react';
import type { WorktreeRecord } from '../../../contract/index.js';
import type { ReportId } from '../../view/worktree-view-errors.js';
import {
  mergeWorktreeView,
  toWorktreeViewError,
  type WorktreeViewError,
} from '../../view/worktree-view.js';
import { worktreeNotifications } from '../notification-center.js';
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
    'actionPending' | 'setActionPending' | 'runMutation' | 'clearActionError' | 'reportActionError'
  > & Partial<Pick<ReturnType<typeof useSurfaceMutation>, 'actionError'>>;
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
  const { actionError, actionPending, setActionPending, runMutation, clearActionError, reportActionError } = mutation;
  const branchAdoptionReportsRef = useRef<ReportId[]>([]);
  useEffect(() => {
    if (worktreeBranchAdoption === undefined) branchAdoptionReportsRef.current = [];
  }, [worktreeBranchAdoption?.worktreeId]);
  useEffect(() => () => { branchAdoptionReportsRef.current = []; }, []);
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
    if (!manager || error === undefined || typeof workspaceId !== 'string') return null;
    const quarantineOperationId = error.details?.quarantineOperationId;
    const canQuarantine = typeof quarantineOperationId === 'string' && quarantineOperationId.length > 0;
    if (
      !canQuarantine &&
      ![
        'WORKTREE_RECOVERY_REQUIRED',
        'SIDECAR_SYNC_REQUIRED',
        'WORKTREE_IDENTITY_CHANGED',
      ].includes(error.code)
    )
      return null;
    return {
      label: t(canQuarantine ? 'worktree.cancelPendingCleanup' : 'worktree.retryRecovery'),
      disabled: actionPending,
      onClick: () => {
          void runMutation(async () => {
            await manager.recoverWorktrees({ workspaceId, ...(canQuarantine ? { quarantineOperationId } : {}) });
            if (error.reportId) worktreeNotifications.resolve(error.reportId);
          }, {
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
            clearActionError();
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
    const reports = typeof branchAdoptionReportsRef === 'undefined' ? undefined : branchAdoptionReportsRef;
    const priorReports = [...(reports?.current ?? [])];
    const previousReportId = typeof actionError === 'undefined' ? undefined : actionError?.reportId;
    if (previousReportId && !priorReports.includes(previousReportId)) priorReports.push(previousReportId);
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
        for (const reportId of priorReports) worktreeNotifications.resolve(reportId);
        if (reports) reports.current = [];
        setWorktreeBranchAdoption(undefined);
        clearActionError();
        return;
      }
      const latest = view.worktrees.find((record) => record.worktreeId === target.worktreeId);
      setReadState((current) => ({ ...current, views: mergeWorktreeView(current.views, view) }));
      setWorktreeBranchAdoption(
        latest?.health === 'branch-drift' && typeof latest.currentBranch === 'string'
          ? latest
          : undefined,
      );
      for (const reportId of priorReports) worktreeNotifications.resolve(reportId);
      if (reports) reports.current = [];
      clearActionError();
    } catch (error) {
      if (isCurrent()) {
        const reported = reportActionError(toWorktreeViewError(error)) as WorktreeViewError | undefined;
        if (reported?.reportId && reports) reports.current.push(reported.reportId);
      } else {
        worktreeNotifications.reportError(toWorktreeViewError(error), { origin: 'retired', context: target.absolutePath });
      }
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
