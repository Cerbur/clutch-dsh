import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import {
  Button,
  IconArchiveOutline20,
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconTrashOutline16,
  Input,
  Menu,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { SessionBinding, WorktreeManager, WorktreeRecord } from '../contract/index.js';
import { openWorktreeSession } from './navigation.js';
import { useSidebarOverlayGeometry } from './sidebar-overlay-geometry.js';
import type { createWorktreeViewStore } from './view-mode-store.js';
import { effectiveViewMode, unboundSessionIds, workspaceSessionIds } from './view-mode.js';
import {
  executeWorktreeAction,
  createDefaultWorktreeName,
  filterArchivedSessionIds,
  loadWorktreeViews,
  selectDefaultBaseBranch,
  stableWorkspaceIds,
  toWorktreeViewError,
  WorktreeSessionBindingError,
  type CreateSessionForWorktreeInput,
  type WorktreeViewError,
  type WorktreeWorkspaceView,
} from './worktree-view.js';
import styles from './worktree.css';

interface WorkspaceLike {
  readonly workspaceId: string;
  readonly title: string;
  readonly sessionIds: readonly string[];
}

interface WorkspaceListLike {
  readonly items: readonly WorkspaceLike[];
  readonly archivedSessionIds?: readonly string[];
}

interface SessionListLike {
  readonly ids: readonly string[];
  readonly byId: Record<string, { readonly displayTitle?: string }>;
}

/** Apply-time facts and DSH navigation callbacks used by the surface. */
export interface WorktreeSurfaceInjected {
  readonly available: boolean;
  readonly manager?: WorktreeManager;
  readonly createWorkspace?: () => Promise<void>;
  readonly createSessionForWorktree?: (
    input: CreateSessionForWorktreeInput,
  ) => Promise<string>;
  readonly createMainSession?: (workspaceId: string) => void;
  readonly renameSession?: (sessionId: string, title: string) => Promise<void>;
  readonly forkSession?: (sessionId: string) => void;
  readonly archiveSession?: (sessionId: string) => Promise<void>;
  readonly ensureSessionWorkspace?: (workspaceId: string, sessionId: string) => void;
  readonly syncSessionWorkspaces?: (
    bindings: readonly { workspaceId: string; sessionId: string }[],
  ) => void;
  readonly openSession: (sessionId: string) => void;
}

/** Props derived from the frame overlay slot, shared state, and injected face. */
export type WorktreeSurfaceProps = PropsRuntime<'shell.overlay'> &
  PropsStore<ReturnType<typeof createWorktreeViewStore>> &
  WorktreeSurfaceInjected;

interface ReadState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly views: readonly WorktreeWorkspaceView[];
  readonly error?: WorktreeViewError;
}

interface PendingSessionBinding extends CreateSessionForWorktreeInput {
  readonly sessionId: string;
}

interface SessionRenameTarget {
  readonly sessionId: string;
  readonly currentTitle: string;
}

interface WorktreeSessionRowProps {
  readonly sessionId: string;
  readonly label: string;
  readonly status?: string;
  readonly actionPending: boolean;
  readonly onOpen: () => void;
  readonly onRename?: (sessionId: string, currentTitle: string) => void;
  readonly onFork?: (sessionId: string) => void;
  readonly onArchive?: (sessionId: string) => void;
}

const EMPTY_READ_STATE: ReadState = { status: 'idle', views: [] };

function useStableWorkspaceIds(workspaces: readonly WorkspaceLike[]): readonly string[] {
  const next = workspaces.map((workspace) => workspace.workspaceId);
  const previousRef = useRef<readonly string[]>([]);
  const stable = stableWorkspaceIds(previousRef.current, next);
  if (stable !== previousRef.current) previousRef.current = stable;
  return previousRef.current;
}

function sessionLabel(sessionId: string, sessions: SessionListLike): string {
  return sessions.byId[sessionId]?.displayTitle ?? sessionId;
}

