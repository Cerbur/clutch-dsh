import { useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import {
  HoverCard,
  IconArchiveOutline20,
  IconBranchOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderClose16,
  IconFolderOpen16,
  IconPlusOutline16,
  IconTrashOutline16,
  Menu,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { isBlankSession } from './session-view.js';
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

/** Workspace row using the native DSH menu, fixed action column, and drag contract. */
export function WorktreeWorkspaceRow({
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

/** Shared Main/Worktree group row with parameterized icon, state, and actions. */
export function WorktreeGroupRow({
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
export function WorktreeSessionRow({
  t,
  sessionId,
  blank,
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
      data-session-blank={blank ? 'true' : undefined}
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
      {!blank && (
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
      )}
    </div>
  );
}

export function WorktreeSessionGroup({
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
          blank={isBlankSession(sessionId, sessions)}
          label={sessionLabel(sessionId, sessions, t)}
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
