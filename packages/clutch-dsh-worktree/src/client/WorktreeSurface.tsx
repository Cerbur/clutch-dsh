import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  IconBranchOutline16,
  IconCloseOutline16,
  IconProjectAddOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { WorktreeRecord } from '../contract/index.js';
import { openWorktreeSession } from './navigation.js';
import { useSidebarOverlayGeometry } from './sidebar-overlay-geometry.js';
import {
  isMainExpanded,
  isWorkspaceExpanded,
  isWorktreeExpanded,
} from './worktree-expand-state.js';
import { effectiveViewMode, unboundSessionIds, workspaceSessionIds } from './view-mode.js';
import {
  formatWorktreePermissionNotice,
  formatWorktreeViewError,
} from './worktree-error-copy.js';
import {
  filterVisibleSessionIds,
  sessionMatchesQuery,
  type SessionListLike,
} from './session-view.js';
import { retryWorktreeSessionBinding } from './worktree-session.js';
import {
  WorktreeCreateDialog,
  WorktreeRemovalDialog,
  WorktreeSessionRenameDialog,
  WorktreeWorkspaceDeleteDialog,
  WorktreeWorkspaceRenameDialog,
} from './worktree-surface-dialogs.js';
import {
  bindingIdsFor,
  clearSessionGroupExpansion,
  includesText,
  isCompleteWorktreeWorkspaceSnapshot,
  currentSessionRevealKeys,
  resolveCurrentSessionLocation,
  workspaceMatches,
} from './worktree-surface-selectors.js';
import { scrollCurrentSessionIntoView } from './worktree-session-position.js';
import {
  WorktreeGroupRow,
  WorktreeSessionGroup,
  WorktreeWorkspaceRow,
} from './worktree-surface-rows.js';
import type {
  PendingSessionBinding,
  ImportCandidatesState,
  ReadState,
  RefreshOptions,
  SessionDragState,
  SessionRenameTarget,
  WorktreeSetupStatus,
  WorktreeSurfaceProps,
  WorkspaceDeleteTarget,
  WorkspaceDragState,
  WorkspaceLike,
  WorkspaceListLike,
  WorkspaceRenameTarget,
  WorktreeDragState,
  WorktreeRegistrationMode,
  WorktreePermissionNotice,
} from './worktree-surface-types.js';
import type { WorktreeFullAccessConfirmationInput } from './worktree-permission.js';
import {
  executeWorktreeAction,
  createDefaultWorktreeName,
  createWorktreeModalViewLoader,
  createWorktreeRefreshGuard,
  filterArchivedSessionIds,
  loadWorktreeViews,
  mergeWorktreeView,
  reconcileBaseBranchSelection,
  resolveWorktreeMove,
  selectDefaultBaseBranch,
  stableWorkspaceIds,
  toRetryableWorktreeOrderError,
  toWorktreeViewError,
  WorktreeSessionBindingError,
  WorktreeSessionPermissionError,
  type CreateSessionForWorktreeInput,
  type WorktreeViewError,
  type WorktreeWorkspaceView,
} from './worktree-view.js';
import styles from './worktree.css';

export type {
  WorktreeSurfaceInjected,
  WorktreeSurfaceProps,
} from './worktree-surface-types.js';

function toNativeWorktreeViewError(error: unknown): WorktreeViewError {
  const viewError = toWorktreeViewError(error);
  if (typeof error === 'object' && error !== null) return viewError;
  return { ...viewError, message: String(error) };
}

const EMPTY_READ_STATE: ReadState = { status: 'idle', views: [] };
const EMPTY_PERMISSION_NOTICE: WorktreePermissionNotice | undefined = undefined;
const EMPTY_PERMISSION_NOTICE_SUBSCRIBE = (): (() => void) => () => {};
const EMPTY_PERMISSION_NOTICE_SNAPSHOT = (): WorktreePermissionNotice | undefined =>
  EMPTY_PERMISSION_NOTICE;
const EMPTY_FULL_ACCESS_CONFIRMATION_SUBSCRIBE = (): (() => void) => () => {};
const EMPTY_FULL_ACCESS_CONFIRMATION_SNAPSHOT =
  (): WorktreeFullAccessConfirmationInput | undefined => undefined;
type ExpandedSessionGroups = Record<string, boolean>;

interface CurrentSessionRevealState {
  readonly sessionId: string;
  readonly suppressedKeys: Readonly<Record<string, true>>;
}

function useStableWorkspaceIds(workspaces: readonly WorkspaceLike[]): readonly string[] {
  const next = workspaces.map((workspace) => workspace.workspaceId);
  const previousRef = useRef<readonly string[]>([]);
  const stable = stableWorkspaceIds(previousRef.current, next);
  if (stable !== previousRef.current) previousRef.current = stable;
  return previousRef.current;
}

/**
 * Peer Worktree navigation surface. It keeps the original DSH Workspace mode
 * intact and renders a browser-local Workspace → Worktree → Session projection.
 */
