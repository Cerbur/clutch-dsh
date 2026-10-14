import { NotificationToasts } from '../surface/components/NotificationToasts.js';
import { toWorktreeViewError, type WorktreeViewError } from '../view/worktree-view.js';
import { formatWorktreeViewError } from '../view/worktree-error-copy.js';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Modal,
  StateDot,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives';
import {
  IconBranchOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  IconPanelLeftOutline16,
} from '../dsh-icons.js';
import type { DashboardRecord } from './dashboard-selection.js';
import type { WorktreeTranslate } from '../surface/types.js';
import { isBlankSession, relativeTime, sessionDisplayLabel } from '../session/session-view.js';
import { currentSessionIdFromList } from '../session/session-selection.js';
import type { SessionListLike, SessionPresentation } from '../session/session-view.js';
import { sessionStatusLabel, sessionTimeLabel } from '../session/session-labels.js';
import { OpenInAppButton } from './OpenInAppButton.js';
import { mountDashboardOverlay } from './dashboard-overlay.js';
import { isMainWorktreeId } from './dashboard-selection.js';
import { selectWorktreeAcquisitionFacts } from './worktree-acquisition-facts.js';
import type { DashboardPlacement } from './dashboard-overlay.js';
import styles from './dashboard.css';
import { WorktreeInstructions } from './WorktreeInstructions.js';
import { WorktreeGitPanel } from './git/WorktreeGitPanel.js';
import { useWorktreeGitOverview, WorktreeGitOverviewValue } from './git/WorktreeGitOverview.js';
import type { BranchRecord, WorktreeManager } from '../../contract/index.js';
import type { WorktreeToolSettingsManager } from '../../contract/tool-settings.js';
import { GitBranchPicker } from '../branch/GitBranchSelector.js';
import { ToolSettings } from '../settings/ToolSettings.js';

const TABS = ['overview', 'git', 'sessions', 'children', 'settings'] as const;
type DashboardTab = (typeof TABS)[number];

