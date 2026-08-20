import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { SessionBinding, WorktreeManager, WorktreeRecord } from '../contract/index.js';
import { openWorktreeSession } from './navigation.js';
import type { createWorktreeViewStore } from './view-mode-store.js';
import { effectiveViewMode, unboundSessionIds, workspaceSessionIds } from './view-mode.js';
import {
  executeWorktreeAction,
  createDefaultWorktreeName,
  loadWorktreeViews,
  selectDefaultBaseBranch,
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

const EMPTY_READ_STATE: ReadState = { status: 'idle', views: [] };

function useSidebarWidth(active: boolean): {
  ref: RefObject<HTMLDivElement>;
  width: number;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);

  useLayoutEffect(() => {
    if (!active) return;
    const surface = ref.current;
    const overlay = surface?.closest('[data-shell-overlay]');
    const frame = overlay?.parentElement;
    const sidebar = frame?.firstElementChild;
    if (!(sidebar instanceof HTMLElement)) return;
    const update = (): void => {
      const next = sidebar.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    update();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(update);
    observer.observe(sidebar);
    return () => {
      observer.disconnect();
    };
  }, [active]);

  return { ref, width };
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
  ensureSessionWorkspace,
  syncSessionWorkspaces,
  openSession,
}: WorktreeSurfaceProps) {
  const preferredMode = useStore((state) => state.viewMode);
  const mode = effectiveViewMode(preferredMode, available && manager !== undefined);
  const sessions = useSessions((state) => state) as SessionListLike;
  const workspaces = useWorkspaces((state) => state);
  const workspaceIds = useMemo(
    () => workspaces.items.map((workspace) => workspace.workspaceId),
    [workspaces.items],
  );
  const [readState, setReadState] = useState<ReadState>(EMPTY_READ_STATE);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
  const [expandedWorktrees, setExpandedWorktrees] = useState<Record<string, boolean>>({});
  const [worktreeModalWorkspaceId, setWorktreeModalWorkspaceId] = useState<string>();
  const [worktreeRemoval, setWorktreeRemoval] = useState<WorktreeRecord>();
  const [selectedBranch, setSelectedBranch] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [pendingSessionBinding, setPendingSessionBinding] = useState<PendingSessionBinding>();
  const [actionError, setActionError] = useState<WorktreeViewError>();
  const [actionPending, setActionPending] = useState(false);
  const { ref, width } = useSidebarWidth(mode === 'worktree');
  const collapsed = width <= 64;
  const query = searchQuery.trim().toLocaleLowerCase();

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

  const submitWorktree = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
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
      style={{ width: `${width}px` }}
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
            ×
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
            ⌕
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
            +
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
                  const allWorkspaceSessionIds = workspaceSessionIds(
                    workspaces,
                    workspace.workspaceId,
                    sessions.ids,
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
                          {expanded ? '⌄' : '›'}
                        </button>
                        <span className={styles.workspaceIcon} aria-hidden="true">
                          ▱
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
                          +
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
                                +
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
                              <button
                                key={sessionId}
                                type="button"
                                className={styles.treeSession}
                                data-session-id={sessionId}
                                onClick={() => {
                                  openWorktreeSession({ open: openSession }, sessionId);
                                }}
                              >
                                <span className={styles.treeGuide} aria-hidden="true">
                                  └
                                </span>
                                <span className={styles.sessionLabel}>
                                  {sessionLabel(sessionId, sessions)}
                                </span>
                              </button>
                            ))}

                          {worktrees.length === 0 && (
                            <p className={styles.emptyNested}>No Worktrees</p>
                          )}
                          {worktrees.map((record) => {
                            const worktreeSessionIds = bindingIdsFor(bindings, record.worktreeId).filter(
                              (sessionId) => sessions.ids.includes(sessionId),
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
                                <div className={styles.worktreeRow}>
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
                                    {worktreeExpanded ? '⌄' : '›'}
                                  </button>
                                  <span className={styles.worktreeIcon} aria-hidden="true">
                                    ◌
                                  </span>
                                  <span className={styles.worktreeLabel}>{record.branch}</span>
                                  <span className={styles.status}>{worktreeStatus(record)}</span>
                                  {record.status === 'active' && (
                                    <button
                                      type="button"
                                      className={styles.inlineButton}
                                      disabled={actionPending}
                                      aria-label={`Remove ${record.branch}`}
                                      onClick={() => {
                                        setWorktreeRemoval(record);
                                        setActionError(undefined);
                                      }}
                                    >
                                      Remove
                                    </button>
                                  )}
                                  {record.status === 'active' && (
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
                                      +
                                    </button>
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
                                      <button
                                        key={`${record.worktreeId}:${sessionId}`}
                                        type="button"
                                        className={styles.treeSession}
                                        data-session-id={sessionId}
                                        onClick={() => {
                                          openWorkspaceSession(workspace.workspaceId, sessionId);
                                        }}
                                      >
                                        <span className={styles.treeGuide} aria-hidden="true">
                                          └
                                        </span>
                                        <span className={styles.sessionLabel}>
                                          {sessionLabel(sessionId, sessions)}
                                        </span>
                                        <span className={styles.status}>
                                          {record.status === 'active' ? 'bound' : 'detached'}
                                        </span>
                                      </button>
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

      {worktreeModalWorkspaceId !== undefined && modalWorkspace !== undefined && (
        <div className={styles.modalBackdrop} role="presentation">
          <form
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-worktree-title"
            onSubmit={(event) => {
              void submitWorktree(event);
            }}
          >
            <div className={styles.modalHeader}>
              <h2 id="create-worktree-title" className={styles.modalTitle}>
                New Worktree
              </h2>
              <button
                type="button"
                className={styles.closeButton}
                aria-label="Close Create Worktree dialog"
                onClick={() => {
                  setWorktreeModalWorkspaceId(undefined);
                }}
              >
                ×
              </button>
            </div>
            <p className={styles.modalDescription}>
              {modalWorkspace.title} · the Worktree path is managed by DSH.
            </p>
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
              <input
                className={styles.textInput}
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
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalSecondaryButton}
                onClick={() => {
                  setWorktreeModalWorkspaceId(undefined);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.modalPrimaryButton}
                disabled={
                  actionPending ||
                  selectedBranch.length === 0 ||
                  newBranch.trim().length === 0
                }
              >
                Create Worktree
              </button>
            </div>
          </form>
        </div>
      )}

      {worktreeRemoval !== undefined && (
        <div className={styles.modalBackdrop} role="presentation">
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-worktree-title"
          >
            <div className={styles.modalHeader}>
              <h2 id="remove-worktree-title" className={styles.modalTitle}>
                Remove Worktree
              </h2>
              <button
                type="button"
                className={styles.closeButton}
                aria-label="Close Remove Worktree dialog"
                onClick={() => {
                  setWorktreeRemoval(undefined);
                }}
              >
                ×
              </button>
            </div>
            <p className={styles.modalDescription}>
              Remove {worktreeRemoval.branch}? Sessions stay in DSH and remain available as
              detached bindings.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.modalSecondaryButton}
                disabled={actionPending}
                onClick={() => {
                  setWorktreeRemoval(undefined);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.modalPrimaryButton}
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
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
