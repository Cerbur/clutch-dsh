import {
  WorktreeAdoptBranchDialog,
  WorktreeCleanDiskDialog,
  WorktreeForgetDialog,
  WorktreeRemovalDialog,
} from './dialogs.js';
import { createLifecycleCommands } from '../actions/lifecycle-commands.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useLifecycleActions } from '../actions/useLifecycleActions.js';
import type { useLifecycleState } from '../state/useLifecycleState.js';
import type { useSessionActions } from '../actions/useSessionActions.js';
import type { useSessionExpansion } from '../state/useSessionExpansion.js';
import type { useSurfaceMutation } from '../actions/useSurfaceMutation.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';

export type LifecycleDialogInput = {
  props: Pick<
    WorktreeSurfaceProps,
    't' | 'manager' | 'permission' | 'onPermissionNotice' | 'onWorktreeForgotten'
  >;
  lifecycleState: Pick<
    ReturnType<typeof useLifecycleState>,
    | 'worktreeBranchAdoption'
    | 'branchAdoptionGuard'
    | 'setWorktreeBranchAdoption'
    | 'worktreeRemoval'
    | 'setWorktreeRemoval'
    | 'setWorktreeCleanDisk'
    | 'cleanupGuard'
    | 'setWorktreeForget'
  >;
  mutation: Pick<
    ReturnType<typeof useSurfaceMutation>,
    'actionPending' | 'actionError' | 'runMutation' | 'setActionError' | 'setActionPending'
  >;
  lifecycle: Pick<
    ReturnType<typeof useLifecycleActions>,
    'refreshBranchAdoption' | 'cleanDiskTarget' | 'forgetTarget'
  >;
  expansion: Pick<
    ReturnType<typeof useSessionExpansion>,
    'suppressCurrentSessionReveal' | 'clearSessionGroups'
  >;
  read: Pick<
    ReturnType<typeof useSurfaceRefresh>,
    'readStateRef' | 'setReadState' | 'refresh' | 'readState'
  >;
  session: Pick<
    ReturnType<typeof useSessionActions>,
    'pendingSessionBinding' | 'setPendingSessionBinding'
  >;
};
type Input = LifecycleDialogInput;

export function LifecycleDialogs({
  props,
  lifecycleState,
  mutation,
  lifecycle,
  expansion,
  read,
  session,
}: Input) {
  const { t } = props;
  const {
    worktreeBranchAdoption,
    branchAdoptionGuard,
    setWorktreeBranchAdoption,
    worktreeRemoval,
    setWorktreeRemoval,
    setWorktreeCleanDisk,
    setWorktreeForget,
  } = lifecycleState;
  const { actionPending, actionError } = mutation;
  const { refreshBranchAdoption, cleanDiskTarget, forgetTarget } = lifecycle;

  const { confirmBranchAdoption, confirmArchive, confirmDiskCleanup, confirmForget } =
    createLifecycleCommands({
      props,
      lifecycleState,
      mutation,
      lifecycle,
      expansion,
      read,
      session,
    });

  return (
    <>
      <WorktreeAdoptBranchDialog
        t={t}
        worktree={worktreeBranchAdoption}
        actionPending={actionPending}
        error={actionError}
        onRetry={() => {
          void refreshBranchAdoption();
        }}
        onClose={() => {
          branchAdoptionGuard.current.invalidate();
          setWorktreeBranchAdoption(undefined);
        }}
        onSubmit={confirmBranchAdoption}
      />
      <WorktreeRemovalDialog
        t={t}
        worktree={worktreeRemoval}
        actionPending={actionPending}
        onClose={() => {
          setWorktreeRemoval(undefined);
        }}
        onSubmit={confirmArchive}
      />
      <WorktreeCleanDiskDialog
        t={t}
        worktree={cleanDiskTarget}
        actionPending={actionPending}
        onClose={() => {
          setWorktreeCleanDisk(undefined);
        }}
        onSubmit={confirmDiskCleanup}
      />
      <WorktreeForgetDialog
        t={t}
        worktree={forgetTarget}
        actionPending={actionPending}
        onClose={() => {
          setWorktreeForget(undefined);
        }}
        onSubmit={confirmForget}
      />
    </>
  );
}
