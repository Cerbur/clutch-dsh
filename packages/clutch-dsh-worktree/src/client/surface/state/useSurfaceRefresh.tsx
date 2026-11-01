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
import { worktreeActivityRefreshWorkspaceIds } from '../selectors.js';
import { EMPTY_READ_STATE } from '../shared.js';
import type { ReadState, RefreshOptions, WorktreeSurfaceProps } from '../types.js';
import type { useRegistrationState } from './useRegistrationState.js';
import type { useSurfaceSources } from './useSurfaceSources.js';

type Input = {
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    'forkRecoverySnapshot' | 'workspaceIdsRef' | 'mode' | 'workspaceIds' | 'sessionPresentations'
  >;
  props: Pick<
    WorktreeSurfaceProps,
    'manager' | 'viewReader' | 'invalidateWorktreeContext' | 'syncSessionWorkspaces' | 'subscribeToolChanges'
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
  const { forkRecoverySnapshot, workspaceIdsRef, mode, workspaceIds, sessionPresentations } =
    source;
  const { manager, viewReader, invalidateWorktreeContext, syncSessionWorkspaces } = props;
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
  const refreshGuard = useRef(createWorktreeRefreshGuard());
  const targetRefreshGuards = useRef(
    new Map<string, ReturnType<typeof createWorktreeRefreshGuard>>(),
  );
  const targetReads = useRef(new Map<string, {
    generation: number;
    promise: Promise<WorktreeWorkspaceView>;
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
      const preserveCurrent = options.preserveCurrent === true;
      const currentWorkspaceIds = workspaceIdsRef.current;

      if (scope.kind === 'global') {
        if (!preserveCurrent) {
          setReadState({ status: 'loading', views: [] });
        }
        const selectedWorkspaceIds = [...currentWorkspaceIds];
        for (const workspaceId of selectedWorkspaceIds) {
          viewReader.invalidate(workspaceId);
        }
        const contextRefresh =
          options.invalidateContext === false ? undefined
            : invalidateWorktreeContext?.(undefined, { alreadyInvalidated: true });
        await refreshGuard.current.run(
          async () => {
            const [views] = await Promise.all([
              viewReader.readMany(selectedWorkspaceIds),
              contextRefresh ?? Promise.resolve(),
            ]);
            return views;
          },
          (views) => {
            setReadState((current) => {
              const merged = mergeWorktreeViews(current.views, workspaceIdsRef.current, views);
              return {
                status: 'ready',
                views:
                  modalReadViewRef.current === undefined
                    ? merged
                    : mergeWorktreeView(merged, modalReadViewRef.current),
              };
            });
          },
          (error) => {
            if (preserveCurrent) throw error;
            setReadState({
              status: 'error',
              views: modalReadViewRef.current === undefined ? [] : [modalReadViewRef.current],
              error: toWorktreeViewError(error),
            });
          },
        );
        return;
      }

      const requestedWorkspaceIds =
        scope.kind === 'workspace' ? [scope.workspaceId] : scope.workspaceIds;
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
          if (!options.alreadyInvalidated) {
            viewReader.invalidate(workspaceId, {
              reuseInFlight: options.reuseInFlight, changeId: options.changeId,
            });
          }
          const contextRefresh =
            options.invalidateContext === false
              ? undefined
              : invalidateWorktreeContext?.(workspaceId, { alreadyInvalidated: true })
                ?.catch(() => undefined);
          let request = { generation: guard.begin(), promise: viewReader.read(workspaceId) };
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
            if (opening && (!workspaceIdsRef.current.includes(workspaceId) ||
              !view.worktrees.some((record) => record.worktreeId === opening.worktreeId) ||
              !view.bindings.some((binding) => binding.sessionId === opening.sessionId &&
                binding.worktreeId === opening.worktreeId && binding.status === 'active'))) {
              throw new WorktreeSessionActionError('WORKTREE_SESSION_REPAIR_REQUIRED', 'binding projection not ready', true);
            }
            if (!guard.isCurrent(request.generation)) return;
            if (!workspaceIdsRef.current.includes(workspaceId)) return;
            const publish = () => setReadState((current) => {
              const remainingTargetError =
                current.targetError?.workspaceIds.filter(
                  (candidate) => candidate !== workspaceId,
                ) ?? [];
              const next = {
                ...current,
                status: 'ready' as const,
                views: mergeWorktreeViews(current.views, workspaceIdsRef.current, [view]),
                error: undefined,
              };
              if (remainingTargetError.length === 0) {
                const withoutTargetError = { ...next };
                delete withoutTargetError.targetError;
                return withoutTargetError;
              }
              return {
                ...next,
                targetError: {
                  workspaceIds: remainingTargetError,
                  error: current.targetError!.error,
                },
              };
            });
            // Native navigation updates an external store synchronously. Commit its
            // destination first so that the newly current blank row cannot enter Local.
            if (options.openingSession) flushSync(publish);
            else publish();
          } catch (error) {
            if (options.openingSession) throw error;
            if (!guard.isCurrent(request.generation)) return;
            if (!workspaceIdsRef.current.includes(workspaceId)) return;
            setReadState((current) => {
              const previousIds = current.targetError?.workspaceIds ?? [];
              return {
                ...current,
                status: 'ready',
                views: mergeWorktreeViews(current.views, workspaceIdsRef.current, []),
                error: undefined,
                targetError: {
                  workspaceIds: [...new Set([...previousIds, workspaceId])],
                  error: {
                    ...toWorktreeViewError(error),
                    retryable: true,
                  },
                },
              };
            });
          } finally {
            // Opening requires the destination grouping, not completion of the old
            // Session's context refresh (which may follow further invalidations).
            // Keep refreshing in the background, including when reusing a Session.
            if (!options.openingSession) await contextRefresh;
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
      void modalReadLoader.current.load(
        workspaceId,
        (view) => {
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
  useEffect(() => {
    if (mode === 'worktree') {
      void refresh({ preserveCurrent: readStateRef.current.status === 'ready' });
    } else {
      refreshGuard.current.invalidate();
      for (const guard of targetRefreshGuards.current.values()) guard.invalidate();
      targetReads.current.clear();
      modalReadLoader.current.invalidate();
      modalReadViewRef.current = undefined;
      setWorktreeModalWorkspaceId(undefined);
      setModalReadError(undefined);
      setModalReadLoading(false);
      setReadState(EMPTY_READ_STATE);
    }
  }, [mode, refresh]);
  const previousWorkspaceIdsRef = useRef<readonly string[]>(workspaceIds);
  useEffect(() => {
    const previousWorkspaceIds = previousWorkspaceIdsRef.current;
    previousWorkspaceIdsRef.current = workspaceIds;
    if (mode !== 'worktree') return;

    const addedWorkspaceIds = workspaceIds.filter(
      (workspaceId) => !previousWorkspaceIds.includes(workspaceId),
    );
    const removedWorkspaceIds = previousWorkspaceIds.filter(
      (workspaceId) => !workspaceIds.includes(workspaceId),
    );
    for (const workspaceId of removedWorkspaceIds) {
      targetRefreshGuards.current.delete(workspaceId);
      targetReads.current.delete(workspaceId);
    }
    setReadState((current) => {
      const views = mergeWorktreeViews(current.views, workspaceIds, []);
      const remainingTargetError =
        current.targetError?.workspaceIds.filter((workspaceId) =>
          workspaceIds.includes(workspaceId),
        ) ?? [];
      const next = { ...current, views };
      if (remainingTargetError.length === 0) {
        const withoutTargetError = { ...next };
        delete withoutTargetError.targetError;
        return withoutTargetError;
      }
      return {
        ...next,
        targetError: {
          workspaceIds: remainingTargetError,
          error: current.targetError!.error,
        },
      };
    });
    for (const workspaceId of addedWorkspaceIds) {
      void refresh({
        scope: { kind: 'workspace', workspaceId },
        preserveCurrent: true,
      }).catch(() => {
        // The target error remains visible and can be retried explicitly.
      });
    }
  }, [mode, refresh, workspaceIds]);
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
    if (readState.status !== 'ready' || syncSessionWorkspaces === undefined) return;
    syncSessionWorkspaces(
      readState.views.flatMap((view) =>
        view.bindings.map((binding) => ({
          workspaceId: binding.workspaceId,
          sessionId: binding.sessionId,
        })),
      ),
    );
  }, [readState.status, readState.views, syncSessionWorkspaces]);
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