function bindingIdsFor(bindings: readonly SessionBinding[], worktreeId: string): readonly string[] {
  return bindings
    .filter((binding) => binding.worktreeId === worktreeId)
    .map((binding) => binding.sessionId);
}

function worktreeStatus(record: WorktreeRecord): string {
  return record.status === 'active' ? 'active' : 'detached';
}

function includesText(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query);
}

function workspaceMatches(
  workspace: WorkspaceLike,
  view: WorktreeWorkspaceView | undefined,
  sessions: SessionListLike,
  query: string,
): boolean {
  if (query.length === 0) return true;
  if (includesText(workspace.title, query)) return true;
  if (
    workspace.sessionIds.some((sessionId) =>
      includesText(sessionLabel(sessionId, sessions), query),
    )
  ) {
    return true;
  }
  if (view === undefined) return false;
  if (
    view.worktrees.some(
      (record) =>
        includesText(record.branch, query) || includesText(record.absolutePath, query),
    )
  ) {
    return true;
  }
  return view.bindings.some((binding) =>
    includesText(sessionLabel(binding.sessionId, sessions), query),
  );
}

/** Worktree-mode Session row with the same trailing options menu as native DSH rows. */
function WorktreeSessionRow({
  sessionId,
  label,
  status,
  actionPending,
  onOpen,
  onRename,
  onFork,
  onArchive,
}: WorktreeSessionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sessionMenuItems = [
    {
      id: 'rename',
      label: 'Rename',
      icon: <IconEditOutline16 />,
      disabled: onRename === undefined || actionPending,
    },
    {
      id: 'fork',
      label: 'Fork session',
      icon: <IconBranchOutline16 />,
      disabled: onFork === undefined || actionPending,
    },
    {
      id: 'archive',
      label: 'Archive session',
      icon: <IconArchiveOutline20 size={16} />,
      disabled: onArchive === undefined || actionPending,
    },
  ];

  return (
    <div
      className={styles.treeSessionRow}
      data-session-id={sessionId}
      data-menu-open={menuOpen || undefined}
      role="treeitem"
    >
      <button type="button" className={styles.treeSessionContent} onClick={onOpen}>
        <span className={styles.treeGuide} aria-hidden="true">
          └
        </span>
        <span className={styles.sessionLabel}>{label}</span>
        {status !== undefined && <span className={styles.status}>{status}</span>}
      </button>
      <span className={styles.rowActions}>
        <Menu
          open={menuOpen}
          onClose={() => {
            setMenuOpen(false);
          }}
          items={sessionMenuItems}
          onSelect={(id) => {
            setMenuOpen(false);
            if (id === 'rename') onRename?.(sessionId, label);
            if (id === 'fork') onFork?.(sessionId);
            if (id === 'archive') onArchive?.(sessionId);
          }}
          portal
          closeOnPointerLeave
          anchor={(
            <button
              type="button"
              className={styles.iconButton}
              data-session-menu
              aria-label={`Session options for ${label}`}
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((current) => !current);
              }}
            >
              <IconEllipsisOutline16 />
            </button>
          )}
        />
      </span>
    </div>
  );
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
  available,
  manager,
  createWorkspace,
  createSessionForWorktree: createSessionCallback,
  createMainSession,
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
  const workspaceIds = useStableWorkspaceIds(workspaces.items);
  const [readState, setReadState] = useState<ReadState>(EMPTY_READ_STATE);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
  const [expandedWorktrees, setExpandedWorktrees] = useState<Record<string, boolean>>({});
  const [worktreeModalWorkspaceId, setWorktreeModalWorkspaceId] = useState<string>();
  const [worktreeRemoval, setWorktreeRemoval] = useState<WorktreeRecord>();
  const [openWorktreeMenuId, setOpenWorktreeMenuId] = useState<string>();
  const [selectedBranch, setSelectedBranch] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [pendingSessionBinding, setPendingSessionBinding] = useState<PendingSessionBinding>();
  const [actionError, setActionError] = useState<WorktreeViewError>();
  const [actionPending, setActionPending] = useState(false);
  const [sessionRenameTarget, setSessionRenameTarget] = useState<SessionRenameTarget>();
  const [sessionRenameDraft, setSessionRenameDraft] = useState('');
  const [sessionRenamePending, setSessionRenamePending] = useState(false);
  const [sessionRenameError, setSessionRenameError] = useState<string>();
  const { ref, width, bounds } = useSidebarOverlayGeometry(mode === 'worktree');
  const collapsed = width <= 64;
  const query = searchQuery.trim().toLocaleLowerCase();
  const archivedSessionIds = workspaces.archivedSessionIds ?? [];

  const refresh = useCallback(async (): Promise<void> => {
    if (manager === undefined) {
      setReadState(EMPTY_READ_STATE);
      return;
    }
    setReadState({ status: 'loading', views: [] });
    try {
      const views = await loadWorktreeViews(manager, workspaceIds);
      setReadState({ status: 'ready', views });
    } catch (error) {
      setReadState({
        status: 'error',
        views: [],
        error: toWorktreeViewError(error),
      });
    }
  }, [manager, workspaceIds]);

  useEffect(() => {
    if (mode === 'worktree') {
      void refresh();
    } else {
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

  const modalWorkspace = workspaces.items.find(
    (workspace) => workspace.workspaceId === worktreeModalWorkspaceId,
  );
  const modalView =
    worktreeModalWorkspaceId === undefined
      ? undefined
      : viewByWorkspace.get(worktreeModalWorkspaceId);
  const runMutation = async (operation: () => Promise<void>): Promise<void> => {
    setActionPending(true);
    setActionError(undefined);
    try {
      await operation();
      await refresh();
    } catch (error) {
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
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
      setSessionRenameError('Session rename is unavailable; retry after reconnecting.');
      return;
    }
    setSessionRenamePending(true);
    setSessionRenameError(undefined);
    try {
      await renameSession(target.sessionId, title);
      setSessionRenameTarget(undefined);
    } catch (error) {
      setSessionRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionRenamePending(false);
    }
  };

  const archiveWorktreeSession = async (sessionId: string): Promise<void> => {
    if (archiveSession === undefined) return;
    await runMutation(() => archiveSession(sessionId));
  };

  const toggleWorkspace = (workspaceId: string): void => {
    setExpandedWorkspaces((current) => ({
      ...current,
      [workspaceId]: current[workspaceId] === false,
    }));
  };

  const toggleWorktree = (worktreeId: string): void => {
    setExpandedWorktrees((current) => ({
      ...current,
      [worktreeId]: current[worktreeId] === false,
    }));
  };

  const openWorktreeCreator = (workspace: WorkspaceLike): void => {
    const view = viewByWorkspace.get(workspace.workspaceId);
    const baseBranch = selectDefaultBaseBranch(view?.branches ?? []);
    const existingNames = [
      ...(view?.branches ?? []).map((branch) => branch.name),
      ...(view?.worktrees ?? []).map((worktree) => worktree.branch),
    ];
    setWorktreeModalWorkspaceId(workspace.workspaceId);
    setSelectedBranch(baseBranch);
    setNewBranch(createDefaultWorktreeName(existingNames));
    setActionError(undefined);
  };

  const submitWorktree = async (): Promise<void> => {
    const worktreeName = newBranch.trim();
    if (
      manager === undefined ||
      modalWorkspace === undefined ||
      selectedBranch.length === 0 ||
      worktreeName.length === 0
    ) {
      return;
    }
    const input = {
      workspaceId: modalWorkspace.workspaceId,
      branch: selectedBranch,
      newBranch: worktreeName,
    };
    setActionPending(true);
    setActionError(undefined);
    setPendingSessionBinding(undefined);
    try {
      const createdWorktree = await executeWorktreeAction(manager, {
        type: 'createWorktree',
        input,
      });
      if (createdWorktree === undefined) {
        throw new Error('Worktree creation returned no Worktree record; retry the request.');
      }
      setWorktreeModalWorkspaceId(undefined);

      if (createSessionCallback === undefined) {
        await refresh();
        setActionError({
          code: 'SESSION_CREATE_UNAVAILABLE',
          message: 'Worktree created, but Session creation is unavailable; retry after reconnecting.',
          retryable: true,
        });
        return;
      }

      const sessionInput: CreateSessionForWorktreeInput = {
        workspaceId: createdWorktree.workspaceId,
        worktreeId: createdWorktree.worktreeId,
        cwd: createdWorktree.absolutePath,
      };
      try {
        await createSessionCallback(sessionInput);
      } catch (error) {
        if (error instanceof WorktreeSessionBindingError) {
          setPendingSessionBinding({ ...sessionInput, sessionId: error.sessionId });
        }
        throw error;
      }
      await refresh();
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
        message: 'Session creation is unavailable; retry after reconnecting.',
        retryable: true,
      });
      return;
    }
    setActionPending(true);
    setActionError(undefined);
    setPendingSessionBinding(undefined);
    try {
      await createSessionCallback(input);
      await refresh();
    } catch (error) {
      if (error instanceof WorktreeSessionBindingError) {
        setPendingSessionBinding({ ...input, sessionId: error.sessionId });
      }
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };

  const retrySessionBinding = async (): Promise<void> => {
    if (manager === undefined || pendingSessionBinding === undefined) return;
    setActionPending(true);
    setActionError(undefined);
    try {
      await manager.bindSession({
        workspaceId: pendingSessionBinding.workspaceId,
        worktreeId: pendingSessionBinding.worktreeId,
        sessionId: pendingSessionBinding.sessionId,
      });
      const sessionId = pendingSessionBinding.sessionId;
      setPendingSessionBinding(undefined);
      ensureSessionWorkspace?.(pendingSessionBinding.workspaceId, sessionId);
      await refresh();
      openSession(sessionId);
    } catch (error) {
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
      aria-label="Worktree navigation"
      style={{
        width: `${width}px`,
        ...(bounds.ready
          ? { top: `${bounds.top}px`, height: `${bounds.height}px` }
          : { height: '0px', visibility: 'hidden' }),
      }}
    >
      <div className={styles.wideContent}>
        <header className={styles.header}>
          <span className={styles.title}>Worktrees</span>
          <button
            type="button"
            className={styles.closeButton}
            aria-label="Exit Worktree mode"
            onClick={() => {
              actions.setViewMode('workspace-session');
            }}
          >
            <IconCloseOutline16 />
          </button>
        </header>

        <div className={styles.modeSwitch} role="tablist" aria-label="Navigation mode">
          <button
            type="button"
            className={styles.modeButton}
            role="tab"
            aria-selected={false}
            onClick={() => {
              actions.setViewMode('workspace-session');
            }}
          >
            Workspace
          </button>
          <button
            type="button"
            className={styles.modeButton}
            data-active="true"
            role="tab"
            aria-selected
          >
            Worktree
          </button>
        </div>

        <div className={styles.searchRow}>
          <span className={styles.searchIcon} aria-hidden="true">
            <IconSearchOutline16 />
          </span>
          <input
            className={styles.searchInput}
            aria-label="Search Workspaces and Sessions"
            placeholder="Search Workspaces and Sessions"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.currentTarget.value);
            }}
          />
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Add Workspace"
            onClick={() => {
              if (createWorkspace !== undefined) void runMutation(createWorkspace);
            }}
          >
            <IconPlusOutline16 />
          </button>
        </div>

        <div className={styles.content}>
          {actionError !== undefined && (
            <div className={styles.error} role="alert" data-worktree-error>
              <p className={styles.message} data-error="true">
                {actionError.message}
              </p>
              {pendingSessionBinding !== undefined && (
                <div className={styles.recoveryActions}>
                  <button
                    type="button"
                    className={styles.actionButton}
                    disabled={actionPending}
                    onClick={() => {
                      void retrySessionBinding();
                    }}
                  >
                    Retry Binding
                  </button>
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
                    Open Created Session
                  </button>
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
                  Retry
                </button>
              )}
            </div>
          )}

          {readState.status === 'loading' && <p className={styles.message}>Loading Workspaces…</p>}
          {readState.status === 'error' && readState.error !== undefined ? (
            <div className={styles.error} role="alert" data-worktree-error>
              <p className={styles.message} data-error="true">
                {readState.error.message}
              </p>
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => {
                  void refresh();
                }}
              >
                Retry
              </button>
            </div>
          ) : readState.status === 'ready' ? (
            <div className={styles.workspaceList}>
              {visibleWorkspaces.length === 0 ? (
                <p className={styles.empty}>No matching Workspaces</p>
              ) : (
                visibleWorkspaces.map((workspace) => {
                  const view = viewByWorkspace.get(workspace.workspaceId);
                  const expanded = expandedWorkspaces[workspace.workspaceId] !== false;
                  const workspaceMatchesQuery = includesText(workspace.title, query);
                  const allWorkspaceSessionIds = filterArchivedSessionIds(
                    workspaceSessionIds(workspaces, workspace.workspaceId, sessions.ids),
                    archivedSessionIds,
                  );
                  const bindings = view?.bindings ?? [];
                  const boundSessionIds = new Set(bindings.map((binding) => binding.sessionId));
                  const mainSessionIds = unboundSessionIds(allWorkspaceSessionIds, [
                    ...boundSessionIds,
                  ]);
                  const worktrees = view?.worktrees ?? [];

                  return (
                    <section
                      key={workspace.workspaceId}
                      className={styles.workspaceGroup}
                      data-workspace-id={workspace.workspaceId}
                    >
                      <div className={styles.workspaceRow}>
                        <button
                          type="button"
                          className={styles.disclosureButton}
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${workspace.title}`}
                          aria-expanded={expanded}
                          onClick={() => {
                            toggleWorkspace(workspace.workspaceId);
                          }}
                        >
                          {expanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                        </button>
                        <span className={styles.workspaceIcon} aria-hidden="true">
                          {expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />}
                        </span>
                        <span className={styles.workspaceTitle}>{workspace.title}</span>
                        <button
                          type="button"
                          className={styles.iconButton}
                          data-add-worktree
                          aria-label={`Add Worktree to ${workspace.title}`}
                          onClick={() => {
                            openWorktreeCreator(workspace);
                          }}
                        >
                          <IconPlusOutline16 />
                        </button>
                      </div>

                      {expanded && (
                        <div className={styles.treeChildren}>
                          <div className={styles.groupHeader}>
                            <div className={styles.groupLabel}>Main</div>
                            {createMainSession !== undefined && (
                              <button
                                type="button"
                                className={styles.iconButton}
                                data-add-main-session
                                aria-label={`Add Session to ${workspace.title}`}
                                onClick={() => {
                                  createMainSession(workspace.workspaceId);
                                }}
                              >
                                <IconPlusOutline16 />
                              </button>
                            )}
                          </div>
                          {mainSessionIds
                            .filter(
                              (sessionId) =>
                                workspaceMatchesQuery ||
                                includesText(sessionLabel(sessionId, sessions), query),
                            )
                            .map((sessionId) => (
                              <WorktreeSessionRow
                                key={sessionId}
                                sessionId={sessionId}
                                label={sessionLabel(sessionId, sessions)}
                                actionPending={actionPending}
                                onOpen={() => {
                                  openWorktreeSession({ open: openSession }, sessionId);
                                }}
                                onRename={renameSession === undefined ? undefined : openSessionRename}
                                onFork={forkSession}
                                onArchive={
                                  archiveSession === undefined ? undefined : archiveWorktreeSession
                                }
                              />
                            ))}

                          {worktrees.length === 0 && (
                            <p className={styles.emptyNested}>No Worktrees</p>
                          )}
                          {worktrees.map((record) => {
                            const worktreeSessionIds = filterArchivedSessionIds(
                              bindingIdsFor(bindings, record.worktreeId).filter((sessionId) =>
                                sessions.ids.includes(sessionId),
                              ),
                              archivedSessionIds,
                            );
                            const worktreeMatchesQuery =
                              workspaceMatchesQuery ||
                              includesText(record.branch, query) ||
                              includesText(record.absolutePath, query);
                            if (
                              query.length > 0 &&
                              !worktreeMatchesQuery &&
                              !worktreeSessionIds.some((sessionId) =>
                                includesText(sessionLabel(sessionId, sessions), query),
                              )
                            ) {
                              return null;
                            }
                            const worktreeExpanded =
                              expandedWorktrees[record.worktreeId] !== false;
                            return (
                              <div
                                key={record.worktreeId}
                                className={styles.worktreeGroup}
                                data-worktree-id={record.worktreeId}
                              >
                                <div
                                  className={styles.worktreeRow}
                                  data-menu-open={
                                    openWorktreeMenuId === record.worktreeId || undefined
                                  }
                                >
                                  <button
                                    type="button"
                                    className={styles.disclosureButton}
                                    aria-label={`${
                                      worktreeExpanded ? 'Collapse' : 'Expand'
                                    } ${record.branch}`}
                                    aria-expanded={worktreeExpanded}
                                    onClick={() => {
                                      toggleWorktree(record.worktreeId);
                                    }}
                                  >
                                    {worktreeExpanded ? (
                                      <IconChevronDownOutline14 />
                                    ) : (
                                      <IconChevronRightOutline14 />
                                    )}
                                  </button>
                                  <span className={styles.worktreeIcon} aria-hidden="true">
                                    <IconBranchOutline16 />
                                  </span>
                                  <span className={styles.worktreeLabel}>{record.branch}</span>
                                  <span className={styles.status}>{worktreeStatus(record)}</span>
                                  {record.status === 'active' && (
                                    <span className={styles.worktreeActions}>
                                      <Menu
                                        open={openWorktreeMenuId === record.worktreeId}
                                        onClose={() => {
                                          setOpenWorktreeMenuId(undefined);
                                        }}
                                        items={[
                                          {
                                            id: 'remove',
                                            label: 'Remove Worktree',
                                            icon: <IconTrashOutline16 />,
                                            danger: true,
                                            disabled: actionPending,
                                          },
                                        ]}
                                        onSelect={(id) => {
                                          setOpenWorktreeMenuId(undefined);
                                          if (id !== 'remove') return;
                                          setWorktreeRemoval(record);
                                          setActionError(undefined);
                                        }}
                                        portal
                                        closeOnPointerLeave
                                        anchor={(
                                          <button
                                            type="button"
                                            className={styles.iconButton}
                                            data-worktree-menu
                                            aria-label={`Worktree options for ${record.branch}`}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              setOpenWorktreeMenuId((current) =>
                                                current === record.worktreeId
                                                  ? undefined
                                                  : record.worktreeId,
                                              );
                                            }}
                                          >
                                            <IconEllipsisOutline16 />
                                          </button>
                                        )}
                                      />
                                      <button
                                        type="button"
                                        className={styles.iconButton}
                                        data-add-session
                                        aria-label={`Add Session to ${record.branch}`}
                                        onClick={() => {
                                          void createSession({
                                            workspaceId: record.workspaceId,
                                            worktreeId: record.worktreeId,
                                            cwd: record.absolutePath,
                                          });
                                        }}
                                      >
                                        <IconPlusOutline16 />
                                      </button>
                                    </span>
                                  )}
                                </div>
                                {worktreeExpanded &&
                                  worktreeSessionIds
                                    .filter(
                                      (sessionId) =>
                                        worktreeMatchesQuery ||
                                        includesText(sessionLabel(sessionId, sessions), query),
                                    )
                                    .map((sessionId) => (
                                      <WorktreeSessionRow
                                        key={`${record.worktreeId}:${sessionId}`}
                                        sessionId={sessionId}
                                        label={sessionLabel(sessionId, sessions)}
                                        status={record.status === 'active' ? 'bound' : 'detached'}
                                        actionPending={actionPending}
                                        onOpen={() => {
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
                                    ))}
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

      <div className={styles.railContent}>
        <button
          type="button"
          className={styles.railButton}
          aria-label="Exit Worktree mode"
          onClick={() => {
            actions.setViewMode('workspace-session');
          }}
        >
          WT
        </button>
      </div>

      <Modal
        open={sessionRenameTarget !== undefined}
        onClose={closeSessionRename}
        closeLabel="Close"
        title="Rename session"
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenamePending} onClick={closeSessionRename}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={sessionRenamePending || sessionRenameDraft.trim().length === 0}
              onClick={() => {
                void confirmSessionRename();
              }}
            >
              Rename
            </Button>
          </>
        )}
      >
        <Input
          className={styles.renameInput}
          value={sessionRenameDraft}
          aria-label="Session name"
          autoFocus
          disabled={sessionRenamePending}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setSessionRenameDraft(event.currentTarget.value);
            setSessionRenameError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void confirmSessionRename();
            }
          }}
        />
        {sessionRenameError !== undefined && (
          <p className={styles.renameError} role="alert">
            {sessionRenameError}
          </p>
        )}
      </Modal>

      {worktreeModalWorkspaceId !== undefined && modalWorkspace !== undefined && (
        <Modal
          open={worktreeModalWorkspaceId !== undefined}
          onClose={() => {
            if (actionPending) return;
            setWorktreeModalWorkspaceId(undefined);
          }}
          closeLabel="Close Create Worktree dialog"
          title="New Worktree"
          description={`${modalWorkspace.title} · the Worktree path is managed by DSH.`}
          footer={(
            <>
              <Button
                variant="outline"
                disabled={actionPending}
                onClick={() => {
                  setWorktreeModalWorkspaceId(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={
                  actionPending ||
                  selectedBranch.length === 0 ||
                  newBranch.trim().length === 0
                }
                onClick={() => {
                  void submitWorktree();
                }}
              >
                Create Worktree
              </Button>
            </>
          )}
        >
          <label className={styles.modalField}>
            Base branch
            <select
              className={styles.actionSelect}
              aria-label="Worktree base branch"
              value={selectedBranch}
              disabled={actionPending}
              onChange={(event) => {
                setSelectedBranch(event.currentTarget.value);
              }}
            >
              <option value="">No local branch</option>
              {(modalView?.branches ?? []).map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                  {branch.isCurrent ? ' (current)' : ''}
                  {branch.checkedOut ? ' (checked out)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.modalField}>
            Worktree name
            <Input
              className={styles.renameInput}
              aria-label="Worktree name"
              value={newBranch}
              placeholder="dsh/12345678"
              disabled={actionPending}
              onChange={(event) => {
                setNewBranch(event.currentTarget.value);
              }}
            />
          </label>
          {modalView?.branches.length === 0 && (
            <p className={styles.empty}>No local branches found in this Workspace.</p>
          )}
        </Modal>
      )}

      {worktreeRemoval !== undefined && (
        <Modal
          open={worktreeRemoval !== undefined}
          onClose={() => {
            if (actionPending) return;
            setWorktreeRemoval(undefined);
          }}
          closeLabel="Close Remove Worktree dialog"
          title="Remove Worktree"
          description={`Remove ${worktreeRemoval.branch}? Sessions stay in DSH and remain available as detached bindings.`}
          footer={(
            <>
              <Button
                variant="outline"
                disabled={actionPending}
                onClick={() => {
                  setWorktreeRemoval(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={actionPending}
                onClick={() => {
                  if (manager === undefined) return;
                  void runMutation(async () => {
                    await executeWorktreeAction(manager, {
                      type: 'removeWorktree',
                      input: {
                        workspaceId: worktreeRemoval.workspaceId,
                        worktreeId: worktreeRemoval.worktreeId,
                      },
                    });
                    setWorktreeRemoval(undefined);
                  });
                }}
              >
                Remove Worktree
              </Button>
            </>
          )}
        />
      )}
    </aside>
  );
}
