import { useEffect, useMemo } from 'react';
import { filterVisibleSessionIds } from '../../session/session-view.js';
import { unboundSessionIds, workspaceSessionIds } from '../../view/view-mode.js';
import {
  nextSessionOrderAccount,
  type SessionOrderAccountState,
} from '../../session/worktree-session-order.js';
import { filterArchivedSessionIds } from '../../view/worktree-view.js';
import {
  bindingIdsFor,
  isCompleteWorktreeWorkspaceSnapshot,
  isPendingListPhase,
} from '../selectors.js';
import { SessionOrderInput, updatedAtById } from '../shared.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useSurfaceRefresh } from './useSurfaceRefresh.js';
import type { useSurfaceSources } from './useSurfaceSources.js';

type Input = {
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'readState' | 'viewByWorkspace'>;
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    'workspaces' | 'sessions' | 'archivedSessionIds' | 'sessionOrderSnapshot' | 'mode' | 'workspaceIds'
  >;
  props: Pick<WorktreeSurfaceProps, 'sessionOrder'>;
};

export function useSessionOrdering({ read, source, props }: Input) {
  const { readState, viewByWorkspace } = read;
  const { workspaces, sessions, archivedSessionIds, sessionOrderSnapshot, mode, workspaceIds } = source;
  const { sessionOrder } = props;

  // DSH lists report a monotone `pending` → `ready` arrival phase, and an empty list in
  // the pending phase means "nothing arrived yet" rather than "nothing exists". Deriving
  // accounts from that read would reset every stored order to no order at all.
  const sourcesReady =
    readState.status === 'ready' &&
    !isPendingListPhase(sessions.phase) &&
    !isPendingListPhase(workspaces.phase);

  // Reconciling may run as soon as one Workspace projection is ready, but deleting accounts
  // for Workspaces that no longer exist requires the complete, non-empty projection.
  const canRetainAccounts =
    sourcesReady && isCompleteWorktreeWorkspaceSnapshot(workspaceIds, readState.views);

  const sessionOrderInputs = useMemo<readonly SessionOrderInput[]>(() => {
    if (!sourcesReady) return [];
    const inputs: SessionOrderInput[] = [];
    for (const workspace of workspaces.items) {
      // Before this Workspace's projection lands, which Sessions belong to a Worktree is
      // unknown. Skipping it keeps the stored order instead of rebuilding it from a guess.
      const view = viewByWorkspace.get(workspace.workspaceId);
      if (view === undefined) continue;
      const allWorkspaceSessionIds = filterArchivedSessionIds(
        workspaceSessionIds(workspaces, workspace.workspaceId, sessions.ids),
        archivedSessionIds,
      );
      const bindings = view.bindings;
      const boundSessionIds = new Set(bindings.map((binding) => binding.sessionId));
      const mainSessionIds = filterVisibleSessionIds(
        unboundSessionIds(allWorkspaceSessionIds, [...boundSessionIds]),
        sessions,
      );
      inputs.push({
        accountKey: `main:${workspace.workspaceId}`,
        sessionIds: mainSessionIds,
        updatedAtById: updatedAtById(mainSessionIds, sessions),
      });
      for (const record of view.worktrees) {
        const worktreeSessionIds = filterVisibleSessionIds(
          filterArchivedSessionIds(
            bindingIdsFor(bindings, record.worktreeId).filter((sessionId) =>
              sessions.ids.includes(sessionId),
            ),
            archivedSessionIds,
          ),
          sessions,
        );
        inputs.push({
          accountKey: `worktree:${record.worktreeId}`,
          sessionIds: worktreeSessionIds,
          updatedAtById: updatedAtById(worktreeSessionIds, sessions),
        });
      }
    }
    return inputs;
  }, [
    archivedSessionIds,
    sessions.byId,
    sessions.ids,
    sourcesReady,
    viewByWorkspace,
    workspaces,
    workspaces.items,
  ]);
  const orderedSessionIdsByAccount = useMemo(() => {
    const ordered = new Map<string, readonly string[]>();
    for (const input of sessionOrderInputs) {
      const previous: SessionOrderAccountState | undefined =
        sessionOrderSnapshot.accounts[input.accountKey];
      ordered.set(
        input.accountKey,
        nextSessionOrderAccount({
          baseIds: input.sessionIds,
          updatedAtById: input.updatedAtById,
          previous,
        }).order,
      );
    }
    return ordered;
  }, [sessionOrderInputs, sessionOrderSnapshot]);
  useEffect(() => {
    if (mode !== 'worktree' || sessionOrderInputs.length === 0) return;
    for (const input of sessionOrderInputs) {
      sessionOrder.actions.reconcile(input.accountKey, input.sessionIds, input.updatedAtById);
    }
    if (!canRetainAccounts) return;
    sessionOrder.actions.retain(sessionOrderInputs.map((input) => input.accountKey));
  }, [canRetainAccounts, mode, sessionOrder, sessionOrderInputs]);
  return { sessionOrderInputs, orderedSessionIdsByAccount };
}
