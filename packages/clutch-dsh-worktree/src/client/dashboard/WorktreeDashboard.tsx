import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  IconBranchOutline16,
  IconCopyOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { WorktreeRecord } from '../../contract/index.js';
import type { WorktreeTranslate } from '../surface/types.js';
import { sessionDisplayLabel, type SessionListLike } from '../session/session-view.js';
import { vscodeFolderUrl } from './vscode-url.js';
import { mountDashboardOverlay } from './dashboard-overlay.js';
import type { DashboardPlacement } from './dashboard-overlay.js';
import styles from './dashboard.css';

const TABS = ['overview', 'git', 'sessions', 'children', 'settings'] as const;
type DashboardTab = (typeof TABS)[number];

export interface WorktreeDashboardProps {
  readonly record: WorktreeRecord;
  readonly workspaceTitle: string;
  readonly t: WorktreeTranslate;
  readonly onClose: () => void;
  readonly sessions: SessionListLike;
  readonly sessionIds: readonly string[];
  readonly actionPending: boolean;
  readonly onOpenSession: (sessionId: string) => void;
  readonly onCreateSession?: () => void;
  readonly onCreateWorktree?: () => void;
  readonly onArchiveWorktree?: () => void;
}

function DashboardIcon({ kind }: { kind: DashboardTab | 'instructions' | 'actions' }) {
  const paths = {
    overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    git: 'M7 7v10 M17 7v3c0 4-10 0-10 4 M5 3h4v4H5z M5 17h4v4H5z M15 3h4v4h-4z',
    sessions: 'M4 4h16v13H9l-5 4z M8 8h8 M8 12h5',
    children: 'M12 7v5 M5 17v-5h14v5 M9 3h6v4H9z M2 17h6v4H2z M16 17h6v4h-6z',
    settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
    instructions: 'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',
    actions: 'M13 2 4 14h7l-1 8 10-13h-8z',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

function Card({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.dashboardCard}>
      <div className={styles.dashboardCardHeading}>
        <h2>
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function PlaceholderButton({ children, t }: { children: ReactNode; t: WorktreeTranslate }) {
  return (
    <button type="button" className={styles.dashboardButton} disabled title={t('dashboard.soon')}>
      {children}
    </button>
  );
}

/** A real Worktree projection with explicitly unconnected MVP cards. */
export function WorktreeDashboard({
  record,
  workspaceTitle,
  t,
  onClose,
  sessions,
  sessionIds,
  actionPending,
  onOpenSession,
  onCreateSession,
  onCreateWorktree,
  onArchiveWorktree,
}: WorktreeDashboardProps) {
  const surface = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [placement, setPlacement] = useState<DashboardPlacement>();
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle');
  const copyGeneration = useRef(0);
  const copyPending = useRef(false);
  const id = useId();
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    return mountDashboardOverlay(element, (next) =>
      setPlacement((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      ),
    );
  }, []);
  useLayoutEffect(() => {
    if (!placement) return;
    const previous = document.activeElement;
    const element = surface.current;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        (element?.contains(document.activeElement) || document.activeElement === document.body)
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [placement !== undefined]);
  useEffect(() => {
    copyGeneration.current += 1;
    copyPending.current = false;
    setCopyState('idle');
    return () => {
      copyGeneration.current += 1;
    };
  }, [record.absolutePath]);
  const copyPath = async () => {
    if (copyPending.current) return;
    copyPending.current = true;
    const generation = copyGeneration.current;
    setCopyState('pending');
    try {
      const copied = await writeClipboard(record.absolutePath);
      if (generation === copyGeneration.current) setCopyState(copied ? 'copied' : 'failed');
    } catch {
      if (generation === copyGeneration.current) setCopyState('failed');
    } finally {
      if (generation === copyGeneration.current) copyPending.current = false;
    }
  };
  const healthKey =
    record.health === 'ready'
      ? 'worktree.ready'
      : record.health === 'repair'
        ? 'worktree.repair'
        : record.health === 'recovery-needed'
          ? 'worktree.recovery'
          : record.health === 'branch-drift'
            ? 'worktree.branchDrift'
            : record.health === 'cleaned'
              ? 'dashboard.cleaned'
              : 'dashboard.unknown';
  const liveBranch =
    record.currentBranch === null
      ? t('dashboard.detached')
      : (record.currentBranch ?? t('dashboard.unknown'));
  const tabLabel = (value: DashboardTab) => t(`dashboard.tab.${value}`);
  const placeholder = <span className={styles.dashboardSoon}>{t('dashboard.soon')}</span>;
  const selectTab = (next: DashboardTab, focus = false) => {
    setTab(next);
    if (focus) document.getElementById(`${id}-${next}`)?.focus();
  };
  const tabLink = (next: DashboardTab, label: string) => (
    <button type="button" className={styles.dashboardLink} onClick={() => selectTab(next, true)}>
      {label}
      <span aria-hidden="true">→</span>
    </button>
  );
  const sessionList = (ids: readonly string[]) =>
    ids.length === 0 ? (
      <div className={styles.dashboardEmpty}>
        <p>{t('dashboard.noSessions')}</p>
      </div>
    ) : (
      <ul className={styles.dashboardSessions}>
        {ids.map((sessionId) => (
          <li key={sessionId}>
            <button
              type="button"
              data-dashboard-session={sessionId}
              aria-current={sessions.current === sessionId ? 'page' : undefined}
              onClick={() => onOpenSession(sessionId)}
            >
              <DashboardIcon kind="sessions" />
              <span>{sessionDisplayLabel(sessionId, sessions, t('session.new'))}</span>
              <span aria-hidden="true">→</span>
            </button>
          </li>
        ))}
      </ul>
    );
  return (
    <section
      ref={surface}
      className={styles.dashboardSurface}
      data-worktree-dashboard={record.worktreeId}
      aria-labelledby={`${id}-title`}
      style={placement ?? { visibility: 'hidden', height: 0 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={styles.dashboardPage}>
        <div className={styles.dashboardTopline}>
          <span>
            {workspaceTitle}
            <span aria-hidden="true"> / </span>
            {t('dashboard.title')}
          </span>
          <button type="button" className={styles.dashboardButton} onClick={onClose}>
            ← {t('dashboard.back')}
          </button>
        </div>
        <header className={styles.dashboardHeader}>
          <div className={styles.dashboardIdentity}>
            <div className={styles.dashboardTitleRow}>
              <IconBranchOutline16 />
              <h1 id={`${id}-title`} ref={heading} tabIndex={-1}>
                {record.branch}
              </h1>
              <span className={styles.dashboardHealth} data-health={record.health ?? 'unknown'}>
                <span aria-hidden="true">●</span>
                {t(healthKey)}
              </span>
              {record.status === 'removed' && (
                <span className={styles.dashboardSoon}>{t('dashboard.archived')}</span>
              )}
            </div>
            <div className={styles.dashboardBranch}>
              <IconBranchOutline16 />
              <code>{liveBranch}</code>
            </div>
            <div className={styles.dashboardPath}>
              <span className={styles.dashboardFieldLabel}>cwd</span>
              <code>{record.absolutePath}</code>
              <button
                type="button"
                className={styles.dashboardIconButton}
                aria-label={t('worktree.copyPath')}
                title={t('worktree.copyPath')}
                disabled={copyState === 'pending'}
                onClick={() => {
                  void copyPath();
                }}
              >
                <IconCopyOutline16 />
              </button>
            </div>
            <p
              className={styles.dashboardCopyStatus}
              role={copyState === 'failed' ? 'alert' : 'status'}
            >
              {copyState === 'copied'
                ? t('dashboard.copied')
                : copyState === 'failed'
                  ? t('dashboard.copyFailed')
                  : '\u00a0'}
            </p>
          </div>
          <div className={styles.dashboardHeaderAside}>
            <a className={styles.dashboardButton} href={vscodeFolderUrl(record.absolutePath)}>
              {t('dashboard.openEditor')}
            </a>
            <dl className={styles.dashboardFacts}>
              <div>
                <dt>{t('dashboard.created')}</dt>
                <dd>{t('dashboard.notConnected')}</dd>
              </div>
              <div>
                <dt>{t('dashboard.base')}</dt>
                <dd>{t('dashboard.notConnected')}</dd>
              </div>
              <div>
                <dt>{t('dashboard.source')}</dt>
                <dd>
                  {t(record.source === 'external' ? 'dashboard.external' : 'dashboard.plugin')}
                </dd>
              </div>
            </dl>
          </div>
        </header>
        <div className={styles.dashboardTabs} role="tablist" aria-label={t('dashboard.title')}>
          {TABS.map((value) => (
            <button
              type="button"
              key={value}
              id={`${id}-${value}`}
              role="tab"
              aria-selected={tab === value}
              aria-controls={`${id}-panel`}
              tabIndex={tab === value ? 0 : -1}
              onClick={() => selectTab(value)}
              onKeyDown={(event) => {
                const index = TABS.indexOf(value);
                const next =
                  event.key === 'ArrowRight'
                    ? TABS[(index + 1) % TABS.length]
                    : event.key === 'ArrowLeft'
                      ? TABS[(index + TABS.length - 1) % TABS.length]
                      : event.key === 'Home'
                        ? TABS[0]
                        : event.key === 'End'
                          ? TABS[TABS.length - 1]
                          : undefined;
                if (next) {
                  event.preventDefault();
                  selectTab(next, true);
                }
              }}
            >
              <DashboardIcon kind={value} />
              {tabLabel(value)}
            </button>
          ))}
        </div>
        <div
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${tab}`}
          tabIndex={0}
          className={styles.dashboardPanel}
        >
          {tab === 'overview' ? (
            <div className={styles.dashboardGrid}>
              <div className={styles.dashboardColumn}>
                <section className={styles.dashboardStart}>
                  <h2>
                    <IconBranchOutline16 />
                    {t('dashboard.start')}
                  </h2>
                  <p>{t('dashboard.startDescription')}</p>
                  <div className={styles.dashboardStartActions}>
                    <button
                      type="button"
                      disabled={actionPending || !onCreateWorktree}
                      onClick={onCreateWorktree}
                      data-dashboard-action="create-worktree"
                    >
                      <DashboardIcon kind="git" />
                      <span>
                        <strong>{t('dashboard.newWorktree')}</strong>
                        <small>{t('dashboard.newWorktreeDescription')}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={actionPending || !onCreateSession}
                      onClick={onCreateSession}
                      data-dashboard-action="create-session"
                    >
                      <DashboardIcon kind="sessions" />
                      <span>
                        <strong>{t('dashboard.newSession')}</strong>
                        <small>{t('dashboard.newSessionDescription')}</small>
                      </span>
                    </button>
                  </div>
                </section>
                <Card
                  title={t('dashboard.instructions')}
                  icon={<DashboardIcon kind="instructions" />}
                  action={<PlaceholderButton t={t}>{t('dashboard.edit')}</PlaceholderButton>}
                >
                  <p>{t('dashboard.instructionsDescription')}</p>
                  <div className={styles.dashboardInstructionPlaceholder}>
                    <DashboardIcon kind="instructions" />
                    <strong>{t('dashboard.noInstructions')}</strong>
                    <p>{t('dashboard.instructionsHint')}</p>
                    {placeholder}
                  </div>
                </Card>
                <Card
                  title={tabLabel('sessions')}
                  icon={<DashboardIcon kind="sessions" />}
                  action={<span>{sessionIds.length}</span>}
                >
                  {sessionList(sessionIds.slice(0, 5))}
                  {tabLink('sessions', t('dashboard.viewSessions'))}
                </Card>
              </div>
              <div className={styles.dashboardColumn}>
                <Card title={t('dashboard.status')} icon={<DashboardIcon kind="git" />}>
                  <p>{t('dashboard.statusHint')}</p>
                  <dl className={styles.dashboardFacts}>
                    <div>
                      <dt>{t('dashboard.health')}</dt>
                      <dd>{t(healthKey)}</dd>
                    </div>
                    <div>
                      <dt>{t('dashboard.branch')}</dt>
                      <dd>{liveBranch}</dd>
                    </div>
                    <div>
                      <dt>{t('dashboard.base')}</dt>
                      <dd>{t('dashboard.notConnected')}</dd>
                    </div>
                    <div>
                      <dt>{t('dashboard.aheadBehind')}</dt>
                      <dd>{t('dashboard.notConnected')}</dd>
                    </div>
                    <div>
                      <dt>{t('dashboard.workingTree')}</dt>
                      <dd>{t('dashboard.notConnected')}</dd>
                    </div>
                  </dl>
                  {tabLink('git', t('dashboard.viewDetails'))}
                </Card>
                <Card
                  title={t('dashboard.derived')}
                  icon={<DashboardIcon kind="children" />}
                  action={placeholder}
                >
                  <div className={styles.dashboardEmpty}>
                    <p>{t('dashboard.childrenHint')}</p>
                  </div>
                  {tabLink('children', t('dashboard.viewChildren'))}
                </Card>
                <Card title={t('dashboard.quickActions')} icon={<DashboardIcon kind="actions" />}>
                  <div className={styles.dashboardQuickActions}>
                    {(['terminal', 'diff', 'pullRequest', 'tests', 'sync'] as const).map(
                      (action) => (
                        <PlaceholderButton key={action} t={t}>
                          {t(`dashboard.action.${action}`)}
                        </PlaceholderButton>
                      ),
                    )}
                    <button
                      type="button"
                      className={styles.dashboardButton}
                      disabled={actionPending || !onArchiveWorktree}
                      onClick={onArchiveWorktree}
                      data-dashboard-action="archive-worktree"
                    >
                      {t('dashboard.action.archive')}
                    </button>
                  </div>
                </Card>
              </div>
            </div>
          ) : tab === 'sessions' ? (
            <Card
              title={tabLabel('sessions')}
              icon={<DashboardIcon kind="sessions" />}
              action={
                <button
                  type="button"
                  className={styles.dashboardButton}
                  disabled={actionPending || !onCreateSession}
                  onClick={onCreateSession}
                >
                  {t('dashboard.newSession')}
                </button>
              }
            >
              {sessionList(sessionIds)}
            </Card>
          ) : (
            <section className={styles.dashboardTabPlaceholder}>
              <DashboardIcon kind={tab} />
              <h2>{tabLabel(tab)}</h2>
              <p>{t(`dashboard.hint.${tab}`)}</p>
              {placeholder}
            </section>
          )}
        </div>
        <p className={styles.dashboardFooter}>{t('dashboard.mvpHint')}</p>
      </div>
    </section>
  );
}
