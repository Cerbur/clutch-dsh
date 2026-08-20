import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { SessionBinding, WorktreeManager, WorktreeRecord } from '../contract/index.js';
import { openWorktreeSession } from './navigation.js';
import type { createWorktreeViewStore } from './view-mode-store.js';
import { effectiveViewMode, initialWorkspaceId, unboundSessionIds } from './view-mode.js';
import {
  executeWorktreeAction,
  loadWorktreeView,
  toWorktreeViewError,
  type WorktreeViewData,
  type WorktreeViewError,
} from './worktree-view.js';
import styles from './worktree.css';

/** Apply-time facts and DSH navigation callback used by the surface. */
export interface WorktreeSurfaceInjected {
  readonly available: boolean;
  readonly manager?: WorktreeManager;
  readonly openSession: (sessionId: string) => void;
}

/** Props derived from the frame overlay slot, shared state, and injected face. */
export type WorktreeSurfaceProps = PropsRuntime<'shell.overlay'> &
  PropsStore<ReturnType<typeof createWorktreeViewStore>> &
  WorktreeSurfaceInjected;

interface ReadState extends WorktreeViewData {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly error?: WorktreeViewError;
}

const EMPTY_READ_STATE: ReadState = { status: 'idle', worktrees: [], branches: [], bindings: [] };

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

function sessionLabel(
  sessionId: string,
  sessions: { readonly byId: Record<string, { readonly displayTitle?: string }> },
): string {
  return sessions.byId[sessionId]?.displayTitle ?? sessionId;
}

function worktreeStatus(record: WorktreeRecord): string {
  return record.status === 'active' ? 'active' : 'detached';
}

function bindingIdsFor(bindings: readonly SessionBinding[], worktreeId: string): readonly string[] {
  return bindings
    .filter((binding) => binding.worktreeId === worktreeId)
    .map((binding) => binding.sessionId);
}

/**
 * Peer Worktree navigation surface. It owns no Session content or wire details;
 * all Worktree reads and mutations cross the injected Manager contract.
 */
