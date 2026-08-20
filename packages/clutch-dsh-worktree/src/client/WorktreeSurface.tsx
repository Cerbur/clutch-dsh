import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { SessionBinding, WorktreeManager, WorktreeRecord } from '../contract/index.js';
import { openWorktreeSession } from './navigation.js';
import type { createWorktreeViewStore } from './view-mode-store.js';
import { effectiveViewMode, initialWorkspaceId, unboundSessionIds } from './view-mode.js';
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

interface ReadState {
  readonly status: 'idle' | 'loading' | 'ready';
  readonly worktrees: readonly WorktreeRecord[];
  readonly bindings: readonly SessionBinding[];
}

const EMPTY_READ_STATE: ReadState = { status: 'idle', worktrees: [], bindings: [] };

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
 * Peer Worktree navigation surface. It owns no Session content and no Git
 * mutation controls in Phase 4; it only reads the mounted Manager facade and
 * opens existing DSH Sessions through the normal Session service.
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
  const wasWorktree = useRef(false);
  const { ref, width } = useSidebarWidth(mode === 'worktree');
  const collapsed = width <= 64;

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
    let disposed = false;
    if (mode !== 'worktree' || manager === undefined || workspaceId === undefined) {
      setReadState(EMPTY_READ_STATE);
      return () => {
        disposed = true;
      };
    }
    setReadState({ ...EMPTY_READ_STATE, status: 'loading' });
    void Promise.all([
      manager.listWorktrees({ workspaceId }),
      manager.listBindings({ workspaceId }),
    ]).then(
      ([worktrees, bindings]) => {
        if (disposed) return;
        setReadState({ status: 'ready', worktrees, bindings });
      },
      () => {
        if (disposed) return;
        // A sidecar/Remote read failure is a degraded plugin state: restore
        // the original DSH navigator instead of trapping the user in a dead
        // Worktree surface. The persisted preference follows the safe view.
        actions.setViewMode('workspace-session');
        setReadState(EMPTY_READ_STATE);
      },
    );
    return () => {
      disposed = true;
    };
  }, [manager, mode, workspaceId]);

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
          {readState.status === 'loading' && <p className={styles.message}>Loading Worktrees…</p>}
          <>
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
