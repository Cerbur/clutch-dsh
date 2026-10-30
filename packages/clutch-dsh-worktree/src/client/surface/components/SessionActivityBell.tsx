import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MenuSurface,
  StateDot,
  Tooltip,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives';
import {
  activityClocks,
  type ActivityClock,
  type ActiveSession,
} from '../../session/active-sessions.js';
import {
  relativeTime,
  sessionDisplayLabel,
  type SessionListLike,
  type SessionPresentation,
} from '../../session/session-view.js';
import {
  sessionHoverTimeLabel,
  sessionStatusLabel,
  sessionTimeLabel,
} from '../../session/session-labels.js';
import type { WorktreeTranslate } from '../types.js';
import styles from '../../worktree.css';

type Input = {
  readonly entries: readonly ActiveSession[];
  readonly sessions: SessionListLike;
  readonly presentations: Readonly<Record<string, SessionPresentation>>;
  readonly t: WorktreeTranslate;
  readonly hidden: boolean;
  readonly onOpenSession: (workspaceId: string, sessionId: string) => void;
};

export function SessionActivityBell({
  entries,
  sessions,
  presentations,
  t,
  hidden,
  onOpenSession,
}: Input) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const clocks = useRef<ReadonlyMap<string, ActivityClock>>(new Map());
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const visible = open && !hidden;
  const position = useAnchoredPosition({
    open: visible,
    anchorRef: trigger,
    panelRef: panel,
    side: 'bottom',
    align: 'end',
    gap: 8,
    margin: 8,
  });
  useDismissOnOutsidePointer(root, visible, setOpen, panel);

  useEffect(() => {
    const timestamp = Date.now();
    clocks.current = activityClocks(clocks.current, presentations, timestamp);
    setNow(timestamp);
  }, [presentations]);
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('keydown', dismiss);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('keydown', dismiss);
    };
  }, [visible]);
  useEffect(() => {
    if (visible && position !== null) panel.current?.focus();
  }, [visible, position === null]);

  const hasActivity = entries.length > 0;
  return (
    <span ref={root} className={styles.activityBell}>
      <Tooltip label={t('activity.title')} side="bottom" delayMs={500} disabled={visible}>
        <button
          ref={trigger}
          type="button"
          className={styles.iconButton}
          aria-label={
            hasActivity ? t('activity.count', { n: entries.length }) : t('activity.title')
          }
          aria-expanded={visible}
          aria-haspopup="dialog"
          aria-controls={visible ? panelId : undefined}
          data-session-activity={hasActivity ? 'active' : 'empty'}
          onClick={() => {
            setNow(Date.now());
            setOpen((value) => !value);
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6.25 13a1.8 1.8 0 0 0 3.5 0M2.5 11.5c1-1 1.25-2 1.25-4.5a4.25 4.25 0 0 1 8.5 0c0 2.5.25 3.5 1.25 4.5Z" />
          </svg>
          {hasActivity && <span className={styles.activityBadge} aria-hidden="true" />}
        </button>
      </Tooltip>
      {visible &&
        createPortal(
          <MenuSurface
            ref={panel}
            id={panelId}
            role="dialog"
            aria-label={t('activity.title')}
            tabIndex={-1}
            className={styles.activityPanel}
            style={{ ...position, visibility: position === null ? 'hidden' : undefined }}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (
                next instanceof Node &&
                !event.currentTarget.contains(next) &&
                !root.current?.contains(next)
              )
                setOpen(false);
            }}
          >
            <div className={styles.activityHeading}>{t('activity.title')}</div>
            {entries.length === 0 ? (
              <p className={styles.activityEmpty}>{t('activity.empty')}</p>
            ) : (
              <ul className={styles.activityList}>
                {entries.map((entry) => {
                  const { sessionId, presentation } = entry;
                  const status = sessionStatusLabel(t, presentation.status);
                  const since = clocks.current.get(sessionId)?.since ?? presentation.updatedAt;
                  const time = relativeTime(since, now);
                  const duration =
                    since === undefined ? undefined : Math.max(0, Math.floor((now - since) / 1000));
                  const timeLabel =
                    time === undefined
                      ? undefined
                      : presentation.ongoing
                        ? t('activity.runningFor', {
                            t:
                              duration !== undefined && duration < 60
                                ? t('activity.seconds', { n: duration })
                                : sessionTimeLabel(t, time),
                          })
                        : sessionHoverTimeLabel(t, time);
                  return (
                    <li key={sessionId}>
                      <button
                        type="button"
                        className={styles.activityEntry}
                        data-activity-session={sessionId}
                        onClick={() => {
                          setOpen(false);
                          onOpenSession(entry.workspaceId, sessionId);
                        }}
                      >
                        <span className={styles.activityIdentity}>
                          <span className={styles.activityName}>
                            {sessionDisplayLabel(sessionId, sessions, t('session.new'))}
                          </span>
                          <span className={styles.activityContext} title={entry.workspaceTitle}>
                            {entry.workspaceTitle}
                          </span>
                          <span
                            className={styles.activityContext}
                            title={entry.worktree ?? undefined}
                          >
                            {entry.worktree === null
                              ? t('worktree.main')
                              : (entry.worktree ?? t('activity.unknownWorktree'))}
                          </span>
                        </span>
                        <span className={styles.activityMetadata}>
                          <span role="img" aria-label={status} title={status}>
                            <StateDot state={presentation.status.state} />
                          </span>
                          {timeLabel !== undefined && (
                            <span className={styles.activityTime}>{timeLabel}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </MenuSurface>,
          document.body,
        )}
    </span>
  );
}