export interface WorktreeDashboardProps {
  readonly manager?: WorktreeManager & Partial<WorktreeToolSettingsManager>;
  readonly onSaveInstructions?: (text: string, expected: string) => Promise<string>;
  readonly onSaveBaseline?: (baseBranch: string, expectedBaseBranch?: string) => Promise<string>;
  readonly onFetchBranches?: () => Promise<readonly BranchRecord[]>;
  readonly onLoadBranches?: () => Promise<readonly BranchRecord[]>;
  readonly branches?: readonly BranchRecord[];
  readonly branchesLoading?: boolean;
  readonly record: DashboardRecord;
  readonly workspaceTitle: string;
  readonly t: WorktreeTranslate;
  readonly onClose: () => void;
  readonly onOpenSidebar?: () => void;
  readonly isRightSidebarExpanded?: () => boolean;
  readonly sessions: SessionListLike;
  readonly sessionPresentations: Readonly<Record<string, SessionPresentation | undefined>>;
  readonly sessionIds: readonly string[];
  readonly actionPending: boolean;
  readonly onOpenSession: (sessionId: string) => void;
  readonly onCreateSession?: () => void;
  readonly onCreateWorktree?: () => void;
  readonly onArchiveWorktree?: () => void;
  readonly onOpenFile?: (path: string) => void;
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

function DashboardFactRow({
  label,
  children,
  action,
  baseline = false,
}: {
  readonly label: ReactNode;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly baseline?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-dashboard-baseline={baseline ? true : undefined}>{children}</dd>
      <span className={styles.dashboardFactAction}>{action}</span>
    </div>
  );
}

function PlaceholderButton({ children, t }: { children: ReactNode; t: WorktreeTranslate }) {
  return (
    <button type="button" className={styles.dashboardButton} disabled title={t('dashboard.soon')}>
      {children}
    </button>
  );
}

function WorktreeBaselineEditor({
  value,
  branches,
  loading,
  currentBranch,
  onSave,
  onFetch,
  onLoad,
  t,
  disabled,
  context,
}: {
  readonly value?: string;
  readonly branches: readonly BranchRecord[];
  readonly loading: boolean;
  readonly currentBranch?: string;
  readonly onSave?: (baseBranch: string, expectedBaseBranch?: string) => Promise<string>;
  readonly onFetch?: () => Promise<readonly BranchRecord[]>;
  readonly onLoad?: () => Promise<readonly BranchRecord[]>;
  readonly t: WorktreeTranslate;
  readonly disabled: boolean;
  readonly context?: string;
}) {
  const [saved, setSaved] = useState(value);
  const [draft, setDraft] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WorktreeViewError>();
  const busy = useRef(false);
  const alive = useRef(true);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const expected = useRef(value);
  // Workspace projections omit the branch catalog; this editor owns on-demand results.
  const [fetched, setFetched] = useState<readonly BranchRecord[]>();
  const [reading, setReading] = useState(false);
  const editorOpen = useRef(false);
  const editorGeneration = useRef(0);
  const requestGeneration = useRef(0);
  const roster = fetched ?? branches;
  const options = useMemo(() => roster.filter((branch) => branch.kind === 'remote' || branch.name !== currentBranch), [roster, currentBranch]);
  const draftMatches = options.filter((branch) => (branch.ref ?? branch.name) === draft ||
    (!draft?.startsWith('refs/') && (branch.name === draft ||
      (branch.kind === 'remote' && 'remotes/' + branch.name === draft))));
  const validDraft = draftMatches.length === 1;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      editorGeneration.current++;
      requestGeneration.current++;
    };
  }, []);
  useEffect(() => {
    setSaved(value);
    expected.current = value;
  }, [value]);
  useEffect(() => {
    if (wasOpen.current && draft === undefined) trigger.current?.focus();
    wasOpen.current = draft !== undefined;
  }, [draft]);

  const closeEditor = () => {
    if (pending) return;
    editorOpen.current = false;
    editorGeneration.current++;
    requestGeneration.current++;
    setReading(false);
    setDraft(undefined);
    setError(undefined);
  };
  const openEditor = () => {
    editorOpen.current = true;
    editorGeneration.current++;
    requestGeneration.current++;
    setReading(false);
    expected.current = saved;
    setDraft(saved ?? '');
    setError(undefined);
  };
  const lifetime = editorGeneration.current;
  const readBranches = async (read: () => Promise<readonly BranchRecord[]>) => {
    if (!alive.current || !editorOpen.current || editorGeneration.current !== lifetime) return options;
    const request = ++requestGeneration.current;
    const isCurrent = () => alive.current && editorOpen.current &&
      editorGeneration.current === lifetime && requestGeneration.current === request;
    setReading(true);
    try {
      const next = await read();
      if (isCurrent()) setFetched(next);
      return next.filter((branch) => branch.kind === 'remote' || branch.name !== currentBranch);
    } finally {
      if (isCurrent()) setReading(false);
    }
  };
  const save = async () => {
    if (
      busy.current ||
      draft === undefined ||
      onSave === undefined ||
      loading ||
      reading ||
      !validDraft
    )
      return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      const result = await onSave(draft, expected.current);
      if (alive.current) {
        setSaved(result);
        expected.current = result;
        editorOpen.current = false;
        editorGeneration.current++;
        requestGeneration.current++;
        setDraft(undefined);
      }
    } catch (cause) {
      if (alive.current) setError(toWorktreeViewError(cause));
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  };

  return (
    <>
      <DashboardFactRow
        label={t('dashboard.base')}
        baseline
        action={
          onSave !== undefined ? (
            <Tooltip
              label={t('dashboard.editBase')}
              side="bottom"
              delayMs={500}
              disabled={disabled || (options.length === 0 && onLoad === undefined)}
            >
              <button
                type="button"
                ref={trigger}
                className={styles.dashboardIconButton}
                data-dashboard-baseline-edit
                aria-label={t('dashboard.editBase')}
                title={t('dashboard.editBase')}
                aria-haspopup="dialog"
                aria-expanded={draft !== undefined}
                disabled={disabled || (options.length === 0 && onLoad === undefined)}
                onClick={openEditor}
              >
                <IconEditOutline16 />
              </button>
            </Tooltip>
          ) : undefined
        }
      >
        {saved === undefined ? (
          <span className={styles.dashboardHistorical}>{t('dashboard.historicalUnavailable')}</span>
        ) : (
          <span data-dashboard-baseline-value title={saved}>{saved.replace(/^refs\/(heads|remotes)\//u, '')}</span>
        )}
      </DashboardFactRow>
      <Modal
        open={draft !== undefined}
        onClose={closeEditor}
        closeLabel={t('dialog.closeBaseline')}
        title={t('dashboard.editBase')}
        description={t('dashboard.editBaseDescription')}
        className={styles.dashboardBaselineModal}
        contentClassName={styles.dashboardBaselineModalContent}
        footer={
          <>
            <Button variant="outline" disabled={pending} onClick={closeEditor}>
              {t('dashboard.cancelBase')}
            </Button>
            <Button
              variant="primary"
              data-dashboard-baseline-save
              disabled={pending || disabled || loading || reading || !validDraft}
              onClick={() => void save()}
            >
              {t(pending ? 'dashboard.savingBase' : 'dashboard.saveBase')}
            </Button>
          </>
        }
      >
        <div className={styles.dashboardBaselinePicker} data-dashboard-baseline-modal>
          {draft !== undefined && <GitBranchPicker
            key={lifetime}
            branches={options} value={draft} onChange={setDraft} t={t}
            disabled={pending || disabled} loading={loading} onClose={closeEditor}
            onLoad={onLoad === undefined ? undefined : () => readBranches(onLoad)}
            onFetch={onFetch === undefined ? undefined : () => readBranches(onFetch)}
          />}
          <NotificationToasts
            notices={
              error === undefined
                ? []
                : [
                    {
                      key: JSON.stringify(['baseline', context, error.code, error.details]),
                      context, error,
                      actions: [{ label: t('action.retry'), disabled: pending || disabled,
                        onClick: () => { void save(); } }],
                      describe: (translate) => translate('dashboard.base') + ' · ' + (context ?? ''),
                      message: (translate) => translate('dashboard.baseSaveFailed') +
                        (error.code === 'WORKTREE_VIEW_FAILED' ? '' : ' ' + formatWorktreeViewError(error, translate)),
                      text:
                        t('dashboard.baseSaveFailed') +
                        (error.code === 'WORKTREE_VIEW_FAILED'
                          ? ''
                          : ' ' + formatWorktreeViewError(error, t)),
                    },
                  ]
            }
          />
        </div>
      </Modal>
    </>
  );
}

/** A managed Worktree or browser Main projection with explicit unavailable states for inapplicable facts. */
export function WorktreeDashboard({
  manager,
  record,
  workspaceTitle,
  t,
  onClose,
  onOpenSidebar,
  isRightSidebarExpanded,
  sessions,
  sessionPresentations,
  sessionIds,
  actionPending,
  onOpenSession,
  onCreateSession,
  onCreateWorktree,
  onArchiveWorktree,
  onOpenFile,
  onSaveInstructions,
  onSaveBaseline,
  onFetchBranches,
  onLoadBranches,
  branches = [],
  branchesLoading = false,
}: WorktreeDashboardProps) {
  const surface = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [placement, setPlacement] = useState<DashboardPlacement>();
  const [rightSidebarOpen, setRightSidebarOpen] = useState(Boolean(isRightSidebarExpanded?.()));
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [baselineBranch, setBaselineBranch] = useState(record.baseBranch);
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle');
  const [branchCopyState, setBranchCopyState] = useState<'idle' | 'pending' | 'copied' | 'failed'>(
    'idle',
  );
  const copyGeneration = useRef(0);
  const branchCopyGeneration = useRef(0);
  const copyPending = useRef(false);
  const branchCopyPending = useRef(false);
  const id = useId();
  useEffect(() => {
    setBaselineBranch(record.baseBranch);
  }, [record.baseBranch]);
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    return mountDashboardOverlay(
      element,
      (next) =>
        setPlacement((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        ),
      {
        onRightSidebarChange: (open) => setRightSidebarOpen(open),
        isRightSidebarExpanded,
      },
    );
  }, [isRightSidebarExpanded]);
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
  useEffect(() => {
    branchCopyGeneration.current += 1;
    branchCopyPending.current = false;
    setBranchCopyState('idle');
    return () => {
      branchCopyGeneration.current += 1;
    };
  }, [record.branch, record.currentBranch, record.currentHead?.name]);
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
  const isMain = isMainWorktreeId(record.worktreeId);
  const refName = record.currentHead?.name ?? record.currentBranch ?? record.branch;
  const branchAvailable = refName.length > 0;
  const displayBranch = branchAvailable ? refName : t('dashboard.branchUnavailable');
  const copyBranch = async () => {
    if (!branchAvailable || branchCopyPending.current) return;
    branchCopyPending.current = true;
    const generation = branchCopyGeneration.current;
    setBranchCopyState('pending');
    try {
      const copied = await writeClipboard(refName);
      if (generation === branchCopyGeneration.current)
        setBranchCopyState(copied ? 'copied' : 'failed');
    } catch {
      if (generation === branchCopyGeneration.current) setBranchCopyState('failed');
    } finally {
      if (generation === branchCopyGeneration.current) branchCopyPending.current = false;
    }
  };
  const healthKey =
    isMain ? 'dashboard.mainReady' : record.health === 'ready'
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
    record.currentHead?.name ?? (record.currentBranch === null
      ? t('dashboard.detached')
      : (record.currentBranch ??
        (branchAvailable ? record.branch : t('dashboard.branchUnavailable'))));
  const baselineCurrentBranch =
    record.currentBranch === undefined ? record.branch : (record.currentBranch ?? undefined);
  const persistBaseline =
    onSaveBaseline === undefined
      ? undefined
      : async (baseBranch: string, expectedBaseBranch?: string) => {
          const result = await onSaveBaseline(baseBranch, expectedBaseBranch);
          setBaselineBranch(result);
          return result;
        };
  const displayedBaseline = onSaveBaseline === undefined ? record.baseBranch : baselineBranch;
  const gitOverview = useWorktreeGitOverview({
    manager,
    workspaceId: record.workspaceId,
    worktreeId: record.worktreeId,
    defaultBaselineBranch: displayedBaseline,
    currentBranch: baselineCurrentBranch,
    capturedBaseline: record.baseCommit !== undefined,
  });
  const acquisitionFacts = selectWorktreeAcquisitionFacts(record);
  const acquisitionLabel =
    acquisitionFacts.timestampKind === 'imported' ? 'dashboard.imported' : 'dashboard.created';
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
        {onCreateSession !== undefined && <button type="button" className={styles.dashboardButton}
          disabled={actionPending} onClick={onCreateSession}>{t('dashboard.newSession')}</button>}
      </div>
    ) : (
      <ul className={styles.dashboardSessions}>
        {ids.map((sessionId) => {
          const presentation = sessionPresentations[sessionId];
          const blank = isBlankSession(sessionId, sessions);
          const statusLabel =
            presentation === undefined ? undefined : sessionStatusLabel(t, presentation.status);
          const showTrailingStatus =
            !blank &&
            presentation !== undefined &&
            (presentation.status.state !== 'done' || presentation.completed);
          const timeValue =
            !blank && !showTrailingStatus && presentation?.updatedAt !== undefined
              ? relativeTime(presentation.updatedAt, Date.now())
              : undefined;
          const timeLabel = timeValue === undefined ? undefined : sessionTimeLabel(t, timeValue);
          return (
            <li key={sessionId}>
              <button
                type="button"
                data-dashboard-session={sessionId}
                aria-current={currentSessionIdFromList(sessions) === sessionId ? 'page' : undefined}
                onClick={() => onOpenSession(sessionId)}
              >
                <DashboardIcon kind="sessions" />
                <span className={styles.dashboardSessionLabel}>
                  {sessionDisplayLabel(sessionId, sessions, t('session.new'))}
                </span>
                {!blank && (
                  <span className={styles.dashboardSessionMeta}>
                    {showTrailingStatus && presentation !== undefined ? (
                      <span
                        className={styles.dashboardSessionStatus}
                        data-dashboard-session-status={statusLabel}
                        role="img"
                        aria-label={statusLabel}
                        title={statusLabel}
                      >
                        <StateDot state={presentation.status.state} />
                      </span>
                    ) : timeLabel !== undefined ? (
                      <span className={styles.dashboardSessionTime} data-dashboard-session-time>
                        {timeLabel}
                      </span>
                    ) : null}
                  </span>
                )}
                <span aria-hidden="true">→</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  const topActionIsCreateSession = sessionIds.length === 0 && onCreateSession !== undefined;
  return (
    <section
      ref={surface}
      className={styles.dashboardSurface}
      data-worktree-dashboard={record.worktreeId}
      aria-labelledby={`${id}-title`}
      style={placement ?? { visibility: 'hidden', height: 0 }}
      onKeyDown={(event) => {
        // Native menus dismiss during document capture, before React sees this
        // event. Their DOM may already be gone; defaultPrevented retains ownership.
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
          if ((event.target as Element | undefined)?.closest?.('[data-single-select-picker]')) return;
          // Other dashboard menus own Escape even when focus remains elsewhere in the surface.
          if (event.currentTarget.querySelector('[role="menu"]')) return;
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className={styles.dashboardTopline} data-dashboard-topbar data-window-drag>
        <span
          title={`${workspaceTitle}/${displayBranch}`}
          style={{
            marginInlineStart: `max(0px, calc(var(--dsh-frame-leading-clearance, 0px) - ${placement?.left ?? 0}px - 20px))`,
          }}
        >
          {workspaceTitle}
          <span aria-hidden="true"> / </span>
          {displayBranch}
        </span>
        <div className={styles.dashboardToplineActions}>
          <OpenInAppButton path={record.absolutePath} t={t} />
          <button
            type="button"
            className={styles.dashboardButton}
            aria-label={t(topActionIsCreateSession ? 'dashboard.newSession' : 'dashboard.back')}
            onClick={() => {
              if (topActionIsCreateSession) onCreateSession?.();
              else onClose();
            }}
          >
            {topActionIsCreateSession ? t('dashboard.newSession') : <>← {t('dashboard.back')}</>}
          </button>
          {!rightSidebarOpen && onOpenSidebar !== undefined && (
            <Tooltip label={t('dashboard.openSidebar')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={styles.dashboardSidebarButton}
                aria-label={t('dashboard.openSidebar')}
                title={t('dashboard.openSidebar')}
                data-sidebar-right-expand
                onClick={() => {
                  onOpenSidebar();
                  setRightSidebarOpen(true);
                }}
              >
                <IconPanelLeftOutline16 />
              </button>
            </Tooltip>
          )}
        </div>
      </header>
      <div className={styles.dashboardPage}>
        <header className={styles.dashboardHeader}>
          <div className={styles.dashboardIdentity}>
            <div className={styles.dashboardTitleRow}>
              <IconBranchOutline16 />
              <h1 id={`${id}-title`} ref={heading} tabIndex={-1}>
                <button
                  type="button"
                  className={styles.dashboardRefButton}
                  data-dashboard-copy="branch"
                  disabled={!branchAvailable}
                  aria-label={branchAvailable ? t('dashboard.copyBranch') : undefined}
                  title={branchAvailable ? t('dashboard.copyBranch') : undefined}
                  aria-busy={branchAvailable && branchCopyState === 'pending' ? true : undefined}
                  onClick={branchAvailable ? () => void copyBranch() : undefined}
                >
                  {displayBranch}
                </button>
              </h1>
              {record.currentHead?.kind !== undefined && record.currentHead.kind !== 'branch' && <span className={styles.dashboardSoon}>{t(record.currentHead.kind === 'tag' ? 'dashboard.refKind.tag' : 'dashboard.refKind.commit')}</span>}
              <span className={styles.dashboardHealth} data-health={isMain ? 'local' : record.health ?? 'unknown'}>
                <span aria-hidden="true">●</span>
                {t(healthKey)}
              </span>
              {record.status === 'removed' && (
                <span className={styles.dashboardSoon}>{t('dashboard.archived')}</span>
              )}
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
            <NotificationToasts
              notices={[
                ...(branchCopyState === 'failed'
                  ? [{ key: 'copy-branch:' + record.absolutePath, text: t('dashboard.branchCopyFailed'),
                      context: workspaceTitle + ' · ' + record.branch + ' · ' + record.absolutePath,
                      message: (translate: WorktreeTranslate) => translate('dashboard.branchCopyFailed') }]
                  : []),
                ...(copyState === 'failed'
                  ? [{ key: 'copy-path:' + record.absolutePath, text: t('dashboard.copyFailed'),
                      context: workspaceTitle + ' · ' + record.absolutePath,
                      message: (translate: WorktreeTranslate) => translate('dashboard.copyFailed') }]
                  : []),
              ]}
            />
            <p className={styles.dashboardCopyStatus} role="status">
              {branchCopyState === 'copied'
                ? t('dashboard.branchCopied')
                : copyState === 'copied'
                  ? t('dashboard.copied')
                  : '\u00a0'}
            </p>
          </div>
          <div className={styles.dashboardHeaderAside}>
            <dl className={styles.dashboardFacts}>
              {!isMain && <DashboardFactRow label={t(acquisitionLabel)}>
                {acquisitionFacts.timestamp ? (
                  <time dateTime={acquisitionFacts.timestamp}>
                    {new Date(acquisitionFacts.timestamp).toLocaleString()}
                  </time>
                ) : (
                  <span className={styles.dashboardHistorical}>
                    {t('dashboard.historicalUnavailable')}
                  </span>
                )}
              </DashboardFactRow>}
              {!isMain && (persistBaseline !== undefined ? (
                <WorktreeBaselineEditor
                  context={workspaceTitle + ' · ' + record.branch + ' · ' + record.absolutePath}
                  value={baselineBranch}
                  branches={branches}
                  loading={branchesLoading}
                  currentBranch={baselineCurrentBranch}
                  onSave={persistBaseline}
                  onFetch={onFetchBranches}
                  onLoad={onLoadBranches}
                  t={t}
                  disabled={record.status !== 'active' || record.health === 'recovery-needed'}
                />
              ) : (
                <DashboardFactRow label={t('dashboard.base')} baseline>
                  {displayedBaseline?.replace(/^refs\/(heads|remotes)\//u, '') ?? (
                    <span className={styles.dashboardHistorical}>
                      {t('dashboard.historicalUnavailable')}
                    </span>
                  )}
                </DashboardFactRow>
              ))}
              <DashboardFactRow label={t('dashboard.source')}>
                {isMainWorktreeId(record.worktreeId)
                  ? t('worktree.main')
                  : t(record.source === 'external' ? 'dashboard.external' : 'dashboard.plugin')}
              </DashboardFactRow>
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
                >
                  <p>{t('dashboard.instructionsDescription')}</p>
                  <WorktreeInstructions
                    context={workspaceTitle + ' · ' + record.branch + ' · ' + record.absolutePath}
                    value={record.instructions ?? ''}
                    onSave={onSaveInstructions}
                    t={t}
                    disabled={actionPending || record.health === 'recovery-needed'}
                  />
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
                    <DashboardFactRow label={t('dashboard.health')}>
                      {t(healthKey)}
                    </DashboardFactRow>
                    <DashboardFactRow label={t('dashboard.branch')}>{liveBranch}</DashboardFactRow>
                    {!isMain && <DashboardFactRow label={t('dashboard.base')}>
                      {displayedBaseline?.replace(/^refs\/(heads|remotes)\//u, '') ?? (
                        <span className={styles.dashboardHistorical}>
                          {t('dashboard.historicalUnavailable')}
                        </span>
                      )}
                    </DashboardFactRow>}
                    <DashboardFactRow label={t('dashboard.aheadBehind')}>
                      <WorktreeGitOverviewValue state={gitOverview} metric="aheadBehind" t={t} />
                    </DashboardFactRow>
                    <DashboardFactRow label={t('dashboard.committedChanges')}>
                      <WorktreeGitOverviewValue state={gitOverview} metric="committed" t={t} />
                    </DashboardFactRow>
                    <DashboardFactRow label={t('dashboard.workingTree')}>
                      <WorktreeGitOverviewValue state={gitOverview} metric="workingTree" t={t} />
                    </DashboardFactRow>
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
          ) : tab === 'git' ? (
            <WorktreeGitPanel
              context={workspaceTitle + ' · ' + record.branch + ' · ' + record.absolutePath}
              manager={manager}
              workspaceId={record.workspaceId}
              worktreeId={record.worktreeId}
              defaultBaselineBranch={displayedBaseline}
              currentBranch={baselineCurrentBranch}
              capturedBaseline={record.baseCommit !== undefined}
              onOpenFile={onOpenFile === undefined ? undefined : (filePath) => {
                onOpenFile?.(filePath);
                setRightSidebarOpen(isRightSidebarExpanded?.() ?? false);
              }}
              t={t}
            />
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
          ) : tab === 'settings' ? (
            <Card title={tabLabel('settings')} icon={<DashboardIcon kind="settings" />}>
              <ToolSettings
                key={JSON.stringify([record.workspaceId, record.worktreeId])}
                manager={manager}
                scope={isMainWorktreeId(record.worktreeId)
                  ? { kind: 'local', workspaceId: record.workspaceId }
                  : { kind: 'worktree', workspaceId: record.workspaceId, worktreeId: record.worktreeId }}
                t={t}
              />
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
