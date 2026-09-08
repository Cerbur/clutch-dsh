import { useEffect, useMemo } from 'react';
import { filterVisibleSessionIds } from '../../session/session-view.js';
import { unboundSessionIds, workspaceSessionIds } from '../../view/view-mode.js';
import {
  nextSessionOrderAccount,
  type SessionOrderAccountState,
} from '../../session/worktree-session-order.js';
import { filterArchivedSessionIds } from '../../view/worktree-view.js';
import { bindingIdsFor } from '../selectors.js';
import { SessionOrderInput, updatedAtById } from '../shared.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useSurfaceRefresh } from './useSurfaceRefresh.js';
import type { useSurfaceSources } from './useSurfaceSources.js';

type Input = {
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'readState' | 'viewByWorkspace'>;
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    'workspaces' | 'sessions' | 'archivedSessionIds' | 'sessionOrderSnapshot' | 'mode'
  >;
  props: Pick<WorktreeSurfaceProps, 'sessionOrder'>;
};

export function useSessionOrdering({ read, source, props }: Input) {
  const { readState, viewByWorkspace } = read;
  const { workspaces, sessions, archivedSessionIds, sessionOrderSnapshot, mode } = source;
  const { sessionOrder } = props;
  const sessionOrderInputs = useMemo<readonly SessionOrderInput[]>(() => {
    if (readState.status !== 'ready') return [];
    const inputs: SessionOrderInput[] = [];
    for (const workspace of workspaces.items) {
      const view = viewByWorkspace.get(workspace.workspaceId);
      const allWorkspaceSessionIds = filterArchivedSessionIds(
        workspaceSessionIds(workspaces, workspace.workspaceId, sessions.ids),
        archivedSessionIds,
      );
      const bindings = view?.bindings ?? [];
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
      for (const record of view?.worktrees ?? []) {
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
    readState.status,
    sessions.byId,
    sessions.ids,
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
    if (mode !== 'worktree' || readState.status !== 'ready') return;
    for (const input of sessionOrderInputs) {
      sessionOrder.actions.reconcile(input.accountKey, input.sessionIds, input.updatedAtById);
    }
    sessionOrder.actions.retain(sessionOrderInputs.map((input) => input.accountKey));
  }, [mode, readState.status, sessionOrder, sessionOrderInputs]);
  return { sessionOrderInputs, orderedSessionIdsByAccount };
}
