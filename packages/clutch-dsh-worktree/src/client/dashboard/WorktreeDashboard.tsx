import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import {
  Button,
  IconBranchOutline16,
  IconCheckOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  IconSearchOutline16,
  Input,
  Modal,
  StateDot,
  Tooltip,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { DashboardRecord } from './dashboard-selection.js';
import type { WorktreeTranslate } from '../surface/types.js';
import { isBlankSession, relativeTime, sessionDisplayLabel } from '../session/session-view.js';
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
import type { BranchRecord, WorktreeManager } from '../../contract/index.js';

const TABS = ['overview', 'git', 'sessions', 'children', 'settings'] as const;
type DashboardTab = (typeof TABS)[number];

export interface WorktreeDashboardProps {
  readonly manager?: WorktreeManager;
  readonly onSaveInstructions?: (text: string, expected: string) => Promise<string>;
  readonly onSaveBaseline?: (baseBranch: string, expectedBaseBranch?: string) => Promise<string>;
  readonly branches?: readonly BranchRecord[];
  readonly record: DashboardRecord;
  readonly workspaceTitle: string;
  readonly t: WorktreeTranslate;
  readonly onClose: () => void;
  readonly sessions: SessionListLike;
  readonly sessionPresentations: Readonly<Record<string, SessionPresentation | undefined>>;
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
  currentBranch,
  onSave,
  t,
  disabled,
}: {
  readonly value?: string;
  readonly branches: readonly BranchRecord[];
  readonly currentBranch?: string;
  readonly onSave?: (baseBranch: string, expectedBaseBranch?: string) => Promise<string>;
  readonly t: WorktreeTranslate;
  readonly disabled: boolean;
}) {
  const [saved, setSaved] = useState(value);
  const [draft, setDraft] = useState<string>();
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const picker = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const expected = useRef(value);
  const pickerId = useId();
  const options = branches.filter((branch) => branch.name !== currentBranch);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
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
    setDraft(undefined);
    setSearch('');
    setMenuOpen(false);
    setError(false);
  };
  const openEditor = () => {
    expected.current = saved;
    setDraft(saved ?? '');
    setSearch('');
    setMenuOpen(false);
    setError(false);
  };
  const query = search.trim().toLowerCase();
  const filteredOptions =
    query.length === 0
      ? options
      : options.filter((branch) => branch.name.toLowerCase().includes(query));
  const activeIndex = filteredOptions.findIndex((branch) => branch.name === draft);
  const pickerOpen = menuOpen && !pending;
  const listOpen = pickerOpen && filteredOptions.length > 0;
  useEffect(() => {
    if (!menuOpen || typeof document === 'undefined') return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (picker.current?.contains(event.target as Node) === true) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [menuOpen]);

  const selectOption = (index: number) => {
    const branch = filteredOptions[index];
    if (branch === undefined) return;
    setDraft(branch.name);
    setMenuOpen(true);
  };
  const moveOption = (offset: 1 | -1) => {
    if (filteredOptions.length === 0) return;
    const nextIndex =
      activeIndex < 0
        ? offset > 0
          ? 0
          : filteredOptions.length - 1
        : (activeIndex + offset + filteredOptions.length) % filteredOptions.length;
    selectOption(nextIndex);
    optionRefs.current[nextIndex]?.scrollIntoView({ block: 'nearest' });
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setMenuOpen(true);
      moveOption(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && menuOpen && filteredOptions.length > 0) {
      event.preventDefault();
      selectOption(activeIndex < 0 ? 0 : activeIndex);
    }
  };

  const save = async () => {
    if (
      busy.current ||
      draft === undefined ||
      onSave === undefined ||
      !options.some((branch) => branch.name === draft)
    )
      return;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      const result = await onSave(draft, expected.current);
      if (alive.current) {
        setSaved(result);
        expected.current = result;
        setDraft(undefined);
        setSearch('');
        setMenuOpen(false);
      }
    } catch {
      if (alive.current) setError(true);
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
              disabled={disabled || options.length === 0}
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
                disabled={disabled || options.length === 0}
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
          <span data-dashboard-baseline-value>{saved}</span>
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
              disabled={
                pending || disabled || !options.some((branch) => branch.name === draft)
              }
              onClick={() => void save()}
            >
              {t(pending ? 'dashboard.savingBase' : 'dashboard.saveBase')}
            </Button>
          </>
        }
      >
        <div
          ref={picker}
          className={styles.dashboardBaselinePicker}
          data-dashboard-baseline-modal
        >
          <Input
            icon={<IconSearchOutline16 />}
            className={styles.dashboardBaselineSearch}
            aria-label={t('dashboard.searchBranches')}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listOpen ? `${pickerId}-options` : undefined}
            aria-expanded={listOpen}
            aria-haspopup="listbox"
            aria-activedescendant={
              listOpen && activeIndex >= 0 ? `${pickerId}-option-${activeIndex}` : undefined
            }
            data-dashboard-baseline-search
            disabled={pending || disabled}
            placeholder={t('dashboard.searchBranches')}
            value={search}
            onFocus={() => setMenuOpen(true)}
            onKeyDown={onSearchKeyDown}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setMenuOpen(true);
            }}
          />
          {listOpen && (
            <div
              id={`${pickerId}-options`}
              className={styles.dashboardBaselineOptions}
              data-dashboard-baseline-options
              role="listbox"
              aria-label={t('dashboard.searchBranches')}
            >
              {filteredOptions.map((branch, index) => (
                <button
                  type="button"
                  key={branch.name}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  id={`${pickerId}-option-${index}`}
                  className={styles.dashboardBaselineOption}
                  data-dashboard-baseline-option={branch.name}
                  data-highlighted={activeIndex === index ? true : undefined}
                  role="option"
                  aria-selected={branch.name === draft}
                  onClick={() => selectOption(index)}
                >
                  <IconBranchOutline16 />
                  <span className={styles.dashboardBaselineOptionLabel}>{branch.name}</span>
                  {branch.name === draft && <IconCheckOutline16 />}
                </button>
              ))}
            </div>
          )}
          {pickerOpen && filteredOptions.length === 0 && (
            <div
              className={styles.dashboardBaselineEmpty}
              data-dashboard-baseline-empty
              role="status"
              aria-live="polite"
            >
              {t('dashboard.noMatchingBranches')}
            </div>
          )}
          {error && (
            <div className={styles.dashboardBaselineError} role="alert">
              {t('dashboard.baseSaveFailed')}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

/** A Worktree or browser Main projection with explicitly unconnected MVP cards. */
export function WorktreeDashboard({
  manager,
  record,
  workspaceTitle,
  t,
  onClose,
  sessions,
  sessionPresentations,
  sessionIds,
  actionPending,
  onOpenSession,
  onCreateSession,
  onCreateWorktree,
  onArchiveWorktree,
  onSaveInstructions,
  onSaveBaseline,
  branches = [],
}: WorktreeDashboardProps) {
  const surface = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [placement, setPlacement] = useState<DashboardPlacement>();
  const [tab, setTab] = useState<DashboardTab>('overview');
  const [baselineBranch, setBaselineBranch] = useState(record.baseBranch);
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle');
  const [branchCopyState, setBranchCopyState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle');
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
  useEffect(() => {
    branchCopyGeneration.current += 1;
    branchCopyPending.current = false;
    setBranchCopyState('idle');
    return () => {
      branchCopyGeneration.current += 1;
    };
  }, [record.branch]);
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
  const branchAvailable = record.branch.length > 0;
  const displayBranch = branchAvailable ? record.branch : t('dashboard.branchUnavailable');
  const copyBranch = async () => {
    if (!branchAvailable || branchCopyPending.current) return;
    branchCopyPending.current = true;
    const generation = branchCopyGeneration.current;
    setBranchCopyState('pending');
    try {
      const copied = await writeClipboard(record.branch);
      if (generation === branchCopyGeneration.current)
        setBranchCopyState(copied ? 'copied' : 'failed');
    } catch {
      if (generation === branchCopyGeneration.current) setBranchCopyState('failed');
    } finally {
      if (generation === branchCopyGeneration.current) branchCopyPending.current = false;
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
      : (record.currentBranch ??
        (branchAvailable ? record.branch : t('dashboard.branchUnavailable')));
  const baselineCurrentBranch =
    record.currentBranch === undefined ? record.branch : record.currentBranch ?? undefined;
  const persistBaseline =
    onSaveBaseline === undefined
      ? undefined
      : async (baseBranch: string, expectedBaseBranch?: string) => {
          const result = await onSaveBaseline(baseBranch, expectedBaseBranch);
          setBaselineBranch(result);
          return result;
        };
  const displayedBaseline = onSaveBaseline === undefined ? record.baseBranch : baselineBranch;
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
                aria-current={sessions.current === sessionId ? 'page' : undefined}
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
  return (
    <section
      ref={surface}
      className={styles.dashboardSurface}
      data-worktree-dashboard={record.worktreeId}
      aria-labelledby={`${id}-title`}
      style={placement ?? { visibility: 'hidden', height: 0 }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          // Other dashboard menus own Escape even when focus remains elsewhere in the surface.
          if (event.currentTarget.querySelector('[role="menu"]')) return;
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
            {t('dashboard.preview')}
          </span>
          <button type="button" className={styles.dashboardButton} onClick={onClose}>
            ← {t('dashboard.back')}
          </button>
        </div>
        <header className={styles.dashboardHeader}>
          <div className={styles.dashboardIdentity}>
            <div
              className={styles.dashboardTitleRow}
              data-dashboard-copy="branch"
              role={branchAvailable ? 'button' : undefined}
              tabIndex={branchAvailable ? 0 : undefined}
              aria-label={branchAvailable ? t('dashboard.copyBranch') : undefined}
              title={branchAvailable ? t('dashboard.copyBranch') : undefined}
              aria-busy={branchAvailable && branchCopyState === 'pending' ? true : undefined}
              onClick={branchAvailable ? () => void copyBranch() : undefined}
              onKeyDown={
                branchAvailable
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void copyBranch();
                      }
                    }
                  : undefined
              }
            >
              <IconBranchOutline16 />
              <h1 id={`${id}-title`} ref={heading} tabIndex={-1}>
                {displayBranch}
              </h1>
              <span className={styles.dashboardHealth} data-health={record.health ?? 'unknown'}>
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
            <p
              className={styles.dashboardCopyStatus}
              role={
                branchCopyState === 'failed' ||
                (branchCopyState === 'idle' && copyState === 'failed')
                  ? 'alert'
                  : 'status'
              }
            >
              {branchCopyState === 'pending'
                ? '\u00a0'
                : branchCopyState === 'copied'
                  ? t('dashboard.branchCopied')
                  : branchCopyState === 'failed'
                    ? t('dashboard.branchCopyFailed')
                    : copyState === 'copied'
                      ? t('dashboard.copied')
                      : copyState === 'failed'
                        ? t('dashboard.copyFailed')
                        : '\u00a0'}
            </p>
          </div>
          <div className={styles.dashboardHeaderAside}>
            <OpenInAppButton path={record.absolutePath} t={t} />
            <dl className={styles.dashboardFacts}>
              <DashboardFactRow label={t(acquisitionLabel)}>
                {acquisitionFacts.timestamp ? (
                  <time dateTime={acquisitionFacts.timestamp}>
                    {new Date(acquisitionFacts.timestamp).toLocaleString()}
                  </time>
                ) : (
                  <span className={styles.dashboardHistorical}>
                    {t('dashboard.historicalUnavailable')}
                  </span>
                )}
              </DashboardFactRow>
              {!isMainWorktreeId(record.worktreeId) && persistBaseline !== undefined ? (
                <WorktreeBaselineEditor
                  value={baselineBranch}
                  branches={branches}
                  currentBranch={baselineCurrentBranch}
                  onSave={persistBaseline}
                  t={t}
                  disabled={record.status !== 'active' || record.health === 'recovery-needed'}
                />
              ) : (
                <DashboardFactRow label={t('dashboard.base')} baseline>
                  {displayedBaseline ?? (
                    <span className={styles.dashboardHistorical}>
                      {t('dashboard.historicalUnavailable')}
                    </span>
                  )}
                </DashboardFactRow>
              )}
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
                  <WorktreeInstructions value={record.instructions ?? ''} onSave={onSaveInstructions}
                    t={t} disabled={actionPending || record.health === 'recovery-needed'} />
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
                    <DashboardFactRow label={t('dashboard.branch')}>
                      {liveBranch}
                    </DashboardFactRow>
                    <DashboardFactRow label={t('dashboard.base')}>
                      {displayedBaseline ?? (
                        <span className={styles.dashboardHistorical}>
                          {t('dashboard.historicalUnavailable')}
                        </span>
                      )}
                    </DashboardFactRow>
                    <DashboardFactRow label={t('dashboard.aheadBehind')}>
                      {t('dashboard.notConnected')}
                    </DashboardFactRow>
                    <DashboardFactRow label={t('dashboard.workingTree')}>
                      {t('dashboard.notConnected')}
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
              manager={manager}
              workspaceId={record.workspaceId}
              worktreeId={record.worktreeId}
              defaultBaselineBranch={displayedBaseline}
              currentBranch={baselineCurrentBranch}
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
