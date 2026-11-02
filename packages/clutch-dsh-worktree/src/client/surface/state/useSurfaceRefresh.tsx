import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { WorktreeSessionActionError } from '../../session/worktree-session.js';
import {
  createWorktreeRefreshGuard,
  mergeWorktreeView,
  mergeWorktreeViews,
  toWorktreeViewError,
  type WorktreeWorkspaceView,
} from '../../view/worktree-view.js';
import { worktreeActivityRefreshWorkspaceIds, isCompleteWorktreeWorkspaceSnapshot, isPendingListPhase } from '../selectors.js';
import { EMPTY_READ_STATE } from '../shared.js';
import type { ReadState, RefreshOptions, WorktreeSurfaceProps } from '../types.js';
import type { useRegistrationState } from './useRegistrationState.js';
import type { useSurfaceSources } from './useSurfaceSources.js';

type Input = {
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    'forkRecoverySnapshot' | 'workspaceIdsRef' | 'mode' | 'workspaceIds' | 'sessionPresentations'
    | 'currentSessionId' | 'workspaces' | 'expandSnapshot'
  >;
  props: Pick<
    WorktreeSurfaceProps,
    'manager' | 'viewReader' | 'invalidateWorktreeContext' | 'syncSessionWorkspaces' | 'syncWorkspaceSessions' | 'subscribeToolChanges'
  >;
  registrationState: Pick<
    ReturnType<typeof useRegistrationState>,
    | 'modalReadViewRef'
    | 'setModalReadError'
    | 'setModalReadLoading'
    | 'modalReadLoader'
    | 'setWorktreeModalWorkspaceId'
  >;
};

