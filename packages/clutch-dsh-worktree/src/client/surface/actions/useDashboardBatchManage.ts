import { useCallback, useRef } from 'react';
import type { WorktreeRecord } from '../../../contract/index.js';
import type { LifecycleDialogInput } from '../components/LifecycleDialogs.js';
import { canManageWorktree, sameBatchTarget, type BatchWorktreeAction } from '../../dashboard/batch-manage.js';
import { bindingIdsFor } from '../selectors.js';
import { runWorktreeCleanupFlow } from './worktree-cleanup-flow.js';
import type { WorktreeViewReader } from '../../view/worktree-view-read.js';

/** Batch callers confirm once; each item keeps single-item commit and follow-up semantics. */
export function useDashboardBatchManage(input: LifecycleDialogInput & { readonly reader: WorktreeViewReader }) {
  const latest = useRef(input);
  latest.current = input;
  const manager = input.props.manager;
  const reader = input.reader;
  const busy = useRef<{ readonly isCurrent: () => boolean }>();
  return useCallback(async (action: BatchWorktreeAction, confirmed: WorktreeRecord, ownerCurrent: () => boolean = () => true): Promise<void> => {
    const { props, read, mutation, expansion, session, lifecycleState } = latest.current;
    const conflict = () => ({ code: 'WORKTREE_STATE_CONFLICT', message: '', retryable: true,
        details: { workspaceId: confirmed.workspaceId, worktreeId: confirmed.worktreeId } });
    if (busy.current?.isCurrent() || !manager || props.manager !== manager || latest.current.reader !== reader || !ownerCurrent()) throw conflict();
    const guard = lifecycleState.cleanupGuard.current;
    const generation = guard.begin();
    const lifecycleCurrent = () => latest.current.props.manager === manager && latest.current.reader === reader &&
      latest.current.lifecycleState.cleanupGuard.current === guard && guard.isCurrent(generation);
    const operation = { isCurrent: lifecycleCurrent };
    busy.current = operation;
    mutation.setActionPending(true);
    try {
      // Refresh publishes React state asynchronously. Read the shared ready cache
      // so the next item sees the new revision even before React commits that state.
      const view = await reader.read(confirmed.workspaceId);
      const record = view.worktrees.find((value) => value.worktreeId === confirmed.worktreeId);
      if (!ownerCurrent() || !lifecycleCurrent() ||
        !read.readStateRef.current.views.some((value) => value.workspaceId === confirmed.workspaceId) ||
        !record || !sameBatchTarget(record, confirmed) || !canManageWorktree(record, action)) throw conflict();
      const target = { workspaceId: record.workspaceId, worktreeId: record.worktreeId, mutationToken: record.mutationToken! };
      const refresh = () => read.refresh({ scope: { kind: 'workspace', workspaceId: record.workspaceId }, preserveCurrent: true });
      if (action === 'archive') {
        await manager.removeWorktree(target);
        if (!lifecycleCurrent()) return;
        expansion.suppressCurrentSessionReveal('archived:' + record.workspaceId);
      } else if (action === 'forget') {
        await manager.forgetWorktree(target);
        if (!lifecycleCurrent()) return;
        // Beginning this operation already retired older cleanup/retry callbacks.
        props.onWorktreeForgotten?.({ workspaceId: record.workspaceId, worktreeId: record.worktreeId,
          sessionIds: bindingIdsFor(view?.bindings ?? [], record.worktreeId) });
        if (session.pendingSessionBinding?.worktreeId === record.worktreeId) session.setPendingSessionBinding(undefined);
        expansion.clearSessionGroups(['worktree:' + record.worktreeId]);
        read.setReadState((current) => ({ ...current, views: current.views.map((value) => value.workspaceId !== record.workspaceId ? value : {
          ...value, worktrees: value.worktrees.filter((item) => item.worktreeId !== record.worktreeId),
          bindings: value.bindings.filter((item) => item.worktreeId !== record.worktreeId),
        }) }));
      } else {
        await runWorktreeCleanupFlow({
          clean: () => manager.cleanWorktree(target),
          isCurrent: lifecycleCurrent,
          onCommitted: () => read.setReadState((current) => ({ ...current, views: current.views.map((value) => value.workspaceId !== record.workspaceId ? value : {
            ...value, worktrees: value.worktrees.map((item) => item.worktreeId !== record.worktreeId ? item : {
              ...item, status: 'removed', diskCleanup: 'completed', health: 'cleaned', mutationToken: undefined,
            }),
            bindings: value.bindings.map((item) => item.worktreeId !== record.worktreeId ? item : { ...item, status: 'detached' }),
          }) })),
          refresh,
          normalize: async () => {
            if (!props.permission?.normalizeDetachedWorktreePermissions) return;
            try {
              const result = await props.permission.normalizeDetachedWorktreePermissions(target);
              if (result && lifecycleCurrent()) props.onPermissionNotice?.(target, result);
            } catch {
              if (lifecycleCurrent()) props.onPermissionNotice?.(target, { status: 'unverified', retryable: true });
            }
          },
          onFollowUpError: () => {},
        });
        return;
      }
      // The mutation committed. A failed projection read must not invite its replay.
      if (lifecycleCurrent()) await refresh().catch(() => {});
    } catch (cause) {
      // A rejected Git transaction can roll its journal back and still advance
      // the Workspace revision. Retire those tokens before the next batch item.
      if (lifecycleCurrent()) {
        await read.refresh({ scope: { kind: 'workspace', workspaceId: confirmed.workspaceId }, preserveCurrent: true }).catch(() => {});
      }
      throw cause;
    } finally {
      if (busy.current === operation) busy.current = undefined;
      if (lifecycleCurrent()) mutation.setActionPending(false);
    }
  }, [manager, reader]);
}
