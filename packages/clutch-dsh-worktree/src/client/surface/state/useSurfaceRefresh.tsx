import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createWorktreeRefreshGuard,
  mergeWorktreeView,
  mergeWorktreeViews,
  toWorktreeViewError,
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
    'manager' | 'viewReader' | 'invalidateWorktreeContext' | 'syncSessionWorkspaces'
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
        refreshGuard.current.invalidate();
        for (const guard of targetRefreshGuards.current.values()) guard.invalidate();
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
          options.invalidateContext === false ? undefined : invalidateWorktreeContext?.();
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
      if (selectedWorkspaceIds.length === 0) return;

      await Promise.allSettled(
        selectedWorkspaceIds.map(async (workspaceId) => {
          const guard = guardFor(workspaceId);
          viewReader.invalidate(workspaceId, { reuseInFlight: options.reuseInFlight });
          const contextRefresh =
            options.invalidateContext === false
              ? undefined
              : invalidateWorktreeContext?.(workspaceId);
          const generation = guard.begin();
          try {
            const view = await viewReader.read(workspaceId);
            if (!guard.isCurrent(generation)) return;
            if (!workspaceIdsRef.current.includes(workspaceId)) return;
            setReadState((current) => {
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
          } catch (error) {
            if (!guard.isCurrent(generation)) return;
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
            await contextRefresh?.catch(() => undefined);
          }
        }),
      );
    },
    [invalidateWorktreeContext, manager, viewReader],
  );
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
