import { runWorktreeCleanupFlow } from './worktree-cleanup-flow.js';
import { executeWorktreeAction, toWorktreeViewError } from '../../view/worktree-view.js';
import type { LifecycleDialogInput } from '../components/LifecycleDialogs.js';
import { bindingIdsFor } from '../selectors.js';

/** Archive, disk cleanup and forget retain their separate commit/recovery semantics. */
export function createLifecycleCommands({
  props,
  lifecycleState,
  mutation,
  lifecycle,
  expansion,
  read,
  session,
}: LifecycleDialogInput) {
  const { manager, permission, onPermissionNotice, onWorktreeForgotten } = props;
  const {
    worktreeBranchAdoption,
    setWorktreeBranchAdoption,
    worktreeRemoval,
    setWorktreeRemoval,
    setWorktreeCleanDisk,
    cleanupGuard,
    setWorktreeForget,
  } = lifecycleState;
  const { runMutation, setActionError, setActionPending } = mutation;
  const { cleanDiskTarget, forgetTarget } = lifecycle;
  const { suppressCurrentSessionReveal, clearSessionGroups } = expansion;
  const { readStateRef, setReadState, refresh, readState } = read;
  const { pendingSessionBinding, setPendingSessionBinding } = session;
  const confirmBranchAdoption = () => {
    const target = worktreeBranchAdoption;
    if (!manager || !target?.mutationToken || typeof target.currentBranch !== 'string') return;
    const expectedBranch = target.currentBranch;
    const mutationToken = target.mutationToken;
    void runMutation(
      async () => {
        await manager.adoptWorktreeBranch({
          workspaceId: target.workspaceId,
          worktreeId: target.worktreeId,
          mutationToken,
          expectedBranch,
        });
        setWorktreeBranchAdoption(undefined);
      },
      { scope: { kind: 'workspace', workspaceId: target.workspaceId }, preserveCurrent: true },
    );
  };
  const confirmArchive = () => {
    if (manager === undefined || worktreeRemoval === undefined) return;
    const target = worktreeRemoval;
    const mutationToken = target.mutationToken;
    if (mutationToken === undefined) {
      setActionError({
        code: 'WORKTREE_STATE_CONFLICT',
        message: '',
        retryable: true,
        details: {
          workspaceId: target.workspaceId,
          worktreeId: target.worktreeId,
        },
      });
      return;
    }
    void runMutation(
      async () => {
        await executeWorktreeAction(manager, {
          type: 'removeWorktree',
          input: {
            workspaceId: target.workspaceId,
            worktreeId: target.worktreeId,
            mutationToken,
          },
        });
        suppressCurrentSessionReveal('archived:' + target.workspaceId);
        setWorktreeRemoval(undefined);
      },
      {
        scope: { kind: 'workspace', workspaceId: target.workspaceId },
        preserveCurrent: true,
      },
    );
  };
  const confirmDiskCleanup = () => {
    if (manager === undefined || cleanDiskTarget === undefined) return;
    const target = cleanDiskTarget;
    const mutationToken = target.mutationToken;
    if (mutationToken === undefined) {
      setActionError({
        code: 'WORKTREE_STATE_CONFLICT',
        message: '',
        retryable: true,
        details: {
          workspaceId: target.workspaceId,
          worktreeId: target.worktreeId,
        },
      });
      return;
    }
    const generation = cleanupGuard.current.begin();
    const isCurrent = () =>
      cleanupGuard.current.isCurrent(generation) &&
      readStateRef.current.views.some(
        (view) =>
          view.workspaceId === target.workspaceId &&
          view.worktrees.some((record) => record.worktreeId === target.worktreeId),
      );
    setActionPending(true);
    setActionError(undefined);
    void runWorktreeCleanupFlow({
      clean: async () => {
        await executeWorktreeAction(manager, {
          type: 'cleanWorktree',
          input: {
            workspaceId: target.workspaceId,
            worktreeId: target.worktreeId,
            mutationToken,
          },
        });
      },
      onCommitted: () => {
        setWorktreeCleanDisk(undefined);
        setReadState((current) => {
          if (current.status !== 'ready') return current;
          return {
            ...current,
            views: current.views.map((v) => {
              if (v.workspaceId !== target.workspaceId) return v;
              return {
                ...v,
                worktrees: v.worktrees.map((w) => {
                  if (w.worktreeId !== target.worktreeId) return w;
                  return {
                    ...w,
                    status: 'removed',
                    diskCleanup: 'completed',
                    health: 'cleaned',
                    mutationToken: undefined,
                  };
                }),
                bindings: v.bindings.map((b) => {
                  if (b.worktreeId !== target.worktreeId) return b;
                  return {
                    ...b,
                    status: 'detached',
                  };
                }),
              };
            }),
          };
        });
      },
      refresh: async () => {
        await refresh({
          scope: { kind: 'workspace', workspaceId: target.workspaceId },
          preserveCurrent: true,
        });
      },
      normalize: async () => {
        if (permission?.normalizeDetachedWorktreePermissions === undefined) return;
        try {
          const result = await permission.normalizeDetachedWorktreePermissions({
            workspaceId: target.workspaceId,
            worktreeId: target.worktreeId,
          });
          if (result !== undefined && isCurrent()) {
            onPermissionNotice?.(
              {
                workspaceId: target.workspaceId,
                worktreeId: target.worktreeId,
              },
              result,
            );
          }
        } catch {
          if (isCurrent()) {
            onPermissionNotice?.(
              {
                workspaceId: target.workspaceId,
                worktreeId: target.worktreeId,
              },
              {
                status: 'unverified',
                retryable: true,
              },
            );
          }
        }
      },
      isCurrent,
      onFollowUpError: () => {
        // Follow-up errors do not fail the clean mutation
      },
    })
      .catch((error) => {
        if (isCurrent()) setActionError(toWorktreeViewError(error));
      })
      .finally(() => {
        if (isCurrent()) setActionPending(false);
      });
  };
  const confirmForget = () => {
    if (manager === undefined || forgetTarget === undefined) return;
    const target = forgetTarget;
    const mutationToken = target.mutationToken;
    if (mutationToken === undefined) {
      setActionError({
        code: 'WORKTREE_STATE_CONFLICT',
        message: '',
        retryable: true,
        details: {
          workspaceId: target.workspaceId,
          worktreeId: target.worktreeId,
        },
      });
      return;
    }
    const targetBindings =
      readState.status === 'ready'
        ? (readState.views.find((v) => v.workspaceId === target.workspaceId)?.bindings ?? [])
        : [];
    const affectedSessionIds = bindingIdsFor(targetBindings, target.worktreeId);
    void runMutation(
      async () => {
        await executeWorktreeAction(manager, {
          type: 'forgetWorktree',
          input: {
            workspaceId: target.workspaceId,
            worktreeId: target.worktreeId,
            mutationToken,
          },
        });
        cleanupGuard.current.invalidate();
        onWorktreeForgotten?.({
          workspaceId: target.workspaceId,
          worktreeId: target.worktreeId,
          sessionIds: affectedSessionIds,
        });
        if (pendingSessionBinding?.worktreeId === target.worktreeId) {
          setPendingSessionBinding(undefined);
        }
        clearSessionGroups(['worktree:' + target.worktreeId]);
        setReadState((current) => {
          if (current.status !== 'ready') return current;
          return {
            ...current,
            views: current.views.map((v) => {
              if (v.workspaceId !== target.workspaceId) return v;
              return {
                ...v,
                worktrees: v.worktrees.filter((w) => w.worktreeId !== target.worktreeId),
                bindings: v.bindings.filter((b) => b.worktreeId !== target.worktreeId),
              };
            }),
          };
        });
        setWorktreeForget(undefined);
      },
      {
        scope: { kind: 'workspace', workspaceId: target.workspaceId },
        preserveCurrent: true,
      },
    );
  };
  return { confirmBranchAdoption, confirmArchive, confirmDiskCleanup, confirmForget };
}