export function WorktreeSurface({
  useStore,
  actions,
  useSessions,
  useWorkspaces,
  t,
  available,
  expandState,
  manager,
  permission,
  confirmFullAccess,
  fullAccessConfirmation,
  onPermissionResult,
  onPermissionNotice,
  permissionNotice,
  invalidateWorktreeContext,
  createWorkspace,
  createSessionForWorktree: createSessionCallback,
  createMainSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  insertSessionBefore,
  insertWorktreeBefore,
  renameSession,
  forkSession,
  archiveSession,
  ensureSessionWorkspace,
  syncSessionWorkspaces,
  openSession,
}: WorktreeSurfaceProps) {
  const preferredMode = useStore((state) => state.viewMode);
  const mode = effectiveViewMode(preferredMode, available && manager !== undefined);
  const sessions = useSessions((state) => state) as SessionListLike;
  const workspaces = useWorkspaces((state) => state) as WorkspaceListLike;
  const currentSessionId = sessions.current;
  const workspaceIds = useStableWorkspaceIds(workspaces.items);
  const [readState, setReadState] = useState<ReadState>(EMPTY_READ_STATE);
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
  const fullAccessConfirmationKey = fullAccessConfirmationSnapshot === undefined
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
  const readStateRef = useRef(readState);
  readStateRef.current = readState;
  const [searchQuery, setSearchQuery] = useState('');
  const [currentSessionReveal, setCurrentSessionReveal] =
    useState<CurrentSessionRevealState>();
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const locateGenerationRef = useRef(0);
  const positionedLocateGenerationRef = useRef<number>();
  const [worktreeModalWorkspaceId, setWorktreeModalWorkspaceId] = useState<string>();
  const [modalReadError, setModalReadError] = useState<WorktreeViewError>();
  const [modalReadLoading, setModalReadLoading] = useState(false);
  const [worktreeModalMode, setWorktreeModalMode] =
    useState<WorktreeRegistrationMode>('create');
  const [importCandidates, setImportCandidates] =
    useState<ImportCandidatesState>({ status: 'idle', candidates: [] });
  const [selectedImportPath, setSelectedImportPath] = useState<string | undefined>();
  const [openWorkspaceMenuId, setOpenWorkspaceMenuId] = useState<string>();
  const [openWorktreeMenuId, setOpenWorktreeMenuId] = useState<string>();
  const [worktreeRemoval, setWorktreeRemoval] = useState<WorktreeRecord>();
  const [selectedBranch, setSelectedBranch] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [pendingSessionBinding, setPendingSessionBinding] = useState<PendingSessionBinding>();
  const [actionError, setActionError] = useState<WorktreeViewError>();
  const [actionPending, setActionPending] = useState(false);
  const [sessionRenameTarget, setSessionRenameTarget] = useState<SessionRenameTarget>();
  const [sessionRenameDraft, setSessionRenameDraft] = useState('');
  const [sessionRenamePending, setSessionRenamePending] = useState(false);
  const [sessionRenameError, setSessionRenameError] = useState<WorktreeViewError>();
  const [workspaceDrag, setWorkspaceDrag] = useState<WorkspaceDragState>();
  const [workspaceRenameTarget, setWorkspaceRenameTarget] = useState<WorkspaceRenameTarget>();
  const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState('');
  const [workspaceRenamePending, setWorkspaceRenamePending] = useState(false);
  const [workspaceRenameError, setWorkspaceRenameError] = useState<WorktreeViewError>();
  const [workspaceDeleteTarget, setWorkspaceDeleteTarget] = useState<WorkspaceDeleteTarget>();
  const [workspaceDeletePending, setWorkspaceDeletePending] = useState(false);
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState<WorktreeViewError>();
  const workspaceDropCommitted = useRef(false);
  const [sessionDrag, setSessionDrag] = useState<SessionDragState>();
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<ExpandedSessionGroups>({});
  const sessionDropCommitted = useRef(false);
  const [worktreeDrag, setWorktreeDrag] = useState<WorktreeDragState>();
  const worktreeDropCommitted = useRef(false);
  const refreshGuard = useRef(createWorktreeRefreshGuard());
  const modalReadLoader = useRef(createWorktreeModalViewLoader());
  const modalReadViewRef = useRef<WorktreeWorkspaceView>();
  const importCandidatesGuard = useRef(createWorktreeRefreshGuard());
  const modalWorkspaceIdRef = useRef(worktreeModalWorkspaceId);
  modalWorkspaceIdRef.current = worktreeModalWorkspaceId;
  const { ref, width, bounds } = useSidebarOverlayGeometry(mode === 'worktree');
  const collapsed = width <= 64;
  const query = searchQuery.trim().toLocaleLowerCase();
  const archivedSessionIds = workspaces.archivedSessionIds ?? [];
  const pendingSessionArchived = pendingSessionBinding !== undefined &&
    archivedSessionIds.includes(pendingSessionBinding.sessionId);

  const refresh = useCallback(async (options: RefreshOptions = {}): Promise<void> => {
    if (manager === undefined) {
      refreshGuard.current.invalidate();
      setReadState(EMPTY_READ_STATE);
      return;
    }
    const preserveCurrent = options.preserveCurrent === true;
    if (!preserveCurrent) {
      setReadState({ status: 'loading', views: [] });
    }
    await refreshGuard.current.run(
      () => loadWorktreeViews(manager, workspaceIds, {
        invalidateContext: options.invalidateContext !== false,
        invalidateWorktreeContext,
      }),
      (views) => {
        setReadState({
          status: 'ready',
          views: modalReadViewRef.current === undefined
            ? views
            : mergeWorktreeView(views, modalReadViewRef.current),
        });
      },
      (error) => {
        if (preserveCurrent) throw error;
        setReadState({
          status: 'error',
          views: modalReadViewRef.current === undefined
            ? []
            : [modalReadViewRef.current],
          error: toWorktreeViewError(error),
        });
      },
    );
  }, [invalidateWorktreeContext, manager, workspaceIds]);

  const loadModalWorktreeView = useCallback((workspaceId: string): void => {
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
      manager,
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
  }, [manager]);

  useEffect(() => {
    if (mode === 'worktree') {
      void refresh({ preserveCurrent: readStateRef.current.status === 'ready' });
    } else {
      refreshGuard.current.invalidate();
      modalReadLoader.current.invalidate();
      modalReadViewRef.current = undefined;
      setWorktreeModalWorkspaceId(undefined);
      setModalReadError(undefined);
      setModalReadLoading(false);
      setReadState(EMPTY_READ_STATE);
    }
  }, [mode, refresh]);

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
      return;
    }
    if (searchQueryRef.current.trim().length > 0) setSearchQuery('');
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
    ) return;
    expandState.actions.retain(
      workspaceIds,
      readState.views.flatMap((view) =>
        view.worktrees.map((record) => record.worktreeId),
      ),
    );
  }, [expandState, readState.status, readState.views, workspaceIds]);

  const modalWorkspace = workspaces.items.find(
    (workspace) => workspace.workspaceId === worktreeModalWorkspaceId,
  );
  const modalView =
    worktreeModalWorkspaceId === undefined
      ? undefined
      : viewByWorkspace.get(worktreeModalWorkspaceId);
  const modalReadiness = modalView?.readiness;
  const modalSetupStatus: WorktreeSetupStatus | undefined = modalView === undefined
    ? undefined
    : modalReadiness?.status === 'ready'
      ? modalView.branches.length === 0 ? 'noLocalBranch' : undefined
      : modalReadiness?.status;
  const modalCanCreate =
    !modalReadLoading &&
    modalSetupStatus === undefined &&
    modalReadiness?.status === 'ready';

  useEffect(() => {
    if (worktreeModalWorkspaceId === undefined || modalView === undefined) return;
    if (modalView.readiness.status !== 'ready') {
      setSelectedBranch('');
      setNewBranch('');
      return;
    }
    setSelectedBranch((current) =>
      reconcileBaseBranchSelection(current, modalView.branches),
    );
    setNewBranch((current) => {
      if (current.length > 0) return current;
      const existingNames = [
        ...modalView.branches.map((branch) => branch.name),
        ...modalView.worktrees.map((worktree) => worktree.branch),
      ];
      return createDefaultWorktreeName(existingNames);
    });
  }, [modalView, worktreeModalWorkspaceId]);

  const runMutation = async (operation: () => Promise<void>): Promise<void> => {
    setActionPending(true);
    setActionError(undefined);
    try {
      await operation();
      await refresh({ preserveCurrent: true });
    } catch (error) {
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };

  const loadImportCandidates = useCallback(async (workspaceId: string): Promise<void> => {
    if (manager === undefined) return;
    setImportCandidates((current) => ({ status: 'loading', candidates: current.candidates }));
    await importCandidatesGuard.current.run(
      () => manager.listImportCandidates({ workspaceId }),
      (candidates) => {
        if (modalWorkspaceIdRef.current !== workspaceId) return;
        setImportCandidates({ status: 'ready', candidates });
      },
      (error) => {
        if (modalWorkspaceIdRef.current !== workspaceId) return;
        setImportCandidates((current) => ({
          status: 'error',
          candidates: current.candidates,
          error: toWorktreeViewError(error),
        }));
      },
    );
  }, [manager]);

  const workspaceRenameTrimmed = workspaceRenameDraft.trim();
  const workspaceRenameDuplicate = workspaceRenameTarget !== undefined &&
    workspaceRenameTrimmed.length > 0 &&
    workspaces.items.some(
      (workspace) =>
        workspace.workspaceId !== workspaceRenameTarget.workspaceId &&
        workspace.title === workspaceRenameTrimmed,
    );
  const workspaceRenameBlocked =
    workspaceRenamePending ||
    workspaceRenameTarget === undefined ||
    workspaceRenameTrimmed.length === 0 ||
    workspaceRenameTrimmed === workspaceRenameTarget?.currentTitle ||
    workspaceRenameDuplicate;

  const openWorkspaceRename = (workspace: WorkspaceLike): void => {
    setWorkspaceRenameTarget({
      workspaceId: workspace.workspaceId,
      currentTitle: workspace.title,
    });
    setWorkspaceRenameDraft(workspace.title);
    setWorkspaceRenameError(undefined);
  };

  const closeWorkspaceRename = (): void => {
    if (workspaceRenamePending) return;
    setWorkspaceRenameTarget(undefined);
    setWorkspaceRenameError(undefined);
  };

  const confirmWorkspaceRename = async (): Promise<void> => {
    const target = workspaceRenameTarget;
    if (workspaceRenameBlocked || target === undefined) return;
    if (renameWorkspace === undefined) {
      setWorkspaceRenameError({
        code: 'WORKSPACE_RENAME_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setWorkspaceRenamePending(true);
    setWorkspaceRenameError(undefined);
    try {
      await renameWorkspace(target.workspaceId, workspaceRenameTrimmed);
      setWorkspaceRenameTarget(undefined);
    } catch (error) {
      setWorkspaceRenameError(toNativeWorktreeViewError(error));
    } finally {
      setWorkspaceRenamePending(false);
    }
  };

  const openWorkspaceDelete = (workspace: WorkspaceLike): void => {
    setWorkspaceDeleteTarget({ workspaceId: workspace.workspaceId, title: workspace.title });
    setWorkspaceDeleteError(undefined);
  };

  const closeWorkspaceDelete = (): void => {
    if (workspaceDeletePending) return;
    setWorkspaceDeleteTarget(undefined);
    setWorkspaceDeleteError(undefined);
  };

  const confirmWorkspaceDelete = async (): Promise<void> => {
    const target = workspaceDeleteTarget;
    if (target === undefined || workspaceDeletePending) return;
    if (deleteWorkspace === undefined) {
      setWorkspaceDeleteError({
        code: 'WORKSPACE_DELETE_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setWorkspaceDeletePending(true);
    setWorkspaceDeleteError(undefined);
    try {
      await deleteWorkspace(target.workspaceId);
      setWorkspaceDeleteTarget(undefined);
    } catch (error) {
      setWorkspaceDeleteError(toNativeWorktreeViewError(error));
    } finally {
      setWorkspaceDeletePending(false);
    }
  };

  const commitWorkspaceDrag = (
    activeDrag: WorkspaceDragState,
    over: NonNullable<WorkspaceDragState['over']>,
  ): void => {
    if (workspaceDropCommitted.current) return;
    workspaceDropCommitted.current = true;
    setWorkspaceDrag(undefined);
    const rows = workspaces.items;
    const targetIndex = rows.findIndex(
      (workspace) => workspace.workspaceId === over.workspaceId,
    );
    const sourceIndex = rows.findIndex(
      (workspace) => workspace.workspaceId === activeDrag.workspaceId,
    );
    if (targetIndex === -1 || sourceIndex === -1) return;
    const beforeWorkspaceId = over.half === 'before'
      ? over.workspaceId
      : rows[targetIndex + 1]?.workspaceId;
    const anchorIndex = beforeWorkspaceId === undefined
      ? rows.length
      : rows.findIndex((workspace) => workspace.workspaceId === beforeWorkspaceId);
    if (
      beforeWorkspaceId === activeDrag.workspaceId ||
      anchorIndex === sourceIndex ||
      anchorIndex === sourceIndex + 1
    ) {
      return;
    }
    if (insertWorkspaceBefore === undefined) {
      setActionError({
        code: 'WORKSPACE_ORDER_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setActionError(undefined);
    void insertWorkspaceBefore(activeDrag.workspaceId, beforeWorkspaceId).catch((error) => {
      setActionError(toWorktreeViewError(error));
    });
  };

  const commitSessionDrag = (
    activeDrag: SessionDragState,
    over: NonNullable<SessionDragState['over']>,
    sessionIds: readonly string[],
    workspaceId: string,
  ): void => {
    if (sessionDropCommitted.current) return;
    sessionDropCommitted.current = true;
    setSessionDrag(undefined);
    const targetIndex = sessionIds.indexOf(over.sessionId);
    const sourceIndex = sessionIds.indexOf(activeDrag.sessionId);
    if (targetIndex === -1 || sourceIndex === -1) return;
    const beforeSessionId = over.half === 'before'
      ? over.sessionId
      : sessionIds[targetIndex + 1];
    const anchorIndex = beforeSessionId === undefined
      ? sessionIds.length
      : sessionIds.indexOf(beforeSessionId);
    if (
      beforeSessionId === activeDrag.sessionId ||
      anchorIndex === sourceIndex ||
      anchorIndex === sourceIndex + 1
    ) {
      return;
    }
    if (insertSessionBefore === undefined) {
      setActionError({
        code: 'SESSION_ORDER_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setActionError(undefined);
    void insertSessionBefore(workspaceId, activeDrag.sessionId, beforeSessionId).catch((error) => {
      setActionError(toWorktreeViewError(error));
    });
  };

  const commitWorktreeDrag = (
    activeDrag: WorktreeDragState,
    over: NonNullable<WorktreeDragState['over']>,
    worktreeIds: readonly string[],
    workspaceId: string,
  ): void => {
    if (worktreeDropCommitted.current) return;
    worktreeDropCommitted.current = true;
    setWorktreeDrag(undefined);
    if (activeDrag.workspaceId !== workspaceId) return;
    const move = resolveWorktreeMove(
      worktreeIds,
      activeDrag.worktreeId,
      over.worktreeId,
      over.half,
    );
    if (move === undefined) return;
    if (insertWorktreeBefore === undefined) {
      setActionError({
        code: 'WORKTREE_ORDER_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setActionError(undefined);
    void insertWorktreeBefore(
      workspaceId,
      activeDrag.worktreeId,
      move.beforeWorktreeId,
    )
      .then(() => refresh({ preserveCurrent: true, invalidateContext: false }))
      .catch((error) => {
        setActionError(toRetryableWorktreeOrderError(error));
      });
  };

  const openSessionRename = (sessionId: string, currentTitle: string): void => {
    setSessionRenameTarget({ sessionId, currentTitle });
    setSessionRenameDraft(currentTitle);
    setSessionRenameError(undefined);
  };

  const closeSessionRename = (): void => {
    if (sessionRenamePending) return;
    setSessionRenameTarget(undefined);
    setSessionRenameError(undefined);
  };

  const confirmSessionRename = async (): Promise<void> => {
    const target = sessionRenameTarget;
    const title = sessionRenameDraft.trim();
    if (target === undefined || title.length === 0 || sessionRenamePending) return;
    if (renameSession === undefined) {
      setSessionRenameError({
        code: 'SESSION_RENAME_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setSessionRenamePending(true);
    setSessionRenameError(undefined);
    try {
      await renameSession(target.sessionId, title);
      setSessionRenameTarget(undefined);
    } catch (error) {
      setSessionRenameError(toNativeWorktreeViewError(error));
    } finally {
      setSessionRenamePending(false);
    }
  };

  const archiveWorktreeSession = async (sessionId: string): Promise<void> => {
    if (archiveSession === undefined) return;
    await runMutation(() => archiveSession(sessionId));
  };

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

  const toggleSessionGroup = (groupKey: string): void => {
    const autoExpanded = isCurrentSessionReveal('session-group:' + groupKey);
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

  const closeWorktreeCreator = (force = false): void => {
    if (actionPending && !force) return;
    modalReadLoader.current.invalidate();
    modalReadViewRef.current = undefined;
    importCandidatesGuard.current.invalidate();
    setWorktreeModalWorkspaceId(undefined);
    setModalReadError(undefined);
    setModalReadLoading(false);
  };

  const openWorktreeCreator = (workspace: WorkspaceLike): void => {
    const view = viewByWorkspace.get(workspace.workspaceId);
    modalReadLoader.current.invalidate();
    modalReadViewRef.current = undefined;
    importCandidatesGuard.current.invalidate();
    setWorktreeModalWorkspaceId(workspace.workspaceId);
    setWorktreeModalMode('create');
    setImportCandidates({ status: 'idle', candidates: [] });
    setSelectedImportPath(undefined);
    setActionError(undefined);
    setModalReadError(undefined);
    setModalReadLoading(false);
    if (view === undefined) {
      setSelectedBranch('');
      setNewBranch('');
      loadModalWorktreeView(workspace.workspaceId);
      return;
    }
    setSelectedBranch(selectDefaultBaseBranch(view.branches));
    setNewBranch(createDefaultWorktreeName([
      ...view.branches.map((branch) => branch.name),
      ...view.worktrees.map((worktree) => worktree.branch),
    ]));
  };

  const changeWorktreeModalMode = (mode: WorktreeRegistrationMode): void => {
    setWorktreeModalMode(mode);
    if (
      mode === 'import' &&
      worktreeModalWorkspaceId !== undefined &&
      importCandidates.status === 'idle'
    ) {
      void loadImportCandidates(worktreeModalWorkspaceId);
    }
  };

  const continueWorktreeRegistration = async (registeredWorktree: WorktreeRecord): Promise<void> => {
    closeWorktreeCreator(true);
    if (createSessionCallback === undefined) {
      await refresh({ preserveCurrent: true });
      setActionError({
        code: 'WORKTREE_REGISTRATION_SESSION_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }

    const sessionInput: CreateSessionForWorktreeInput = {
      workspaceId: registeredWorktree.workspaceId,
      worktreeId: registeredWorktree.worktreeId,
      cwd: registeredWorktree.absolutePath,
    };
    try {
      await createSessionCallback(sessionInput);
      await invalidateWorktreeContext?.(registeredWorktree.workspaceId);
    } catch (error) {
      if (error instanceof WorktreeSessionBindingError && error.retryable) {
        setPendingSessionBinding({ ...sessionInput, sessionId: error.sessionId });
      }
      if (error instanceof WorktreeSessionPermissionError && error.retryable) {
        setPendingSessionBinding({
          ...sessionInput,
          sessionId: error.sessionId,
          permissionRequired: true,
        });
      }
      throw error;
    }
    await refresh({ preserveCurrent: true });
  };

  const submitWorktree = async (): Promise<void> => {
    const worktreeName = newBranch.trim();
    const selectedImportCandidate = importCandidates.candidates.find(
      (candidate) => candidate.absolutePath === selectedImportPath,
    );
    if (manager === undefined || modalWorkspace === undefined) return;
    if (
      worktreeModalMode === 'create' &&
      (!modalCanCreate || selectedBranch.length === 0 || worktreeName.length === 0)
    ) return;
    if (worktreeModalMode === 'import' && selectedImportCandidate === undefined) return;
    setActionPending(true);
    setActionError(undefined);
    setPendingSessionBinding(undefined);
    try {
      const registeredWorktree = worktreeModalMode === 'create'
        ? await executeWorktreeAction(manager, {
            type: 'createWorktree',
            input: {
              workspaceId: modalWorkspace.workspaceId,
              branch: selectedBranch,
              newBranch: worktreeName,
            },
          })
        : await executeWorktreeAction(manager, {
            type: 'importWorktree',
            input: {
              workspaceId: modalWorkspace.workspaceId,
              absolutePath: selectedImportCandidate!.absolutePath,
            },
          });
      if (registeredWorktree === undefined) {
        throw {
          code: 'WORKTREE_RECORD_MISSING',
          message: '',
          retryable: true,
        };
      }
      await continueWorktreeRegistration(registeredWorktree);
    } catch (error) {
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };

  const createSession = async (input: CreateSessionForWorktreeInput): Promise<void> => {
    if (createSessionCallback === undefined) {
      setActionError({
        code: 'SESSION_CREATE_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setActionPending(true);
    setActionError(undefined);
    setPendingSessionBinding(undefined);
    try {
      await createSessionCallback(input);
      await invalidateWorktreeContext?.(input.workspaceId);
      await refresh({ preserveCurrent: true });
    } catch (error) {
      if (error instanceof WorktreeSessionBindingError && error.retryable) {
        setPendingSessionBinding({ ...input, sessionId: error.sessionId });
      }
      if (error instanceof WorktreeSessionPermissionError && error.retryable) {
        setPendingSessionBinding({
          ...input,
          sessionId: error.sessionId,
          permissionRequired: true,
        });
      }
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };

  const retrySessionBinding = async (): Promise<void> => {
    if (
      manager === undefined ||
      pendingSessionBinding === undefined ||
      pendingSessionArchived
    ) return;
    const pending = pendingSessionBinding;
    setActionPending(true);
    setActionError(undefined);
    try {
      await retryWorktreeSessionBinding({
        manager,
        pending,
        archived: false,
        ensureSessionWorkspace: (workspaceId, sessionId) => {
          ensureSessionWorkspace?.(workspaceId, sessionId);
        },
        permission,
        confirmFullAccess,
        onPermissionResult,
        openSession,
      });
      setPendingSessionBinding(undefined);
      await refresh({ preserveCurrent: true });
      await invalidateWorktreeContext?.(pending.workspaceId);
    } catch (error) {
      if (error instanceof WorktreeSessionBindingError && !error.retryable) {
        setPendingSessionBinding(undefined);
      }
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };

  const openWorkspaceSession = (workspaceId: string, sessionId: string): void => {
    ensureSessionWorkspace?.(workspaceId, sessionId);
    openWorktreeSession({ open: openSession }, sessionId);
  };

  if (mode !== 'worktree') return null;

  const visibleWorkspaces = workspaces.items.filter((workspace) =>
    workspaceMatches(
      workspace,
      viewByWorkspace.get(workspace.workspaceId),
      sessions,
      query,
    ),
  );

  return (
    <aside
      ref={ref}
      className={styles.surface}
      data-worktree-surface
      data-collapsed={collapsed || undefined}
      aria-label={t('mode.navigation')}
      style={{
        width: `${width}px`,
        ...(bounds.ready
          ? { top: `${bounds.top}px`, height: `${bounds.height}px` }
          : { height: '0px', visibility: 'hidden' }),
      }}
    >
      <div className={styles.wideContent}>
        <header className={styles.header}>
          <span className={styles.title}>{t('worktree.title')}</span>
          <button
            type="button"
            className={styles.closeButton}
            aria-label={t('mode.exit')}
            onClick={() => {
              actions.setViewMode('workspace-session');
            }}
          >
            <IconCloseOutline16 />
          </button>
        </header>

        <div className={styles.searchRow}>
          <span className={styles.searchIcon} aria-hidden="true">
            <IconSearchOutline16 />
          </span>
          <input
            className={styles.searchInput}
            aria-label={t('workspace.search')}
            placeholder={t('workspace.search')}
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.currentTarget.value);
            }}
          />
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t('workspace.add')}
            onClick={() => {
              if (createWorkspace !== undefined) void runMutation(createWorkspace);
            }}
          >
            <IconProjectAddOutline16 />
          </button>
        </div>

        <div className={styles.content} tabIndex={0}>
          {permissionNoticeSnapshot !== undefined && (
            <div className={styles.notice} role="status" data-worktree-permission-notice>
              <p className={styles.message}>
                {formatWorktreePermissionNotice(permissionNoticeSnapshot.result, t)}
              </p>
            </div>
          )}
          {actionError !== undefined && (
            <div className={styles.error} role="alert" data-worktree-error>
              <p className={styles.message} data-error="true">
                {formatWorktreeViewError(actionError, t)}
              </p>
              {pendingSessionBinding !== undefined && (
                <div className={styles.recoveryActions}>
                  <button
                    type="button"
                    className={styles.actionButton}
                    disabled={actionPending || pendingSessionArchived}
                    onClick={() => {
                      void retrySessionBinding();
                    }}
                  >
                    {t('action.retryBinding')}
                  </button>
                  {!pendingSessionBinding.permissionRequired && (
                    <button
                      type="button"
                      className={styles.actionButton}
                      disabled={actionPending}
                      onClick={() => {
                        const sessionId = pendingSessionBinding.sessionId;
                        setPendingSessionBinding(undefined);
                        setActionError(undefined);
                        openSession(sessionId);
                      }}
                    >
                      {t('action.openCreatedSession')}
                    </button>
                  )}
                </div>
              )}
              {actionError.retryable && (
                <button
                  type="button"
                  className={styles.retryButton}
                  onClick={() => {
                    setActionError(undefined);
                    void refresh();
                  }}
                >
                  {t('action.retry')}
                </button>
              )}
            </div>
          )}

          {readState.status === 'loading' && (
            <p className={styles.message}>{t('status.loading')}</p>
          )}
          {readState.status === 'error' && readState.error !== undefined ? (
            <div className={styles.error} role="alert" data-worktree-error>
              <p className={styles.message} data-error="true">
                {formatWorktreeViewError(readState.error, t)}
              </p>
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => {
                  void refresh();
                }}
              >
                {t('action.retry')}
              </button>
            </div>
          ) : readState.status === 'ready' ? (
            <div className={styles.workspaceList}>
              {visibleWorkspaces.length === 0 ? (
                <p className={styles.empty}>{t('workspace.noMatches')}</p>
              ) : (
                visibleWorkspaces.map((workspace) => {
                  const view = viewByWorkspace.get(workspace.workspaceId);
                  const currentBranch = view?.branches.find(
                    (branch) => branch.isCurrent,
                  )?.name;
                  const mainLabel = currentBranch === undefined
                    ? t('worktree.main')
                    : t('worktree.mainWithBranch', { branch: currentBranch });
                  const expanded =
                    isWorkspaceExpanded(expandSnapshot, workspace.workspaceId) ||
                    isCurrentSessionReveal('workspace:' + workspace.workspaceId);
                  const workspaceMatchesQuery = includesText(workspace.title, query);
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
                  const visibleMainSessionIds = mainSessionIds.filter(
                    (sessionId) =>
                      workspaceMatchesQuery || sessionMatchesQuery(sessionId, sessions, query),
                  );
                  const mainExpanded =
                    isMainExpanded(expandSnapshot, workspace.workspaceId) ||
                    isCurrentSessionReveal('main:' + workspace.workspaceId);
                  const mainGroupKey = `main:${workspace.workspaceId}`;
                  const sessionIds = visibleMainSessionIds;
                  const mainSessionGroupExpanded =
                    expandedSessionGroups[mainGroupKey] === true ||
                    (sessionIds.length > 5 &&
                      isCurrentSessionReveal('session-group:' + mainGroupKey));
                  const worktrees = view?.worktrees ?? [];
                  const sameWorkspaceWorktreeDrag =
                    worktreeDrag?.workspaceId === workspace.workspaceId;

                  return (
                    <section
                      key={workspace.workspaceId}
                      className={styles.workspaceGroup}
                      data-workspace-id={workspace.workspaceId}
                    >
                      <WorktreeWorkspaceRow
                        t={t}
                        workspace={workspace}
                        expanded={expanded}
                        actionPending={actionPending}
                        menuOpen={openWorkspaceMenuId === workspace.workspaceId}
                        drag={{
                          active: workspaceDrag !== undefined,
                          marker:
                            workspaceDrag?.over?.workspaceId === workspace.workspaceId
                              ? workspaceDrag.over.half
                              : null,
                          start: () => {
                            workspaceDropCommitted.current = false;
                            setWorkspaceDrag({ workspaceId: workspace.workspaceId, over: null });
                          },
                          hover: (half) => {
                            setWorkspaceDrag((current) =>
                              current === undefined
                                ? current
                                : {
                                    ...current,
                                    over: { workspaceId: workspace.workspaceId, half },
                                  },
                            );
                          },
                          drop: (half) => {
                            if (workspaceDrag === undefined) return;
                            commitWorkspaceDrag(workspaceDrag, {
                              workspaceId: workspace.workspaceId,
                              half,
                            });
                          },
                          end: () => {
                            if (workspaceDrag?.over !== null && workspaceDrag?.over !== undefined) {
                              commitWorkspaceDrag(workspaceDrag, workspaceDrag.over);
                            } else {
                              setWorkspaceDrag(undefined);
                            }
                            workspaceDropCommitted.current = false;
                          },
                        }}
                        onToggle={() => {
                          toggleWorkspace(workspace.workspaceId);
                        }}
                        onCreateWorktree={() => {
                          openWorktreeCreator(workspace);
                        }}
                        onRename={() => {
                          openWorkspaceRename(workspace);
                        }}
                        onDelete={() => {
                          openWorkspaceDelete(workspace);
                        }}
                        onMenuOpenChange={(open) => {
                          setOpenWorkspaceMenuId(open ? workspace.workspaceId : undefined);
                        }}
                      />

                      {expanded && (
                        <div className={styles.treeChildren}>
                          <WorktreeGroupRow
                            t={t}
                            kind="main"
                            label={mainLabel}
                            expanded={mainExpanded}
                            icon={<IconBranchOutline16 />}
                            workspaceTitle={workspace.title}
                            onToggle={() => {
                              toggleMain(workspace.workspaceId);
                            }}
                            onCreateSession={
                              createMainSession === undefined
                                ? undefined
                                : () => {
                                    createMainSession(workspace.workspaceId);
                                  }
                            }
                          />
                          {mainExpanded && (
                            <WorktreeSessionGroup
                              t={t}
                              groupKey={mainGroupKey}
                              sessionIds={sessionIds}
                              workspaceId={workspace.workspaceId}
                              currentSessionId={currentSessionId}
                              expanded={mainSessionGroupExpanded}
                              actionPending={actionPending}
                              sessions={sessions}
                              dragState={sessionDrag}
                              onToggleExpanded={() => {
                                toggleSessionGroup(mainGroupKey);
                              }}
                              onStartDrag={(groupKey, sessionId) => {
                                sessionDropCommitted.current = false;
                                setSessionDrag({ groupKey, sessionId, over: null });
                              }}
                              onHoverDrag={(sessionId, half) => {
                                setSessionDrag((current) =>
                                  current === undefined
                                    ? current
                                    : { ...current, over: { sessionId, half } },
                                );
                              }}
                              onClearDrag={() => {
                                setSessionDrag(undefined);
                              }}
                              onFinishDrag={() => {
                                sessionDropCommitted.current = false;
                              }}
                              onCommitDrag={commitSessionDrag}
                              onOpen={(sessionId) => {
                                openWorktreeSession({ open: openSession }, sessionId);
                              }}
                              onRename={renameSession === undefined ? undefined : openSessionRename}
                              onFork={forkSession}
                              onArchive={
                                archiveSession === undefined ? undefined : archiveWorktreeSession
                              }
                            />
                          )}

                          {worktrees.length === 0 && (
                            <p className={styles.emptyNested}>{t('worktree.noWorktrees')}</p>
                          )}
                          {worktrees.map((record) => {
                            const worktreeSessionIds = filterVisibleSessionIds(
                              filterArchivedSessionIds(
                                bindingIdsFor(bindings, record.worktreeId).filter((sessionId) =>
                                  sessions.ids.includes(sessionId),
                                ),
                                archivedSessionIds,
                              ),
                              sessions,
                            );
                            const worktreeMatchesQuery =
                              workspaceMatchesQuery ||
                              includesText(record.branch, query) ||
                              includesText(record.absolutePath, query);
                            if (
                              query.length > 0 &&
                              !worktreeMatchesQuery &&
                              !worktreeSessionIds.some((sessionId) =>
                                sessionMatchesQuery(sessionId, sessions, query),
                              )
                            ) {
                              return null;
                            }
                            const visibleWorktreeSessionIds = worktreeSessionIds.filter(
                              (sessionId) =>
                                worktreeMatchesQuery || sessionMatchesQuery(sessionId, sessions, query),
                            );
                            const worktreeGroupKey = `worktree:${record.worktreeId}`;
                            const sessionIds = visibleWorktreeSessionIds;
                            const sessionGroupExpanded =
                              expandedSessionGroups[worktreeGroupKey] === true ||
                              (sessionIds.length > 5 &&
                                isCurrentSessionReveal('session-group:' + worktreeGroupKey));
                            const state = record.status === 'removed'
                              ? 'warning'
                              : record.health === 'repair'
                                ? 'error'
                                : 'done';
                            const stateLabel = record.status === 'removed'
                              ? t('worktree.detached')
                              : record.health === 'repair'
                                ? t('worktree.repair')
                                : t('worktree.ready');
                            const worktreeExpanded =
                              isWorktreeExpanded(expandSnapshot, record.worktreeId) ||
                              isCurrentSessionReveal('worktree:' + record.worktreeId);
                            return (
                              <div
                                key={record.worktreeId}
                                className={styles.worktreeGroup}
                                data-worktree-id={record.worktreeId}
                              >
                                <WorktreeGroupRow
                                  t={t}
                                  kind="worktree"
                                  label={record.branch}
                                  worktreeId={record.worktreeId}
                                  expanded={worktreeExpanded}
                                  icon={<IconBranchOutline16 />}
                                  workspaceTitle={workspace.title}
                                  state={state}
                                  stateLabel={stateLabel}
                                  onToggle={() => {
                                    toggleWorktree(record.worktreeId);
                                  }}
                                  onCreateSession={
                                    record.status === 'active' && record.health !== 'repair'
                                      ? () => {
                                          void createSession({
                                            workspaceId: record.workspaceId,
                                            worktreeId: record.worktreeId,
                                            cwd: record.absolutePath,
                                          });
                                        }
                                      : undefined
                                  }
                                  menu={
                                    record.status === 'active'
                                      ? {
                                          open: openWorktreeMenuId === record.worktreeId,
                                          label: record.branch,
                                          disabled: actionPending,
                                          onOpenChange: (open) => {
                                            setOpenWorktreeMenuId(
                                              open ? record.worktreeId : undefined,
                                            );
                                          },
                                          onRemove: () => {
                                            setWorktreeRemoval(record);
                                            setActionError(undefined);
                                          },
                                        }
                                      : undefined
                                  }
                                  drag={{
                                    active: sameWorkspaceWorktreeDrag,
                                    marker:
                                      worktreeDrag?.over?.worktreeId === record.worktreeId
                                        ? worktreeDrag.over.half
                                        : null,
                                    start: () => {
                                      worktreeDropCommitted.current = false;
                                      setWorktreeDrag({
                                        workspaceId: workspace.workspaceId,
                                        worktreeId: record.worktreeId,
                                        over: null,
                                      });
                                    },
                                    hover: (half) => {
                                      setWorktreeDrag((current) =>
                                        current === undefined ||
                                        current.workspaceId !== workspace.workspaceId
                                          ? current
                                          : {
                                              ...current,
                                              over: { worktreeId: record.worktreeId, half },
                                            },
                                      );
                                    },
                                    drop: (half) => {
                                      if (worktreeDrag === undefined) return;
                                      commitWorktreeDrag(
                                        worktreeDrag,
                                        { worktreeId: record.worktreeId, half },
                                        worktrees.map((candidate) => candidate.worktreeId),
                                        workspace.workspaceId,
                                      );
                                    },
                                    end: () => {
                                      setWorktreeDrag(undefined);
                                      worktreeDropCommitted.current = false;
                                    },
                                  }}
                                />
                                {worktreeExpanded && (
                                  <WorktreeSessionGroup
                                    t={t}
                                    groupKey={worktreeGroupKey}
                                    sessionIds={sessionIds}
                                    workspaceId={workspace.workspaceId}
                                    currentSessionId={currentSessionId}
                                    expanded={sessionGroupExpanded}
                                    actionPending={actionPending}
                                    sessions={sessions}
                                    dragState={sessionDrag}
                                    onToggleExpanded={() => {
                                      toggleSessionGroup(worktreeGroupKey);
                                    }}
                                    onStartDrag={(groupKey, sessionId) => {
                                      sessionDropCommitted.current = false;
                                      setSessionDrag({ groupKey, sessionId, over: null });
                                    }}
                                    onHoverDrag={(sessionId, half) => {
                                      setSessionDrag((current) =>
                                        current === undefined
                                          ? current
                                          : { ...current, over: { sessionId, half } },
                                      );
                                    }}
                                    onClearDrag={() => {
                                      setSessionDrag(undefined);
                                    }}
                                    onFinishDrag={() => {
                                      sessionDropCommitted.current = false;
                                    }}
                                    onCommitDrag={commitSessionDrag}
                                    onOpen={(sessionId) => {
                                      openWorkspaceSession(workspace.workspaceId, sessionId);
                                    }}
                                    onRename={
                                      renameSession === undefined ? undefined : openSessionRename
                                    }
                                    onFork={forkSession}
                                    onArchive={
                                      archiveSession === undefined
                                        ? undefined
                                        : archiveWorktreeSession
                                    }
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </div>

      <WorktreeSessionRenameDialog
        t={t}
        target={sessionRenameTarget}
        draft={sessionRenameDraft}
        pending={sessionRenamePending}
        error={sessionRenameError}
        onClose={closeSessionRename}
        onDraftChange={(draft) => {
          setSessionRenameDraft(draft);
          setSessionRenameError(undefined);
        }}
        onSubmit={confirmSessionRename}
      />

      <WorktreeWorkspaceRenameDialog
        t={t}
        target={workspaceRenameTarget}
        draft={workspaceRenameDraft}
        pending={workspaceRenamePending}
        duplicate={workspaceRenameDuplicate}
        error={workspaceRenameError}
        onClose={closeWorkspaceRename}
        onDraftChange={(draft) => {
          setWorkspaceRenameDraft(draft);
          setWorkspaceRenameError(undefined);
        }}
        onSubmit={confirmWorkspaceRename}
      />

      <WorktreeWorkspaceDeleteDialog
        t={t}
        target={workspaceDeleteTarget}
        pending={workspaceDeletePending}
        error={workspaceDeleteError}
        onClose={closeWorkspaceDelete}
        onSubmit={confirmWorkspaceDelete}
      />

      <WorktreeCreateDialog
        t={t}
        workspace={modalWorkspace}
        view={modalView}
        readError={modalReadError}
        setupStatus={modalSetupStatus}
        canCreate={modalCanCreate}
        mode={worktreeModalMode}
        importCandidates={importCandidates}
        selectedImportPath={selectedImportPath}
        selectedBranch={selectedBranch}
        newBranch={newBranch}
        actionPending={actionPending}
        onClose={closeWorktreeCreator}
        onRetry={() => {
          if (worktreeModalWorkspaceId === undefined) return;
          modalReadViewRef.current = undefined;
          setSelectedBranch('');
          setNewBranch('');
          loadModalWorktreeView(worktreeModalWorkspaceId);
        }}
        onModeChange={changeWorktreeModalMode}
        onRetryImportCandidates={() => {
          if (worktreeModalWorkspaceId !== undefined) {
            void loadImportCandidates(worktreeModalWorkspaceId);
          }
        }}
        onSelectedImportPathChange={setSelectedImportPath}
        onSelectedBranchChange={setSelectedBranch}
        onNewBranchChange={setNewBranch}
        onSubmit={submitWorktree}
      />

      <WorktreeRemovalDialog
        t={t}
        worktree={worktreeRemoval}
        actionPending={actionPending}
        onClose={() => {
          setWorktreeRemoval(undefined);
        }}
        onSubmit={() => {
          if (manager === undefined || worktreeRemoval === undefined) return;
          const target = worktreeRemoval;
          void runMutation(async () => {
            await executeWorktreeAction(manager, {
              type: 'removeWorktree',
              input: {
                workspaceId: target.workspaceId,
                worktreeId: target.worktreeId,
              },
            }, permission, onPermissionNotice);
            await invalidateWorktreeContext?.(target.workspaceId);
            setWorktreeRemoval(undefined);
          });
        }}
      />

      <RiskConfirmation
        open={fullAccessConfirmationSnapshot !== undefined}
        title={t('permission.fullAccessTitle')}
        description={fullAccessConfirmationSnapshot === undefined
          ? ''
          : t('permission.fullAccessDescription', {
              cwd: fullAccessConfirmationSnapshot.cwd,
            })}
        acknowledgeLabel={t('permission.fullAccessAcknowledge')}
        cancelLabel={t('dialog.cancel')}
        confirmLabel={t('permission.fullAccessEnable')}
        acknowledged={fullAccessAcknowledged}
        onAcknowledgedChange={setFullAccessAcknowledged}
        onCancel={() => {
          setFullAccessAcknowledged(false);
          fullAccessConfirmation?.resolve(false);
        }}
        onConfirm={() => {
          setFullAccessAcknowledged(false);
          fullAccessConfirmation?.resolve(true);
        }}
      />

    </aside>
  );
}
