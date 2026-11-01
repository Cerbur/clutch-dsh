import { useMemo, useRef, useSyncExternalStore } from 'react';
import {
  deriveSessionPresentationIndex,
  type SessionListLike,
} from '../../session/session-view.js';
import { useSidebarOverlayGeometry } from '../../overlay/sidebar-overlay-geometry.js';
import { effectiveViewMode } from '../../view/view-mode.js';
import { currentSessionIdFromList } from '../../session/session-selection.js';
import {
  EMPTY_FORK_RECOVERY_STORE,
  useStableWorkspaceIds,
} from '../shared.js';
import type { WorkspaceListLike, WorktreeSurfaceProps } from '../types.js';

type Input = {
  props: Pick<
    WorktreeSurfaceProps,
    | 'useStore'
    | 'available'
    | 'manager'
    | 'useSessions'
    | 'useSessionStatus'
    | 'useWorkspaces'
    | 'forkRecovery'
    | 'expandState'
    | 'sessionOrder'
  >;
};

export function useSurfaceSources({ props }: Input) {
  const {
    useStore,
    available,
    manager,
    useSessions,
    useSessionStatus,
    useWorkspaces,
    forkRecovery,
    expandState,
    sessionOrder,
  } = props;
  const preferredMode = useStore((state) => state.viewMode);
  const mode = effectiveViewMode(preferredMode, available && manager !== undefined);
  const sessions = useSessions((state) => state) as SessionListLike;
  // Root hook is absent on legacy clients; do not create a second unread owner.
  const sessionStatuses = useSessionStatus?.((state) => state);
  const workspaces = useWorkspaces((state) => state) as WorkspaceListLike;
  const forkRecoveryStore = forkRecovery ?? EMPTY_FORK_RECOVERY_STORE;
  const forkRecoverySnapshot = useSyncExternalStore(
    forkRecoveryStore.subscribe,
    forkRecoveryStore.getSnapshot,
    forkRecoveryStore.getSnapshot,
  );
  const currentSessionId = currentSessionIdFromList(sessions);
  const workspaceIds = useStableWorkspaceIds(workspaces.items);
  const workspaceIdsRef = useRef(workspaceIds);
  workspaceIdsRef.current = workspaceIds;
  const expandSnapshot = useSyncExternalStore(
    expandState.subscribe,
    expandState.getSnapshot,
    expandState.getSnapshot,
  );
  const sessionOrderSnapshot = useSyncExternalStore(
    sessionOrder.subscribe,
    sessionOrder.getSnapshot,
    sessionOrder.getSnapshot,
  );
  const sessionPresentations = useMemo(
    () => deriveSessionPresentationIndex(sessions, sessionStatuses),
    [sessions.byId, sessionStatuses],
  );
  const { ref, width, bounds, collapsed, nativeCovered } = useSidebarOverlayGeometry(
    mode === 'worktree',
  );
  const archivedSessionIds = workspaces.archivedSessionIds ?? [];
  return {
    preferredMode,
    mode,
    sessions,
    workspaces,
    forkRecoveryStore,
    forkRecoverySnapshot,
    currentSessionId,
    workspaceIds,
    workspaceIdsRef,
    expandSnapshot,
    sessionOrderSnapshot,
    sessionPresentations,
    ref,
    width,
    bounds,
    collapsed,
    nativeCovered,
    archivedSessionIds,
  };
}