export function useSurfaceRefresh({ source, props, registrationState }: Input) {
  const { forkRecoverySnapshot, mode, workspaceIds, sessionPresentations } =
    source;
  const workspaceIdsRef = useRef(workspaceIds);
  workspaceIdsRef.current = isPendingListPhase(source.workspaces.phase)
    ? [...new Set([...workspaceIdsRef.current, ...workspaceIds])] : workspaceIds;
  const workspacesRef = useRef(source.workspaces);
  workspacesRef.current = source.workspaces;
  const { manager, viewReader, invalidateWorktreeContext, syncSessionWorkspaces } = props;
  const syncedMembershipViews = useRef(new Map<string, WorktreeWorkspaceView>());
  const {
    modalReadViewRef,
    setModalReadError,
    setModalReadLoading,
    modalReadLoader,
    setWorktreeModalWorkspaceId,
  } = registrationState;
  const [readState, setReadState] = useState<ReadState>(EMPTY_READ_STATE);
  const readStateRef = useRef(readState);
  readStateRef.current = readState;
  const priorityIdsRef = useRef(workspaceIds);
  const currentWorkspaceId = source.workspaces.items.find((workspace) =>
    workspace.sessionIds.includes(source.currentSessionId ?? ''))?.workspaceId;
  priorityIdsRef.current = [...workspaceIds].sort((a, b) => {
    const priority = (id: string) => id === currentWorkspaceId ? 0
      : source.expandSnapshot.collapsedWorkspaceIds[id] ? 2 : 1;
    return priority(a) - priority(b);
  });
  const refreshGuard = useRef(createWorktreeRefreshGuard());
  const targetRefreshGuards = useRef(
    new Map<string, ReturnType<typeof createWorktreeRefreshGuard>>(),
  );
  const targetReads = useRef(new Map<string, {
    generation: number;
    promise: Promise<WorktreeWorkspaceView>;
    sessionIds: readonly string[];
    pending: boolean;
  }>());
  const forkRecoveryRevisionRef = useRef(forkRecoverySnapshot.revision);
  const guardFor = (workspaceId: string) => {
    const current = targetRefreshGuards.current.get(workspaceId);
    if (current !== undefined) return current;
    const created = createWorktreeRefreshGuard();
    targetRefreshGuards.current.set(workspaceId, created);
    return created;
  };
  const refresh = useCallback(
    async (options: RefreshOptions = {}): Promise<void> => {
      if (manager === undefined) {
        if (options.openingSession) throw new WorktreeSessionActionError('WORKTREE_SESSION_REPAIR_REQUIRED', 'manager unavailable', true);
        refreshGuard.current.invalidate();
        for (const guard of targetRefreshGuards.current.values()) guard.invalidate();
        targetReads.current.clear();
        setReadState(EMPTY_READ_STATE);
        return;
      }
      const scope = options.scope ?? { kind: 'global' as const };
      const currentWorkspaceIds = workspaceIdsRef.current;
      // Publish each completed Workspace; the shared reader bounds RPC fan-out.
      if (scope.kind === 'global') setReadState((current) => ({ ...current, status: 'ready' }));
      const requestedWorkspaceIds = scope.kind === 'global' ? priorityIdsRef.current
        : scope.kind === 'workspace' ? [scope.workspaceId] : scope.workspaceIds;
      const selectedWorkspaceIds = [...new Set(requestedWorkspaceIds)].filter((workspaceId) =>
        currentWorkspaceIds.includes(workspaceId),
      );
      if (selectedWorkspaceIds.length === 0) {
        if (options.openingSession) throw new WorktreeSessionActionError('WORKTREE_SESSION_REPAIR_REQUIRED', 'workspace projection unavailable', true);
        return;
      }

      const results = await Promise.allSettled(
        selectedWorkspaceIds.map(async (workspaceId) => {
          const guard = guardFor(workspaceId);
          if (!options.alreadyInvalidated && !options.ensureLoaded) {
            viewReader.invalidate(workspaceId, {
              reuseInFlight: options.reuseInFlight, changeId: options.changeId,
            });
          }
          const contextRefresh =
            options.invalidateContext === false
              ? undefined
              : invalidateWorktreeContext?.(workspaceId, { alreadyInvalidated: true })
                ?.catch(() => undefined);
          let request = { generation: guard.begin(), promise: viewReader.read(workspaceId, { current: true }),
            pending: true,
            sessionIds: workspacesRef.current.items.find((item) => item.workspaceId === workspaceId)?.sessionIds ?? [] };
          targetReads.current.set(workspaceId, request);
          try {
            let view: WorktreeWorkspaceView | undefined;
            const opening = options.openingSession;
            for (;;) {
              try {
                view = await request.promise;
              } catch (error) {
                if (!opening || guard.isCurrent(request.generation)) throw error;
              }
              if (!opening || guard.isCurrent(request.generation)) break;
              // Creation completion and the Host notification can overlap. Follow
              // the newer authoritative read instead of reporting a broken binding.
              const latest = targetReads.current.get(workspaceId);
              if (!latest || latest === request) {
                throw new WorktreeSessionActionError('WORKTREE_VIEW_FAILED', 'opening refresh cancelled', true);
              }
              request = latest;
            }
            if (!view) throw new WorktreeSessionActionError('WORKTREE_VIEW_FAILED', 'workspace projection unavailable', true);
            view = view.knownSessionIds === undefined ? { ...view, knownSessionIds: request.sessionIds } : view;
            if (opening && (!workspaceIdsRef.current.includes(workspaceId) ||
              !view.worktrees.some((record) => record.worktreeId === opening.worktreeId) ||
              !view.bindings.some((binding) => binding.sessionId === opening.sessionId &&
                binding.worktreeId === opening.worktreeId && binding.status === 'active'))) {
              throw new WorktreeSessionActionError('WORKTREE_SESSION_REPAIR_REQUIRED', 'binding projection not ready', true);
            }
            if (!guard.isCurrent(request.generation)) return;
            if (targetRefreshGuards.current.get(workspaceId) !== guard) return;
            if (!workspaceIdsRef.current.includes(workspaceId)) return;
            const publish = () => setReadState((current) => {
              const targetErrors = { ...current.targetErrors };
              delete targetErrors[workspaceId];
              return { ...current, status: 'ready' as const,
                views: mergeWorktreeViews(current.views, workspaceIdsRef.current, [view]),
                error: undefined, targetErrors };
            });
            // Native navigation updates an external store synchronously. Commit its
            // destination first so that the newly current blank row cannot enter Local.
            if (options.openingSession) flushSync(publish);
            else publish();
          } catch (error) {
            if (options.openingSession) throw error;
            if (!guard.isCurrent(request.generation)) return;
            if (targetRefreshGuards.current.get(workspaceId) !== guard) return;
            if (!workspaceIdsRef.current.includes(workspaceId)) return;
            setReadState((current) => {
              return {
                ...current,
                status: 'ready',
                views: mergeWorktreeViews(current.views, workspaceIdsRef.current, []),
                error: undefined,
                targetErrors: { ...current.targetErrors,
                  [workspaceId]: { ...toWorktreeViewError(error), retryable: true },
                },
              };
            });
          } finally {
            request.pending = false;
            // Context follows its own identity and generation. Never hold a ready
            // Workspace behind the current Session's independent projection.
            void contextRefresh;
          }
        }),
      );
      if (options.openingSession) {
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      }
    },
    [invalidateWorktreeContext, manager, viewReader],
  );
  useEffect(() => props.subscribeToolChanges?.(({ workspaceId }) => {
    if (mode !== 'worktree') return;
    void refresh({
      scope: { kind: 'workspace', workspaceId },
      preserveCurrent: true,
      alreadyInvalidated: true,
      invalidateContext: false,
    });
  }), [props.subscribeToolChanges, mode, refresh]);
  const loadModalWorktreeView = useCallback(
    (workspaceId: string): void => {
      setModalReadError(undefined);
      setModalReadLoading(true);
      if (manager === undefined) {
        setModalReadLoading(false);
        setModalReadError({
          code: 'WORKTREE_VIEW_UNAVAILABLE',
          message: '',
          retryable: true,
        });
        return;
      }
      const sessionIds = workspacesRef.current.items.find((item) => item.workspaceId === workspaceId)?.sessionIds ?? [];
      void modalReadLoader.current.load(
        workspaceId,
        (data) => {
          const view = data.knownSessionIds === undefined ? { ...data, knownSessionIds: sessionIds } : data;
          modalReadViewRef.current = view;
          setModalReadLoading(false);
          setReadState((current) => ({
            ...current,
            views: mergeWorktreeView(current.views, view),
          }));
        },
        (error) => {
          setModalReadLoading(false);
          setModalReadError(toWorktreeViewError(error));
        },
      );
    },
    [manager, viewReader],
  );
  const previousNativeSessions = useRef(new Map(source.workspaces.items.map((item) =>
    [item.workspaceId, item.sessionIds])));
  useEffect(() => {
    if (isPendingListPhase(source.workspaces.phase)) return;
    const previous = previousNativeSessions.current;
    previousNativeSessions.current = new Map(source.workspaces.items.map((item) =>
      [item.workspaceId, item.sessionIds]));
    for (const workspace of source.workspaces.items) {
      const ids = previous.get(workspace.workspaceId);
      if (!ids) continue; // Workspace entry/addition owns its initial read.
      const view = readStateRef.current.views.find((item) => item.workspaceId === workspace.workspaceId);
      if (!workspace.sessionIds.some((id) => !ids.includes(id) &&
          !view?.bindings.some((binding) => binding.sessionId === id))) continue;
      // A new native member is not evidence of an absent binding. Retire reads
      // that started before its arrival, even while native mode is active.
      viewReader.invalidate(workspace.workspaceId);
      guardFor(workspace.workspaceId).invalidate();
      if (mode === 'worktree') void refresh({
        scope: { kind: 'workspace', workspaceId: workspace.workspaceId }, alreadyInvalidated: true,
      });
    }
  }, [source.workspaces.items, source.workspaces.phase, mode, refresh, viewReader]);
  useEffect(() => {
    if (mode !== 'worktree' || isPendingListPhase(source.workspaces.phase)) return;
    for (const view of readState.views) {
      if (view.knownSessionIds === undefined || readState.targetErrors?.[view.workspaceId]) continue;
      const ids = source.workspaces.items.find((item) => item.workspaceId === view.workspaceId)?.sessionIds ?? [];
      const unknown = ids.filter((id) => !view.knownSessionIds!.includes(id) &&
        !view.bindings.some((binding) => binding.sessionId === id));
      const pending = targetReads.current.get(view.workspaceId);
      if (!unknown.length || (pending?.pending && unknown.every((id) => pending.sessionIds.includes(id)))) continue;
      // A shared Context read may predate the Surface's first native snapshot.
      // Keep unknown members hidden and validate them with a new generation.
      void refresh({ scope: { kind: 'workspace', workspaceId: view.workspaceId } });
    }
  }, [readState.views, readState.targetErrors, source.workspaces.items, source.workspaces.phase, mode, refresh]);
  useEffect(() => {
    if (mode === 'worktree') {
      void refresh({ preserveCurrent: true, reuseInFlight: true });
    } else {
      refreshGuard.current.invalidate();
      for (const guard of targetRefreshGuards.current.values()) guard.invalidate();
      targetReads.current.clear();
      modalReadLoader.current.invalidate();
      modalReadViewRef.current = undefined;
      setWorktreeModalWorkspaceId(undefined);
      setModalReadError(undefined);
      setModalReadLoading(false);
      // Keep ready content for immediate reuse on re-entry.
    }
  }, [mode, refresh]);
  const previousWorkspaceIdsRef = useRef<readonly string[]>(workspaceIds);
  useEffect(() => {
    if (isPendingListPhase(source.workspaces.phase)) return;
    const previousWorkspaceIds = previousWorkspaceIdsRef.current;
    previousWorkspaceIdsRef.current = workspaceIds;

    const addedWorkspaceIds = workspaceIds.filter(
      (workspaceId) => !previousWorkspaceIds.includes(workspaceId),
    );
    const removedWorkspaceIds = previousWorkspaceIds.filter(
      (workspaceId) => !workspaceIds.includes(workspaceId),
    );
    for (const workspaceId of removedWorkspaceIds) {
      targetRefreshGuards.current.get(workspaceId)?.invalidate();
      targetRefreshGuards.current.delete(workspaceId);
      targetReads.current.delete(workspaceId);
      viewReader.invalidate(workspaceId);
      syncedMembershipViews.current.delete(workspaceId);
      props.syncWorkspaceSessions?.(workspaceId, []);
    }
    setReadState((current) => {
      const views = mergeWorktreeViews(current.views, workspaceIds, []);
      const targetErrors = Object.fromEntries(Object.entries(current.targetErrors ?? {})
        .filter(([workspaceId]) => workspaceIds.includes(workspaceId)));
      return { ...current, views, targetErrors };
    });
    if (mode !== 'worktree') return;
    for (const workspaceId of addedWorkspaceIds) {
      void refresh({
        scope: { kind: 'workspace', workspaceId },
        preserveCurrent: true,
        ensureLoaded: true,
      }).catch(() => {
        // The target error remains visible and can be retried explicitly.
      });
    }
  }, [mode, refresh, workspaceIds, source.workspaces.phase, viewReader]);
  useEffect(() => {
    if (forkRecoveryRevisionRef.current === forkRecoverySnapshot.revision) return;
    forkRecoveryRevisionRef.current = forkRecoverySnapshot.revision;
    if (mode !== 'worktree' || manager === undefined) return;
    if (forkRecoverySnapshot.affectedWorkspaceIds.length === 0) return;
    void refresh({
      scope: {
        kind: 'workspaces',
        workspaceIds: forkRecoverySnapshot.affectedWorkspaceIds,
      },
      preserveCurrent: readStateRef.current.status === 'ready',
    }).catch(() => {
      // Recovery state remains visible; the next explicit retry can refresh it again.
    });
  }, [
    forkRecoverySnapshot.affectedWorkspaceIds,
    forkRecoverySnapshot.revision,
    manager,
    mode,
    refresh,
  ]);
  useEffect(() => {
    if (readState.status !== 'ready' || isPendingListPhase(source.workspaces.phase)) return;
    if (props.syncWorkspaceSessions) {
      for (const view of readState.views) {
        if (syncedMembershipViews.current.get(view.workspaceId) === view ||
            targetReads.current.get(view.workspaceId)?.pending) continue;
        syncedMembershipViews.current.set(view.workspaceId, view);
        props.syncWorkspaceSessions(view.workspaceId, view.bindings);
      }
      return;
    }
    // Legacy injected surfaces have only a full-snapshot synchronization port.
    if (syncSessionWorkspaces === undefined ||
        [...targetReads.current.values()].some((request) => request.pending) ||
        !isCompleteWorktreeWorkspaceSnapshot(workspaceIds, readState.views)) return;
    syncSessionWorkspaces(
      readState.views.flatMap((view) =>
        view.bindings.map((binding) => ({
          workspaceId: binding.workspaceId,
          sessionId: binding.sessionId,
        })),
      ),
    );
  }, [readState.status, readState.views, syncSessionWorkspaces, props.syncWorkspaceSessions, workspaceIds, source.workspaces.phase]);
  const viewByWorkspace = useMemo(
    () => new Map(readState.views.map((view) => [view.workspaceId, view])),
    [readState.views],
  );
  const previousActivityRef = useRef(sessionPresentations);
  useEffect(() => {
    const previous = previousActivityRef.current;
    previousActivityRef.current = sessionPresentations;
    if (mode !== 'worktree') return;
    const affected = worktreeActivityRefreshWorkspaceIds(
      readStateRef.current.views,
      previous,
      sessionPresentations,
    );
    if (affected.length > 0)
      void refresh({
        scope: { kind: 'workspaces', workspaceIds: affected },
        preserveCurrent: true,
      });
  }, [mode, refresh, sessionPresentations]);
  return {
    readState,
    setReadState,
    readStateRef,
    refreshGuard,
    targetRefreshGuards,
    forkRecoveryRevisionRef,
    guardFor,
    refresh,
    loadModalWorktreeView,
    previousWorkspaceIdsRef,
    viewByWorkspace,
    previousActivityRef,
  };
}
