import { useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import {
  HoverCard,
  IconArchiveOutline20,
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCopyOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconPlusOutline16,
  IconTrashOutline16,
  Menu,
  StateDot,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives';
import {
  isBlankSession,
  relativeTime,
  type RelativeTime,
  type SessionPresentation,
  type SessionStatusPresentation,
} from './session-view.js';
import { sessionLabel } from './worktree-surface-selectors.js';
import type {
  WorktreeGroupRowProps,
  WorktreeSessionGroupProps,
  WorktreeSessionRowProps,
  WorktreeWorkspaceRowProps,
} from './worktree-surface-types.js';
import styles from './worktree.css';

function rowHalf(event: ReactDragEvent<HTMLElement>): 'before' | 'after' {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

function sessionStatusLabel(
  t: WorktreeSessionRowProps['t'],
  status: SessionStatusPresentation,
): string {
  switch (status.labelKey) {
    case 'running':
      return t('session.status.running');
    case 'subagentsRunning':
      return t(
        status.runningSubagentCount === 1
          ? 'session.status.subagentsRunning.one'
          : 'session.status.subagentsRunning.other',
        { n: status.runningSubagentCount },
      );
    case 'idle':
      return t('session.status.idle');
    case 'waitingApproval':
      return t('session.status.waitingApproval');
    case 'planReview':
      return t('session.status.planReview');
    case 'waitingAnswer':
      return t('session.status.waitingAnswer');
    case 'completed':
      return t('session.status.completed');
  }
}

function sessionTimeLabel(t: WorktreeSessionRowProps['t'], value: RelativeTime): string {
  switch (value.unit) {
    case 'now':
      return t('session.time.now');
    case 'minutes':
      return t('session.time.minutes', { n: value.n });
    case 'hours':
      return t('session.time.hours', { n: value.n });
    case 'days':
      return t('session.time.days', { n: value.n });
    case 'months':
      return t('session.time.months', { n: value.n });
    case 'years':
      return t('session.time.years', { n: value.n });
  }
}

/** Native Workspace hover-card time copy, including the trailing "ago" marker. */
function sessionHoverTimeLabel(
  t: WorktreeSessionRowProps['t'],
  value: RelativeTime,
): string {
  const label = sessionTimeLabel(t, value);
  return value.unit === 'now' ? label : t('session.time.ago', { t: label });
}

/** Native Workspace hover-card status list, including a secondary subagent status when relevant. */
function sessionHoverStatuses(
  presentation: SessionPresentation,
): readonly SessionStatusPresentation[] {
  if (
    presentation.runningSubagentCount === 0 ||
    presentation.status.labelKey === 'subagentsRunning'
  ) {
    return [presentation.status];
  }
  return [
    presentation.status,
    {
      state: 'ongoing',
      labelKey: 'subagentsRunning',
      runningSubagentCount: presentation.runningSubagentCount,
    },
  ];
}

/** Native Workspace Session hover-card details, adapted to the Worktree row projection. */
function WorktreeSessionHoverContent({
  label,
  blank,
  presentation,
  t,
}: {
  readonly label: string;
  readonly blank: boolean;
  readonly presentation?: SessionPresentation;
  readonly t: WorktreeSessionRowProps['t'];
}) {
  const statuses = presentation === undefined ? [] : sessionHoverStatuses(presentation);
  const timeValue =
    !blank && presentation?.updatedAt !== undefined
      ? relativeTime(presentation.updatedAt, Date.now())
      : undefined;

  return (
    <div className={styles.sessionHoverContent}>
      <div className={styles.sessionHoverTitle}>{label}</div>
      {!blank && timeValue !== undefined && (
        <div className={styles.sessionHoverTime}>{sessionHoverTimeLabel(t, timeValue)}</div>
      )}
      {statuses.map((status) => (
        <div
          className={styles.sessionHoverStatus}
          key={`${status.labelKey}-${status.runningSubagentCount}`}
        >
          <StateDot state={status.state} />
          <span>{sessionStatusLabel(t, status)}</span>
        </div>
      ))}
    </div>
  );
}

/** Workspace row using the native DSH menu, fixed action column, and drag contract. */
export function WorktreeWorkspaceRow({
  t,
  workspace,
  expanded,
  hasOngoingSession,
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
  const markerClass =
    drag.marker === 'before' ? styles.dropBefore : drag.marker === 'after' ? styles.dropAfter : '';

  return (
    <div
      className={`${styles.workspaceRow} ${markerClass}`}
      data-workspace-drag={drag.active ? 'active' : undefined}
      data-group-activity={hasOngoingSession && !expanded ? 'true' : undefined}
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
        <span
          className={styles.groupActivity}
          data-group-activity={hasOngoingSession && !expanded ? 'true' : undefined}
          role={hasOngoingSession && !expanded ? 'img' : undefined}
          aria-label={hasOngoingSession && !expanded ? t('session.status.running') : undefined}
          title={hasOngoingSession && !expanded ? t('session.status.running') : undefined}
        >
          {hasOngoingSession && !expanded && <StateDot state={'ongoing'} />}
        </span>
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
            anchor={
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
            }
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

/** Shared Main/Worktree group row with parameterized icon, state, and actions. */
export function WorktreeGroupRow({
  t,
  kind,
  label,
  worktreeId,
  expanded,
  hasOngoingSession,
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
  const markerClass =
    drag?.marker === 'before'
      ? styles.dropBefore
      : drag?.marker === 'after'
        ? styles.dropAfter
        : '';
  const dragProps =
    drag === undefined
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
      data-group-activity={hasOngoingSession && !expanded ? 'true' : undefined}
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
        <span
          className={styles.groupActivity}
          data-group-activity={hasOngoingSession && !expanded ? 'true' : undefined}
          role={hasOngoingSession && !expanded ? 'img' : undefined}
          aria-label={hasOngoingSession && !expanded ? t('session.status.running') : undefined}
          title={hasOngoingSession && !expanded ? t('session.status.running') : undefined}
        >
          {hasOngoingSession && !expanded && <StateDot state={'ongoing'} />}
        </span>
        {menu !== undefined && (
          <span className={styles.menuAction}>
            <Menu
              open={menu.open}
              onClose={() => {
                menu.onOpenChange(false);
              }}
              items={[
                ...(menu.showCreate
                  ? [{
                      id: 'create',
                      label: t('worktree.createNew'),
                      icon: <IconPlusOutline16 />,
                      disabled: menu.disabled || menu.onCreateWorktree === undefined,
                    }]
                  : []),
                {
                  id: 'copy-path',
                  label: t('worktree.copyPath'),
                  icon: <IconCopyOutline16 />,
                  disabled: menu.disabled,
                },
                ...(menu.showRemove
                  ? [{
                      id: 'remove',
                      label: t('worktree.remove'),
                      icon: <IconTrashOutline16 />,
                      danger: true,
                      disabled: menu.disabled || menu.onRemove === undefined,
                    }]
                  : []),
              ]}
              onSelect={(id) => {
                menu.onOpenChange(false);
                if (id === 'create' && menu.showCreate) menu.onCreateWorktree?.();
                if (id === 'copy-path') void writeClipboard(menu.copyPath);
                if (id === 'remove' && menu.showRemove) menu.onRemove?.();
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
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  );
}

/** Worktree-mode Session row with the same trailing options menu as native DSH rows. */
export function WorktreeSessionRow({
  t,
  sessionId,
  blank,
  current,
  label,
  drag,
  actionPending,
  onOpen,
  onRename,
  onFork,
  onArchive,
  presentation,
}: WorktreeSessionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const markerClass =
    drag.marker === 'before' ? styles.dropBefore : drag.marker === 'after' ? styles.dropAfter : '';
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
    {
      id: 'copy-session-id',
      label: t('session.copyId'),
      icon: <IconCopyOutline16 />,
    },
  ];
  const statusLabel = presentation === undefined
    ? undefined
    : sessionStatusLabel(t, presentation.status);
  const showTrailingStatus =
    !blank &&
    presentation !== undefined &&
    (presentation.status.state !== 'done' || presentation.completed);
  const timeValue =
    !blank && !showTrailingStatus && presentation?.updatedAt !== undefined
      ? relativeTime(presentation.updatedAt, Date.now())
      : undefined;
  const timeLabel = timeValue === undefined ? undefined : sessionTimeLabel(t, timeValue);

  const row = (
    <div
      className={`${styles.treeSessionRow} ${markerClass}`}
      data-session-id={sessionId}
      data-session-blank={blank ? 'true' : undefined}
      data-session-current={current ? 'true' : undefined}
      data-session-drag={drag.active ? 'active' : undefined}
      data-menu-open={menuOpen || undefined}
      role="treeitem"
      aria-current={current ? 'true' : undefined}
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
        <span className={styles.sessionLabel}>{label}</span>
      </button>
      {!blank && (
        <span className={styles.sessionTrailing}>
          <span className={styles.sessionMeta}>
            {showTrailingStatus && presentation !== undefined ? (
              <span
                className={styles.sessionStatus}
                data-session-status={statusLabel}
                role="img"
                aria-label={statusLabel}
                title={statusLabel}
              >
                <StateDot state={presentation.status.state} />
              </span>
            ) : timeLabel !== undefined ? (
              <span className={styles.sessionTime} data-session-time>
                {timeLabel}
              </span>
            ) : null}
          </span>
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
                if (id === 'copy-session-id') void writeClipboard(sessionId);
              }}
              portal
              closeOnPointerLeave
              anchor={
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
              }
            />
          </span>
        </span>
      )}
    </div>
  );

  return (
    <HoverCard
      anchor={row}
      content={(
        <WorktreeSessionHoverContent
          label={label}
          blank={blank}
          presentation={presentation}
          t={t}
        />
      )}
      openDelayMs={500}
      disabled={menuOpen || drag.active}
      copyText={blank ? undefined : label}
      copyLabel={t('copy')}
      copiedLabel={t('hover.copied')}
    />
  );
}

export function WorktreeSessionGroup({
  t,
  groupKey,
  sessionIds,
  workspaceId,
  currentSessionId,
  expanded,
  actionPending,
  sessions,
  sessionPresentations,
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
          blank={isBlankSession(sessionId, sessions)}
          current={sessionId === currentSessionId}
          label={sessionLabel(sessionId, sessions, t)}
          presentation={sessionPresentations[sessionId]}
          drag={{
            active: sameGroupDrag,
            marker:
              sameGroupDrag && dragState.over?.sessionId === sessionId ? dragState.over.half : null,
            start: () => {
              onStartDrag(groupKey, sessionId);
            },
            hover: (half) => {
              onHoverDrag(sessionId, half);
            },
            drop: (half) => {
              if (dragState === undefined) return;
              onCommitDrag(dragState, { sessionId, half }, sessionIds, workspaceId);
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