export function WorktreeSurface({
  useStore,
  actions,
  useSessions,
  useWorkspaces,
  available,
  manager,
  openSession,
}: WorktreeSurfaceProps) {
  const preferredMode = useStore((state) => state.viewMode);
  const mode = effectiveViewMode(preferredMode, available && manager !== undefined);
  const sessions = useSessions((state) => state);
  const workspaces = useWorkspaces((state) => state);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(() =>
    initialWorkspaceId(workspaces, sessions),
  );
  const fallbackWorkspaceId = initialWorkspaceId(workspaces, sessions);
  const selectedWorkspace = workspaces.items.find(
    (workspace) => workspace.workspaceId === selectedWorkspaceId,
  );
  const workspaceId =
    selectedWorkspace === undefined ? fallbackWorkspaceId : selectedWorkspace.workspaceId;
  const [readState, setReadState] = useState<ReadState>(EMPTY_READ_STATE);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedWorktreeId, setSelectedWorktreeId] = useState('');
  const [actionError, setActionError] = useState<WorktreeViewError>();
  const [actionPending, setActionPending] = useState(false);
  const wasWorktree = useRef(false);
  const { ref, width } = useSidebarWidth(mode === 'worktree');
  const collapsed = width <= 64;

  const refresh = useCallback(async (): Promise<void> => {
    if (manager === undefined || workspaceId === undefined) {
      setReadState(EMPTY_READ_STATE);
      return;
    }
    setReadState({ ...EMPTY_READ_STATE, status: 'loading' });
    try {
      const data = await loadWorktreeView(manager, workspaceId);
      setReadState({ status: 'ready', ...data });
    } catch (error) {
      setReadState({
        ...EMPTY_READ_STATE,
        status: 'error',
        error: toWorktreeViewError(error),
      });
    }
  }, [manager, workspaceId]);

  useEffect(() => {
    if (mode === 'worktree' && !wasWorktree.current) {
      const initial = initialWorkspaceId(workspaces, sessions);
      if (initial !== undefined) setSelectedWorkspaceId(initial);
    }
    wasWorktree.current = mode === 'worktree';
  }, [mode, sessions, workspaces]);

  useEffect(() => {
    if (selectedWorkspaceId !== undefined && selectedWorkspace !== undefined) return;
    if (selectedWorkspaceId !== fallbackWorkspaceId) setSelectedWorkspaceId(fallbackWorkspaceId);
  }, [fallbackWorkspaceId, selectedWorkspace, selectedWorkspaceId]);

  useEffect(() => {
    if (mode !== 'worktree' || manager === undefined || workspaceId === undefined) {
      setReadState(EMPTY_READ_STATE);
      return () => {
        // Keep the effect shape stable while leaving the original DSH view untouched.
      };
    }
    void refresh();
    return undefined;
  }, [manager, mode, refresh, workspaceId]);

  useEffect(() => {
    const availableBranch = readState.branches.find((branch) => !branch.checkedOut);
    if (readState.branches.some((branch) => branch.name === selectedBranch)) return;
    setSelectedBranch(availableBranch?.name ?? '');
  }, [readState.branches, selectedBranch]);

  useEffect(() => {
    if (
      readState.worktrees.some(
        (record) => record.worktreeId === selectedWorktreeId && record.status === 'active',
      )
    ) {
      return;
    }
    setSelectedWorktreeId(
      readState.worktrees.find((record) => record.status === 'active')?.worktreeId ?? '',
    );
  }, [readState.worktrees, selectedWorktreeId]);

  const runAction = async (action: Parameters<typeof executeWorktreeAction>[1]): Promise<void> => {
    if (manager === undefined) return;
    setActionPending(true);
    setActionError(undefined);
    try {
      await executeWorktreeAction(manager, action);
      await refresh();
    } catch (error) {
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };

  if (mode !== 'worktree') return null;

  const boundSessionIds = new Set(readState.bindings.map((binding) => binding.sessionId));
  const mainSessionIds = unboundSessionIds(sessions.ids, [...boundSessionIds]);
  const selectSession = (sessionId: string): void => {
    openWorktreeSession({ open: openSession }, sessionId);
  };

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
        <label className={styles.workspaceLabel}>
          Workspace
          <select
            className={styles.workspacePicker}
            aria-label="Worktree Workspace"
            value={workspaceId ?? ''}
            onChange={(event) => {
              setSelectedWorkspaceId(event.currentTarget.value || undefined);
            }}
          >
            {workspaces.items.map((candidate) => (
              <option key={candidate.workspaceId} value={candidate.workspaceId}>
                {candidate.title}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.content}>
          {actionError !== undefined && (
            <div className={styles.error} role="alert" data-worktree-error>
              <p className={styles.message} data-error="true">
                {actionError.message}
              </p>
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
          {readState.status === 'loading' && <p className={styles.message}>Loading Worktrees…</p>}
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
            <>
              <section className={styles.actions} aria-label="Worktree actions">
                <label className={styles.actionLabel}>
                  Branch
                  <select
                    className={styles.actionSelect}
                    aria-label="Worktree branch"
                    value={selectedBranch}
                    disabled={actionPending}
                    onChange={(event) => {
                      setSelectedBranch(event.currentTarget.value);
                    }}
                  >
                    <option value="">No available branch</option>
                    {readState.branches.map((branch) => (
                      <option key={branch.name} value={branch.name} disabled={branch.checkedOut}>
                        {branch.name}
                        {branch.checkedOut ? ' (checked out)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={styles.actionButton}
                  disabled={actionPending || selectedBranch === ''}
                  onClick={() => {
                    void runAction({
                      type: 'createWorktree',
                      input: { workspaceId: workspaceId ?? '', branch: selectedBranch },
                    });
                  }}
                >
                  Create Worktree
                </button>
                <label className={styles.actionLabel}>
                  Bind current Session
                  <select
                    className={styles.actionSelect}
                    aria-label="Worktree to bind"
                    value={selectedWorktreeId}
                    disabled={actionPending}
                    onChange={(event) => {
                      setSelectedWorktreeId(event.currentTarget.value);
                    }}
                  >
                    <option value="">Select Worktree</option>
                    {readState.worktrees
                      .filter((record) => record.status === 'active')
                      .map((record) => (
                        <option key={record.worktreeId} value={record.worktreeId}>
                          {record.branch}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={styles.actionButton}
                  disabled={
                    actionPending || selectedWorktreeId === '' || sessions.current === undefined
                  }
                  onClick={() => {
                    if (sessions.current === undefined || workspaceId === undefined) return;
                    void runAction({
                      type: 'bindSession',
                      input: {
                        workspaceId,
                        worktreeId: selectedWorktreeId,
                        sessionId: sessions.current,
                      },
                    });
                  }}
                >
                  Bind current Session
                </button>
              </section>
              <section className={styles.section} aria-labelledby="worktree-main-heading">
                <h2 id="worktree-main-heading" className={styles.sectionTitle}>
                  Main
                </h2>
                {mainSessionIds.length === 0 ? (
                  <p className={styles.empty}>No unbound Sessions</p>
                ) : (
                  mainSessionIds.map((sessionId) => (
                    <button
                      key={sessionId}
                      type="button"
                      className={styles.session}
                      data-session-id={sessionId}
                      onClick={() => {
                        selectSession(sessionId);
                      }}
                    >
                      <span className={styles.sessionLabel}>
                        {sessionLabel(sessionId, sessions)}
                      </span>
                    </button>
                  ))
                )}
              </section>
              <section className={styles.section} aria-labelledby="worktree-active-heading">
                <h2 id="worktree-active-heading" className={styles.sectionTitle}>
                  Worktrees
                </h2>
                {readState.worktrees.length === 0 ? (
                  <p className={styles.empty}>No Worktrees</p>
                ) : (
                  readState.worktrees.map((record) => (
                    <div
                      key={record.worktreeId}
                      className={styles.worktree}
                      data-worktree-id={record.worktreeId}
                    >
                      <span className={styles.worktreeLabel}>{record.branch}</span>
                      <span className={styles.status}>{worktreeStatus(record)}</span>
                      {record.status === 'active' && (
                        <button
                          type="button"
                          className={styles.inlineButton}
                          disabled={actionPending}
                          onClick={() => {
                            void runAction({
                              type: 'removeWorktree',
                              input: {
                                workspaceId: record.workspaceId,
                                worktreeId: record.worktreeId,
                              },
                            });
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))
                )}
                {readState.worktrees.map((record) =>
                  bindingIdsFor(readState.bindings, record.worktreeId).map((sessionId) => (
                    <button
                      key={`${record.worktreeId}:${sessionId}`}
                      type="button"
                      className={styles.session}
                      data-session-id={sessionId}
                      onClick={() => {
                        selectSession(sessionId);
                      }}
                    >
                      <span className={styles.sessionLabel}>
                        {sessionLabel(sessionId, sessions)}
                      </span>
                      <span className={styles.status}>
                        {record.status === 'active' ? 'bound' : 'detached'}
                      </span>
                    </button>
                  )),
                )}
              </section>
            </>
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
    </aside>
  );
}
