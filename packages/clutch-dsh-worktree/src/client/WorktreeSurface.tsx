import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type {
  PropsLocale,
  PropsRuntime,
  PropsStore,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import {
  Button,
  HoverCard,
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
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { SessionBinding, WorktreeManager, WorktreeRecord } from '../contract/index.js';
import { WORKTREE_NS } from './locales.js';
import { openWorktreeSession } from './navigation.js';
import { useSidebarOverlayGeometry } from './sidebar-overlay-geometry.js';
import type { createWorktreeViewStore } from './view-mode-store.js';
import { effectiveViewMode, unboundSessionIds, workspaceSessionIds } from './view-mode.js';
import { formatWorktreeViewError } from './worktree-error-copy.js';
import {
  executeWorktreeAction,
  createDefaultWorktreeName,
  filterArchivedSessionIds,
  loadWorktreeViews,
  reconcileBaseBranchSelection,
  resolveWorktreeMove,
  selectDefaultBaseBranch,
  stableWorkspaceIds,
  toRetryableWorktreeOrderError,
  toWorktreeViewError,
  WorktreeSessionBindingError,
  type CreateSessionForWorktreeInput,
  type WorktreeGitReadiness,
  type WorktreeViewError,
  type WorktreeWorkspaceView,
  worktreeSetupCommands,
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
  readonly renameWorkspace?: (workspaceId: string, title: string) => Promise<void>;
  readonly deleteWorkspace?: (workspaceId: string) => Promise<void>;
  readonly insertWorkspaceBefore?: (
    workspaceId: string,
    beforeWorkspaceId?: string,
  ) => Promise<void>;
  readonly insertSessionBefore?: (
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
  ) => Promise<void>;
  readonly insertWorktreeBefore?: (
    workspaceId: string,
    worktreeId: string,
    beforeWorktreeId?: string,
  ) => Promise<readonly string[]>;
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
  PropsLocale<typeof WORKTREE_NS> &
  WorktreeSurfaceInjected;

type WorktreeTranslate = TranslateNS<typeof WORKTREE_NS>;

type WorktreeSetupStatus = Exclude<WorktreeGitReadiness['status'], 'ready'>;

function worktreeSetupMessage(
  status: WorktreeSetupStatus,
  t: WorktreeTranslate,
): string {
  switch (status) {
    case 'noRepository':
      return t('worktree.setup.noRepository');
    case 'noInitialCommit':
      return t('worktree.setup.noInitialCommit');
    case 'noLocalBranch':
      return t('worktree.setup.noLocalBranch');
  }
}

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
  readonly t: WorktreeTranslate;
  readonly sessionId: string;
  readonly label: string;
  readonly drag: SessionDragProps;
  readonly actionPending: boolean;
  readonly onOpen: () => void;
  readonly onRename?: (sessionId: string, currentTitle: string) => void;
  readonly onFork?: (sessionId: string) => void;
  readonly onArchive?: (sessionId: string) => void;
}

interface SessionDragProps {
  readonly active: boolean;
  readonly marker: 'before' | 'after' | null;
  readonly start: () => void;
  readonly hover: (half: 'before' | 'after') => void;
  readonly drop: (half: 'before' | 'after') => void;
  readonly end: () => void;
}

interface WorkspaceDragProps {
  readonly active: boolean;
  readonly marker: 'before' | 'after' | null;
  readonly start: () => void;
  readonly hover: (half: 'before' | 'after') => void;
  readonly drop: (half: 'before' | 'after') => void;
  readonly end: () => void;
}

interface WorktreeDragProps {
  readonly active: boolean;
  readonly marker: 'before' | 'after' | null;
  readonly start: () => void;
  readonly hover: (half: 'before' | 'after') => void;
  readonly drop: (half: 'before' | 'after') => void;
  readonly end: () => void;
}

interface WorktreeWorkspaceRowProps {
  readonly t: WorktreeTranslate;
  readonly workspace: WorkspaceLike;
  readonly expanded: boolean;
  readonly actionPending: boolean;
  readonly menuOpen: boolean;
  readonly drag: WorkspaceDragProps;
  readonly onToggle: () => void;
  readonly onCreateWorktree: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onMenuOpenChange: (open: boolean) => void;
}

interface WorkspaceDragState {
  readonly workspaceId: string;
  readonly over: {
    readonly workspaceId: string;
    readonly half: 'before' | 'after';
  } | null;
}

interface WorkspaceRenameTarget {
  readonly workspaceId: string;
  readonly currentTitle: string;
}

interface WorkspaceDeleteTarget {
  readonly workspaceId: string;
  readonly title: string;
}

interface SessionDragState {
  readonly groupKey: string;
  readonly sessionId: string;
  readonly over: {
    readonly sessionId: string;
    readonly half: 'before' | 'after';
  } | null;
}

interface WorktreeDragState {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly over: {
    readonly worktreeId: string;
    readonly half: 'before' | 'after';
  } | null;
}

function toNativeWorktreeViewError(error: unknown): WorktreeViewError {
  const viewError = toWorktreeViewError(error);
  if (typeof error === 'object' && error !== null) return viewError;
  return { ...viewError, message: String(error) };
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

function rowHalf(event: ReactDragEvent<HTMLElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function bindingIdsFor(bindings: readonly SessionBinding[], worktreeId: string): readonly string[] {
  return bindings
    .filter((binding) => binding.worktreeId === worktreeId)
    .map((binding) => binding.sessionId);
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

/** Workspace row using the native DSH menu, fixed action column, and drag contract. */
function WorktreeWorkspaceRow({
  t,
  workspace,
  expanded,
  actionPending,
  menuOpen,
  drag,
  onToggle,
  onCreateWorktree,
  onRename,
  onDelete,
  onMenuOpenChange,
}: WorktreeWorkspaceRowProps) {
  const workspaceMenuItems = [
    {
      id: 'rename',
      label: t('workspace.rename'),
      icon: <IconEditOutline16 />,
      disabled: actionPending,
    },
    {
      id: 'delete',
      label: t('workspace.delete'),
      icon: <IconTrashOutline16 />,
      danger: true,
      disabled: actionPending,
    },
  ];
  const markerClass = drag.marker === 'before'
    ? styles.dropBefore
    : drag.marker === 'after'
      ? styles.dropAfter
      : '';

  return (
    <div
      className={`${styles.workspaceRow} ${markerClass}`}
      data-workspace-drag={drag.active ? 'active' : undefined}
      data-menu-open={menuOpen || undefined}
      draggable
      onClick={() => {
        onToggle();
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', workspace.workspaceId);
        drag.start();
      }}
      onDragEnd={drag.end}
      onDragOver={(event) => {
        if (!drag.active) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        drag.hover(rowHalf(event));
      }}
      onDrop={(event) => {
        if (!drag.active) return;
        event.preventDefault();
        drag.drop(rowHalf(event));
      }}
    >
      <button
        type="button"
        className={`${styles.disclosureButton} ${styles.workspaceDisclosure}`}
        aria-label={t(expanded ? 'workspace.collapse' : 'workspace.expand', {
          name: workspace.title,
        })}
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        {expanded ? (
          <IconChevronDownOutline14 size={18} />
        ) : (
          <IconChevronRightOutline14 size={18} />
        )}
      </button>
      <span className={styles.workspaceIcon} aria-hidden="true">
        {expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />}
      </span>
      <span className={styles.workspaceTitle}>{workspace.title}</span>
      <span className={`${styles.treeActionSlot} ${styles.workspaceActions}`}>
        <span className={styles.menuAction}>
          <Menu
            open={menuOpen}
            onClose={() => {
              onMenuOpenChange(false);
            }}
            items={workspaceMenuItems}
            onSelect={(id) => {
              onMenuOpenChange(false);
              if (id === 'rename') onRename();
              if (id === 'delete') onDelete();
            }}
            portal
            closeOnPointerLeave
            anchor={(
              <button
                type="button"
                className={styles.iconButton}
                data-workspace-menu
                aria-label={t('workspace.options', { name: workspace.title })}
                onClick={(event) => {
                  event.stopPropagation();
                  onMenuOpenChange(!menuOpen);
                }}
              >
                <IconEllipsisOutline16 />
              </button>
            )}
          />
        </span>
        <button
          type="button"
          className={styles.iconButton}
          data-add-worktree
          aria-label={t('workspace.addWorktree', { name: workspace.title })}
          onClick={(event) => {
            event.stopPropagation();
            onCreateWorktree();
          }}
        >
          <IconPlusOutline16 />
        </button>
      </span>
    </div>
  );
}

type WorktreeGroupKind = 'main' | 'worktree';

interface WorktreeGroupMenuProps {
  readonly open: boolean;
  readonly label: string;
  readonly disabled: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRemove: () => void;
}

interface WorktreeGroupRowProps {
  readonly t: WorktreeTranslate;
  readonly kind: WorktreeGroupKind;
  readonly label: string;
  readonly worktreeId?: string;
  readonly expanded: boolean;
  readonly icon: ReactNode;
  readonly workspaceTitle: string;
  readonly state?: 'done' | 'warning' | 'error';
  readonly stateLabel?: string;
  readonly onToggle: () => void;
  readonly onCreateSession?: () => void;
  readonly menu?: WorktreeGroupMenuProps;
  readonly drag?: WorktreeDragProps;
}

/** Shared Main/Worktree group row with parameterized icon, state, and actions. */
function WorktreeGroupRow({
  t,
  kind,
  label,
  worktreeId,
  expanded,
  icon,
  workspaceTitle,
  state,
  stateLabel,
  onToggle,
  onCreateSession,
  menu,
  drag,
}: WorktreeGroupRowProps) {
  const main = kind === 'main';
  const markerClass = drag?.marker === 'before'
    ? styles.dropBefore
    : drag?.marker === 'after'
      ? styles.dropAfter
      : '';
  const dragProps = drag === undefined
    ? {}
    : {
        draggable: true,
        onDragStart: (event: ReactDragEvent<HTMLElement>) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', worktreeId ?? label);
          drag.start();
        },
        onDragEnd: drag.end,
        onDragOver: (event: ReactDragEvent<HTMLElement>) => {
          if (!drag.active) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          drag.hover(rowHalf(event));
        },
        onDrop: (event: ReactDragEvent<HTMLElement>) => {
          if (!drag.active) return;
          event.preventDefault();
          drag.drop(rowHalf(event));
        },
      };

  const row = (
    <div
      className={`${styles.worktreeRow} ${markerClass}`}
      data-main-group={main ? 'true' : undefined}
      data-main-expanded={main ? String(expanded) : undefined}
      data-menu-open={menu?.open ? 'true' : undefined}
      data-worktree-drag={drag?.active ? 'active' : undefined}
      {...dragProps}
      onClick={onToggle}
    >
      <button
        type="button"
        className={`${styles.disclosureButton} ${styles.worktreeDisclosure}`}
        aria-label={t(expanded ? 'worktree.collapse' : 'worktree.expand', { name: label })}
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        {expanded ? (
          <IconChevronDownOutline14 size={18} />
        ) : (
          <IconChevronRightOutline14 size={18} />
        )}
      </button>
      <span className={styles.worktreeIcon} aria-hidden="true">
        {icon}
      </span>
      {state !== undefined && stateLabel !== undefined && (
        <span
          className={styles.worktreeState}
          role="img"
          aria-label={stateLabel}
          title={stateLabel}
        >
          <StateDot state={state} />
        </span>
      )}
      <span className={styles.worktreeLabel}>{label}</span>
      <span className={styles.treeActionSlot}>
        {menu !== undefined && (
          <span className={styles.menuAction}>
            <Menu
              open={menu.open}
              onClose={() => {
                menu.onOpenChange(false);
              }}
              items={[
                {
                  id: 'remove',
                  label: t('worktree.remove'),
                  icon: <IconTrashOutline16 />,
                  danger: true,
                  disabled: menu.disabled,
                },
              ]}
              onSelect={(id) => {
                menu.onOpenChange(false);
                if (id === 'remove') menu.onRemove();
              }}
              portal
              closeOnPointerLeave
              anchor={
                <button
                  type="button"
                  className={styles.iconButton}
                  data-worktree-menu
                  aria-label={t('worktree.options', { name: menu.label })}
                  onClick={(event) => {
                    event.stopPropagation();
                    menu.onOpenChange(!menu.open);
                  }}
                >
                  <IconEllipsisOutline16 />
                </button>
              }
            />
          </span>
        )}
        {onCreateSession !== undefined && (
          <button
            type="button"
            className={styles.iconButton}
            data-add-main-session={main ? 'true' : undefined}
            data-add-session={main ? undefined : 'true'}
            aria-label={t('worktree.addSession', { name: workspaceTitle })}
            onClick={(event) => {
              event.stopPropagation();
              onCreateSession();
            }}
          >
            <IconPlusOutline16 />
          </button>
        )}
      </span>
    </div>
  );

  if (main) return row;
  return (
    <HoverCard
      anchor={row}
      content={<div className={styles.worktreeHoverTitle}>{label}</div>}
      openDelayMs={500}
      disabled={menu?.open === true}
    />
  );
}

/** Worktree-mode Session row with the same trailing options menu as native DSH rows. */
function WorktreeSessionRow({
  t,
  sessionId,
  label,
  drag,
  actionPending,
  onOpen,
  onRename,
  onFork,
  onArchive,
}: WorktreeSessionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const markerClass = drag.marker === 'before'
    ? styles.dropBefore
    : drag.marker === 'after'
      ? styles.dropAfter
      : '';
  const sessionMenuItems = [
    {
      id: 'rename',
      label: t('session.rename'),
      icon: <IconEditOutline16 />,
      disabled: onRename === undefined || actionPending,
    },
    {
      id: 'fork',
      label: t('session.fork'),
      icon: <IconBranchOutline16 />,
      disabled: onFork === undefined || actionPending,
    },
    {
      id: 'archive',
      label: t('session.archive'),
      icon: <IconArchiveOutline20 size={16} />,
      disabled: onArchive === undefined || actionPending,
    },
  ];

  return (
    <div
      className={`${styles.treeSessionRow} ${markerClass}`}
      data-session-id={sessionId}
      data-session-drag={drag.active ? 'active' : undefined}
      data-menu-open={menuOpen || undefined}
      role="treeitem"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', sessionId);
        drag.start();
      }}
      onDragEnd={drag.end}
      onDragOver={(event) => {
        if (!drag.active) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        drag.hover(rowHalf(event));
      }}
      onDrop={(event) => {
        if (!drag.active) return;
        event.preventDefault();
        drag.drop(rowHalf(event));
      }}
    >
      <button type="button" className={styles.treeSessionContent} onClick={onOpen}>
        <span className={styles.treeGuide} aria-hidden="true">
          └
        </span>
        <span className={styles.sessionLabel}>{label}</span>
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
              aria-label={t('session.options', { name: label })}
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

interface WorktreeSessionGroupProps {
  readonly t: WorktreeTranslate;
  readonly groupKey: string;
  readonly sessionIds: readonly string[];
  readonly workspaceId: string;
  readonly expanded: boolean;
  readonly actionPending: boolean;
  readonly sessions: SessionListLike;
  readonly dragState: SessionDragState | undefined;
  readonly onToggleExpanded: () => void;
  readonly onStartDrag: (groupKey: string, sessionId: string) => void;
  readonly onHoverDrag: (sessionId: string, half: 'before' | 'after') => void;
  readonly onClearDrag: () => void;
  readonly onFinishDrag: () => void;
  readonly onCommitDrag: (
    activeDrag: SessionDragState,
    over: NonNullable<SessionDragState['over']>,
    sessionIds: readonly string[],
    workspaceId: string,
  ) => void;
  readonly onOpen: (sessionId: string) => void;
  readonly onRename?: (sessionId: string, currentTitle: string) => void;
  readonly onFork?: (sessionId: string) => void;
  readonly onArchive?: (sessionId: string) => void;
}

function WorktreeSessionGroup({
  t,
  groupKey,
  sessionIds,
  workspaceId,
  expanded,
  actionPending,
  sessions,
  dragState,
  onToggleExpanded,
  onStartDrag,
  onHoverDrag,
  onClearDrag,
  onFinishDrag,
  onCommitDrag,
  onOpen,
  onRename,
  onFork,
  onArchive,
}: WorktreeSessionGroupProps) {
  const visibleSessionIds = expanded ? sessionIds : sessionIds.slice(0, 5);
  const sameGroupDrag = dragState?.groupKey === groupKey;

  return (
    <>
      {visibleSessionIds.map((sessionId) => (
        <WorktreeSessionRow
          t={t}
          key={`${groupKey}:${sessionId}`}
          sessionId={sessionId}
          label={sessionLabel(sessionId, sessions)}
          drag={{
            active: sameGroupDrag,
            marker:
              sameGroupDrag && dragState.over?.sessionId === sessionId
                ? dragState.over.half
                : null,
            start: () => {
              onStartDrag(groupKey, sessionId);
            },
            hover: (half) => {
              onHoverDrag(sessionId, half);
            },
            drop: (half) => {
              if (dragState === undefined) return;
              onCommitDrag(
                dragState,
                { sessionId, half },
                sessionIds,
                workspaceId,
              );
            },
            end: () => {
              if (dragState?.over !== null && dragState?.over !== undefined) {
                onCommitDrag(dragState, dragState.over, sessionIds, workspaceId);
              } else {
                onClearDrag();
              }
              onFinishDrag();
            },
          }}
          actionPending={actionPending}
          onOpen={() => {
            onOpen(sessionId);
          }}
          onRename={onRename}
          onFork={onFork}
          onArchive={onArchive}
        />
      ))}
      {sessionIds.length > 5 && (
        <button
          type="button"
          className={styles.sessionOverflowButton}
          aria-expanded={expanded}
          onClick={onToggleExpanded}
        >
          {expanded
            ? t('session.collapse')
            : t('session.expandMore', { count: sessionIds.length - 5 })}
        </button>
      )}
    </>
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
  t,
  available,
  manager,
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
  const workspaceIds = useStableWorkspaceIds(workspaces.items);
  const [readState, setReadState] = useState<ReadState>(EMPTY_READ_STATE);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Record<string, boolean>>({});
  const [expandedMains, setExpandedMains] = useState<Record<string, boolean>>({});
  const [expandedWorktrees, setExpandedWorktrees] = useState<Record<string, boolean>>({});
  const [worktreeModalWorkspaceId, setWorktreeModalWorkspaceId] = useState<string>();
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
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<Record<string, boolean>>({});
  const sessionDropCommitted = useRef(false);
  const [worktreeDrag, setWorktreeDrag] = useState<WorktreeDragState>();
  const worktreeDropCommitted = useRef(false);
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
  const modalReadiness = modalView?.readiness;
  const modalSetupStatus: WorktreeSetupStatus | undefined = modalView === undefined
    ? undefined
    : modalReadiness?.status === 'ready'
      ? modalView.branches.length === 0 ? 'noLocalBranch' : undefined
      : modalReadiness?.status;
  const modalCanCreate = modalSetupStatus === undefined && modalReadiness?.status === 'ready';

  useEffect(() => {
    if (worktreeModalWorkspaceId === undefined || modalView === undefined) return;
    if (modalView.readiness.status !== 'ready') {
      setSelectedBranch('');
      return;
    }
    setSelectedBranch((current) =>
      reconcileBaseBranchSelection(current, modalView.branches),
    );
  }, [modalView, worktreeModalWorkspaceId]);

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
      .then(() => refresh())
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

  const toggleWorkspace = (workspaceId: string): void => {
    setExpandedWorkspaces((current) => ({
      ...current,
      [workspaceId]: current[workspaceId] === false,
    }));
  };

  const toggleMain = (workspaceId: string): void => {
    setExpandedMains((current) => ({
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
      !modalCanCreate ||
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
        throw {
          code: 'WORKTREE_RECORD_MISSING',
          message: '',
          retryable: true,
        };
      }
      setWorktreeModalWorkspaceId(undefined);

      if (createSessionCallback === undefined) {
        await refresh();
        setActionError({
          code: 'WORKTREE_CREATED_SESSION_UNAVAILABLE',
          message: '',
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
            <IconPlusOutline16 />
          </button>
        </div>

        <div className={styles.content} tabIndex={0}>
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
                    disabled={actionPending}
                    onClick={() => {
                      void retrySessionBinding();
                    }}
                  >
                    {t('action.retryBinding')}
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
                    {t('action.openCreatedSession')}
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
                  const visibleMainSessionIds = mainSessionIds.filter(
                    (sessionId) =>
                      workspaceMatchesQuery ||
                      includesText(sessionLabel(sessionId, sessions), query),
                  );
                  const mainExpanded = expandedMains[workspace.workspaceId] !== false;
                  const mainGroupKey = `main:${workspace.workspaceId}`;
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
                              sessionIds={visibleMainSessionIds}
                              workspaceId={workspace.workspaceId}
                              expanded={expandedSessionGroups[mainGroupKey] === true}
                              actionPending={actionPending}
                              sessions={sessions}
                              dragState={sessionDrag}
                              onToggleExpanded={() => {
                                setExpandedSessionGroups((current) => ({
                                  ...current,
                                  [mainGroupKey]: current[mainGroupKey] !== true,
                                }));
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
                            const visibleWorktreeSessionIds = worktreeSessionIds.filter(
                              (sessionId) =>
                                worktreeMatchesQuery ||
                                includesText(sessionLabel(sessionId, sessions), query),
                            );
                            const worktreeGroupKey = `worktree:${record.worktreeId}`;
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
                              expandedWorktrees[record.worktreeId] !== false;
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
                                    record.status === 'active'
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
                                    sessionIds={visibleWorktreeSessionIds}
                                    workspaceId={workspace.workspaceId}
                                    expanded={expandedSessionGroups[worktreeGroupKey] === true}
                                    actionPending={actionPending}
                                    sessions={sessions}
                                    dragState={sessionDrag}
                                    onToggleExpanded={() => {
                                      setExpandedSessionGroups((current) => ({
                                        ...current,
                                        [worktreeGroupKey]: current[worktreeGroupKey] !== true,
                                      }));
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

      <div className={styles.railContent}>
        <button
          type="button"
          className={styles.railButton}
          aria-label={t('mode.exit')}
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
        closeLabel={t('dialog.close')}
        title={t('session.rename')}
        footer={(
          <>
            <Button variant="outline" disabled={sessionRenamePending} onClick={closeSessionRename}>
              {t('dialog.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={sessionRenamePending || sessionRenameDraft.trim().length === 0}
              onClick={() => {
                void confirmSessionRename();
              }}
            >
              {t('dialog.rename')}
            </Button>
          </>
        )}
      >
        <Input
          className={styles.renameInput}
          value={sessionRenameDraft}
          aria-label={t('session.name')}
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
            {formatWorktreeViewError(sessionRenameError, t)}
          </p>
        )}
      </Modal>

      {workspaceRenameTarget !== undefined && (
        <Modal
          open={workspaceRenameTarget !== undefined}
          onClose={closeWorkspaceRename}
          closeLabel={t('dialog.closeWorkspaceRename')}
          title={t('workspace.renameTitle')}
          footer={(
            <>
              <Button variant="outline" disabled={workspaceRenamePending} onClick={closeWorkspaceRename}>
                {t('dialog.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={workspaceRenameBlocked}
                onClick={() => {
                  void confirmWorkspaceRename();
                }}
              >
                {t('dialog.rename')}
              </Button>
            </>
          )}
        >
          <Input
            className={styles.renameInput}
            value={workspaceRenameDraft}
            aria-label={t('workspace.name')}
            autoFocus
            disabled={workspaceRenamePending}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            onChange={(event) => {
              setWorkspaceRenameDraft(event.currentTarget.value);
              setWorkspaceRenameError(undefined);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void confirmWorkspaceRename();
              }
            }}
          />
          {workspaceRenameDuplicate && (
            <p className={styles.renameError} role="alert">
              {t('workspace.duplicate')}
            </p>
          )}
          {workspaceRenameError !== undefined && (
            <p className={styles.renameError} role="alert">
              {formatWorktreeViewError(workspaceRenameError, t)}
            </p>
          )}
        </Modal>
      )}

      {workspaceDeleteTarget !== undefined && (
        <Modal
          open={workspaceDeleteTarget !== undefined}
          onClose={closeWorkspaceDelete}
          closeLabel={t('dialog.closeWorkspaceDelete')}
          title={t('workspace.deleteTitle')}
          description={t('workspace.deleteDescription', { name: workspaceDeleteTarget.title })}
          footer={(
            <>
              <Button variant="outline" disabled={workspaceDeletePending} onClick={closeWorkspaceDelete}>
                {t('dialog.cancel')}
              </Button>
              <Button
                variant="outline"
                disabled={workspaceDeletePending}
                onClick={() => {
                  void confirmWorkspaceDelete();
                }}
              >
                {t('dialog.delete')}
              </Button>
            </>
          )}
        >
          {workspaceDeleteError !== undefined && (
            <p className={styles.renameError} role="alert">
              {formatWorktreeViewError(workspaceDeleteError, t)}
            </p>
          )}
        </Modal>
      )}

      {worktreeModalWorkspaceId !== undefined && modalWorkspace !== undefined && (
        <Modal
          open={worktreeModalWorkspaceId !== undefined}
          onClose={() => {
            if (actionPending) return;
            setWorktreeModalWorkspaceId(undefined);
          }}
          closeLabel={t('dialog.closeWorktreeCreate')}
          title={t('worktree.createTitle')}
          description={t('worktree.createDescription', { name: modalWorkspace.title })}
          footer={(
            <>
              <Button
                variant="outline"
                disabled={actionPending}
                onClick={() => {
                  setWorktreeModalWorkspaceId(undefined);
                }}
              >
                {t('dialog.cancel')}
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
                {t('worktree.create')}
              </Button>
            </>
          )}
        >
          {modalCanCreate ? (
            <>
              <label className={styles.modalField}>
                {t('worktree.baseBranch')}
                <select
                  className={styles.actionSelect}
                  aria-label={t('worktree.baseBranch')}
                  value={selectedBranch}
                  disabled={actionPending}
                  onChange={(event) => {
                    setSelectedBranch(event.currentTarget.value);
                  }}
                >
                  {modalView?.branches.map((branch) => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name}
                      {branch.isCurrent ? t('branch.current') : ''}
                      {branch.checkedOut ? t('branch.checkedOut') : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.modalField}>
                {t('worktree.name')}
                <Input
                  className={styles.renameInput}
                  aria-label={t('worktree.name')}
                  value={newBranch}
                  placeholder="dsh/12345678"
                  disabled={actionPending}
                  onChange={(event) => {
                    setNewBranch(event.currentTarget.value);
                  }}
                />
              </label>
            </>
          ) : (
            <div
              className={styles.gitReadiness}
              data-worktree-readiness={modalSetupStatus ?? 'loading'}
              role="alert"
            >
              <p className={styles.message}>
                {modalSetupStatus === undefined
                  ? t('status.loading')
                  : worktreeSetupMessage(modalSetupStatus, t)}
              </p>
              {modalSetupStatus !== undefined && (
                <pre
                  className={styles.commandBlock}
                  aria-label={t('worktree.setup.commands')}
                >
                  {worktreeSetupCommands(modalSetupStatus).join('\n')}
                </pre>
              )}
            </div>
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
          closeLabel={t('dialog.closeWorktreeRemove')}
          title={t('worktree.remove')}
          description={t('worktree.removeDescription', { name: worktreeRemoval.branch })}
          footer={(
            <>
              <Button
                variant="outline"
                disabled={actionPending}
                onClick={() => {
                  setWorktreeRemoval(undefined);
                }}
              >
                {t('dialog.cancel')}
              </Button>
              <Button
                variant="primary"
                disabled={actionPending}
                onClick={() => {
                  if (manager === undefined) return;
                  const target = worktreeRemoval;
                  void runMutation(async () => {
                    await executeWorktreeAction(manager, {
                      type: 'removeWorktree',
                      input: {
                        workspaceId: target.workspaceId,
                        worktreeId: target.worktreeId,
                      },
                    });
                    setWorktreeRemoval(undefined);
                  });
                }}
              >
                {t('worktree.remove')}
              </Button>
            </>
          )}
        />
      )}

    </aside>
  );
}
