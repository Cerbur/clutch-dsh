import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { deriveSessionPresentationIndex, type SessionListLike } from '../../session/session-view.js';
import { useSidebarOverlayGeometry } from '../../overlay/sidebar-overlay-geometry.js';
import { effectiveViewMode } from '../../view/view-mode.js';
import {
  EMPTY_FORK_RECOVERY_STORE,
  EMPTY_FULL_ACCESS_CONFIRMATION_SNAPSHOT,
  EMPTY_FULL_ACCESS_CONFIRMATION_SUBSCRIBE,
  EMPTY_PERMISSION_NOTICE_SNAPSHOT,
  EMPTY_PERMISSION_NOTICE_SUBSCRIBE,
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
    | 'useWorkspaces'
    | 'forkRecovery'
    | 'expandState'
    | 'permissionNotice'
    | 'fullAccessConfirmation'
    | 'sessionOrder'
  >;
};

export function useSurfaceSources({ props }: Input) {
  const {
    useStore,
    available,
    manager,
    useSessions,
    useWorkspaces,
    forkRecovery,
    expandState,
    permissionNotice,
    fullAccessConfirmation,
    sessionOrder,
  } = props;
  const preferredMode = useStore((state) => state.viewMode);
  const mode = effectiveViewMode(preferredMode, available && manager !== undefined);
  const sessions = useSessions((state) => state) as SessionListLike;
  const workspaces = useWorkspaces((state) => state) as WorkspaceListLike;
  const forkRecoveryStore = forkRecovery ?? EMPTY_FORK_RECOVERY_STORE;
  const forkRecoverySnapshot = useSyncExternalStore(
    forkRecoveryStore.subscribe,
    forkRecoveryStore.getSnapshot,
    forkRecoveryStore.getSnapshot,
  );
  const currentSessionId = sessions.current;
  const workspaceIds = useStableWorkspaceIds(workspaces.items);
  const workspaceIdsRef = useRef(workspaceIds);
  workspaceIdsRef.current = workspaceIds;
  const expandSnapshot = useSyncExternalStore(
    expandState.subscribe,
    expandState.getSnapshot,
    expandState.getSnapshot,
  );
  const permissionNoticeSnapshot = useSyncExternalStore(
    permissionNotice?.subscribe ?? EMPTY_PERMISSION_NOTICE_SUBSCRIBE,
    permissionNotice?.getSnapshot ?? EMPTY_PERMISSION_NOTICE_SNAPSHOT,
    permissionNotice?.getSnapshot ?? EMPTY_PERMISSION_NOTICE_SNAPSHOT,
  );
  const fullAccessConfirmationSnapshot = useSyncExternalStore(
    fullAccessConfirmation?.subscribe ?? EMPTY_FULL_ACCESS_CONFIRMATION_SUBSCRIBE,
    fullAccessConfirmation?.getSnapshot ?? EMPTY_FULL_ACCESS_CONFIRMATION_SNAPSHOT,
    fullAccessConfirmation?.getSnapshot ?? EMPTY_FULL_ACCESS_CONFIRMATION_SNAPSHOT,
  );
  const fullAccessConfirmationKey =
    fullAccessConfirmationSnapshot === undefined
      ? ''
      : [
          fullAccessConfirmationSnapshot.workspaceId,
          fullAccessConfirmationSnapshot.worktreeId,
          fullAccessConfirmationSnapshot.sessionId,
          fullAccessConfirmationSnapshot.cwd,
        ].join('\u0000');
  const [fullAccessAcknowledged, setFullAccessAcknowledged] = useState(false);
  useEffect(() => {
    setFullAccessAcknowledged(false);
  }, [fullAccessConfirmationKey]);
  const sessionOrderSnapshot = useSyncExternalStore(
    sessionOrder.subscribe,
    sessionOrder.getSnapshot,
    sessionOrder.getSnapshot,
  );
  const sessionPresentations = useMemo(
    () => deriveSessionPresentationIndex(sessions),
    [sessions.byId],
  );
  const { ref, width, bounds } = useSidebarOverlayGeometry(mode === 'worktree');
  const collapsed = width <= 64;
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
    permissionNoticeSnapshot,
    fullAccessConfirmationSnapshot,
    fullAccessConfirmationKey,
    fullAccessAcknowledged,
    setFullAccessAcknowledged,
    sessionOrderSnapshot,
    sessionPresentations,
    ref,
    width,
    bounds,
    collapsed,
    archivedSessionIds,
  };
}
