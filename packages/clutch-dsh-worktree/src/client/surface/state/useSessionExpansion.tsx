import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  isMainExpanded,
  isWorkspaceExpanded,
  isWorktreeExpanded,
} from '../../view/worktree-expand-state.js';
import { scrollCurrentSessionIntoView } from '../../session/worktree-session-position.js';
import {
  clearSessionGroupExpansion,
  currentSessionRevealKeys,
  isCompleteWorktreeWorkspaceSnapshot,
  resolveCurrentSessionLocation,
} from '../selectors.js';
import { CurrentSessionRevealState, ExpandedSessionGroups } from '../shared.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useSurfaceRefresh } from './useSurfaceRefresh.js';
import type { useSurfaceSources } from './useSurfaceSources.js';

type Input = {
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'readState' | 'viewByWorkspace'>;
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    'currentSessionId' | 'workspaces' | 'mode' | 'ref' | 'expandSnapshot' | 'workspaceIds'
  >;
  props: Pick<WorktreeSurfaceProps, 'expandState'>;
};

export function useSessionExpansion({ read, source, props }: Input) {
  const { readState, viewByWorkspace } = read;
  const { currentSessionId, workspaces, mode, ref, expandSnapshot, workspaceIds } = source;
  const { expandState } = props;
  const [searchQuery, setSearchQuery] = useState('');
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchRoot = useRef<HTMLDivElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const [currentSessionReveal, setCurrentSessionReveal] = useState<CurrentSessionRevealState>();
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  useEffect(() => {
    if (!searchExpanded) return;
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true)
        return;
      searchInput.current?.blur();
      if (searchQuery.trim() !== '') return;
      setSearchExpanded(false);
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
    };
  }, [searchExpanded, searchQuery]);
  useEffect(() => {
    if (searchExpanded) {
      searchInput.current?.focus({ preventScroll: true });
    }
  }, [searchExpanded]);
  const locateGenerationRef = useRef(0);
  const positionedLocateGenerationRef = useRef<number>();
  const [expandedArchivedWorkspaces, setExpandedArchivedWorkspaces] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<ExpandedSessionGroups>({});
  const query = searchQuery.trim().toLocaleLowerCase();
  const currentSessionLocation = useMemo(
    () =>
      readState.status === 'ready'
        ? resolveCurrentSessionLocation(currentSessionId, workspaces.items, readState.views)
        : undefined,
    [currentSessionId, readState.status, readState.views, workspaces.items],
  );
  const currentRevealKeys = useMemo(
    () => new Set(currentSessionRevealKeys(currentSessionLocation)),
    [currentSessionLocation],
  );
  const isCurrentSessionReveal = (key: string): boolean =>
    currentSessionReveal !== undefined &&
    currentSessionReveal.sessionId === currentSessionId &&
    currentRevealKeys.has(key) &&
    currentSessionReveal.suppressedKeys[key] !== true;
  useLayoutEffect(() => {
    locateGenerationRef.current += 1;
    positionedLocateGenerationRef.current = undefined;
    if (mode !== 'worktree') {
      setCurrentSessionReveal(undefined);
      setSearchExpanded(false);
      return;
    }
    if (searchQueryRef.current.trim().length > 0) {
      setSearchQuery('');
      setSearchExpanded(false);
    }
    setCurrentSessionReveal(
      currentSessionId === undefined
        ? undefined
        : { sessionId: currentSessionId, suppressedKeys: {} },
    );
  }, [currentSessionId, mode]);
  useLayoutEffect(() => {
    if (
      mode !== 'worktree' ||
      currentSessionId === undefined ||
      currentSessionLocation === undefined
    ) {
      return;
    }
    const generation = locateGenerationRef.current;
    if (positionedLocateGenerationRef.current === generation) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled || generation !== locateGenerationRef.current) return;
      if (!scrollCurrentSessionIntoView(ref.current, currentSessionId)) return;
      positionedLocateGenerationRef.current = generation;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [
    currentSessionId,
    currentSessionLocation,
    currentSessionReveal,
    expandSnapshot,
    mode,
    query,
    readState.status,
  ]);
  useEffect(() => {
    if (
      readState.status !== 'ready' ||
      !isCompleteWorktreeWorkspaceSnapshot(workspaceIds, readState.views)
    )
      return;
    expandState.actions.retain(
      workspaceIds,
      readState.views.flatMap((view) => view.worktrees.map((record) => record.worktreeId)),
    );
  }, [expandState, readState.status, readState.views, workspaceIds]);
  const clearSessionGroups = (groupKeys: readonly string[]): void => {
    if (groupKeys.length === 0) return;
    setExpandedSessionGroups((current) => clearSessionGroupExpansion(current, groupKeys));
  };
  const suppressCurrentSessionReveal = (key: string): boolean => {
    if (!isCurrentSessionReveal(key)) return false;
    setCurrentSessionReveal((current) => {
      if (current === undefined || current.sessionId !== currentSessionId) return current;
      return {
        ...current,
        suppressedKeys: { ...current.suppressedKeys, [key]: true },
      };
    });
    return true;
  };
  const toggleWorkspace = (workspaceId: string): void => {
    const persistedExpanded = isWorkspaceExpanded(expandSnapshot, workspaceId);
    const autoExpanded = isCurrentSessionReveal('workspace:' + workspaceId);
    const visuallyExpanded = persistedExpanded || autoExpanded;
    if (visuallyExpanded && autoExpanded) {
      suppressCurrentSessionReveal('workspace:' + workspaceId);
    }
    if (visuallyExpanded && !persistedExpanded) {
      clearSessionGroups([
        'main:' + workspaceId,
        ...(
          viewByWorkspace.get(workspaceId)?.worktrees.map((record) => record.worktreeId) ?? []
        ).map((worktreeId) => 'worktree:' + worktreeId),
      ]);
      return;
    }
    expandState.actions.toggleWorkspace(workspaceId);
    if (visuallyExpanded) {
      clearSessionGroups([
        'main:' + workspaceId,
        ...(
          viewByWorkspace.get(workspaceId)?.worktrees.map((record) => record.worktreeId) ?? []
        ).map((worktreeId) => 'worktree:' + worktreeId),
      ]);
    }
  };
  const toggleMain = (workspaceId: string): void => {
    const persistedExpanded = isMainExpanded(expandSnapshot, workspaceId);
    const autoExpanded = isCurrentSessionReveal('main:' + workspaceId);
    const visuallyExpanded = persistedExpanded || autoExpanded;
    if (visuallyExpanded && autoExpanded) {
      suppressCurrentSessionReveal('main:' + workspaceId);
    }
    if (visuallyExpanded && !persistedExpanded) {
      clearSessionGroups(['main:' + workspaceId]);
      return;
    }
    expandState.actions.toggleMain(workspaceId);
    if (visuallyExpanded) clearSessionGroups(['main:' + workspaceId]);
  };
  const toggleWorktree = (worktreeId: string): void => {
    const persistedExpanded = isWorktreeExpanded(expandSnapshot, worktreeId);
    const autoExpanded = isCurrentSessionReveal('worktree:' + worktreeId);
    const visuallyExpanded = persistedExpanded || autoExpanded;
    if (visuallyExpanded && autoExpanded) {
      suppressCurrentSessionReveal('worktree:' + worktreeId);
    }
    if (visuallyExpanded && !persistedExpanded) {
      clearSessionGroups(['worktree:' + worktreeId]);
      return;
    }
    expandState.actions.toggleWorktree(worktreeId);
    if (visuallyExpanded) clearSessionGroups(['worktree:' + worktreeId]);
  };
  const toggleArchivedWorkspace = (workspaceId: string): void => {
    const archivedKey = 'archived:' + workspaceId;
    const autoExpanded = isCurrentSessionReveal(archivedKey);
    const persistedExpanded = expandedArchivedWorkspaces[workspaceId] === true;
    const visuallyExpanded = persistedExpanded || autoExpanded;
    if (visuallyExpanded && autoExpanded) {
      suppressCurrentSessionReveal(archivedKey);
    }
    setExpandedArchivedWorkspaces((current) => ({
      ...current,
      [workspaceId]: !visuallyExpanded,
    }));
  };
  const toggleSessionGroup = (groupKey: string, autoExpanded: boolean): void => {
    const transientExpanded = expandedSessionGroups[groupKey] === true;
    if (autoExpanded) {
      suppressCurrentSessionReveal('session-group:' + groupKey);
      setExpandedSessionGroups((current) => {
        const next = { ...current };
        delete next[groupKey];
        return next;
      });
      return;
    }
    setExpandedSessionGroups((current) => ({
      ...current,
      [groupKey]: !transientExpanded,
    }));
  };
  return {
    searchQuery,
    setSearchQuery,
    searchExpanded,
    setSearchExpanded,
    searchRoot,
    searchInput,
    currentSessionReveal,
    setCurrentSessionReveal,
    searchQueryRef,
    locateGenerationRef,
    positionedLocateGenerationRef,
    expandedArchivedWorkspaces,
    setExpandedArchivedWorkspaces,
    expandedSessionGroups,
    setExpandedSessionGroups,
    query,
    currentSessionLocation,
    currentRevealKeys,
    isCurrentSessionReveal,
    clearSessionGroups,
    suppressCurrentSessionReveal,
    toggleWorkspace,
    toggleMain,
    toggleWorktree,
    toggleArchivedWorkspace,
    toggleSessionGroup,
  };
}
