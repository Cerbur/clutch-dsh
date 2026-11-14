import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { DashboardSelection } from './dashboard-selection.js';
import { createPortal } from 'react-dom';
import { MenuSurface, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import type { WorktreeRecord, WorktreeManager } from '../../contract/index.js';
import type { WorktreeToolChange } from '../../contract/worktree-tool-changes.js';
import type { WorktreeViewReader } from '../view/worktree-view-read.js';
import type { WorktreeConnectionAdapter } from '../worktree-connection.js';
import type { DashboardHeaderActionProps } from './DashboardHeaderAction.js';
import { IconBranchOutline16, IconLoadingOutline16, IconRefreshOutline16 } from '../dsh-icons.js';
import { useWorktreeGitOverview, WorktreeGitOverviewValue } from './git/WorktreeGitOverview.js';
import { selectPopoverTarget, type PopoverTarget } from './popover-target.js';
import { observePopoverPlacement } from './popover-placement.js';
import { WorktreeBaselineEditor, useWorktreeBaselineSync } from './WorktreeDashboard.js';
import styles from './worktree-popover.css';

export interface WorktreePopoverServices {
  readonly dashboardStore: SnapshotStore<DashboardSelection | undefined>;
  readonly manager: WorktreeManager & Partial<Pick<WorktreeConnectionAdapter, 'startGitWatch' | 'watchGitChanges' | 'stopGitWatch'>>;
  readonly viewReader: WorktreeViewReader;
  readonly subscribeChanges: (listener: (change: WorktreeToolChange) => void) => () => void;
  readonly refreshContext: (workspaceId: string) => Promise<void>;
  readonly createSession: (record: WorktreeRecord, isCurrent: () => boolean) => Promise<unknown>;
  readonly openSession: (workspaceId: string, sessionId: string) => void;
  readonly expand: (sessionId: string, tab: 'overview' | 'git', workspaceId: string, worktreeId: string) => void;
}
export type WorktreePopoverProps = DashboardHeaderActionProps & WorktreePopoverServices;

const OPEN_KEY = 'clutch-dsh-worktree.popover-open';
function readOpenPreference() {
  try { return window.localStorage.getItem(OPEN_KEY) !== 'false'; } catch { return true; }
}

export function WorktreePopover(props: WorktreePopoverProps) {
  const context = props.useWorktreeContext((value) => value);
  const [opened, setOpened] = useState(readOpenPreference);
  const dashboard = useSyncExternalStore(props.dashboardStore.subscribe, props.dashboardStore.getSnapshot);
  const focusRequested = useRef(false);
  const [placement, setPlacement] = useState<CSSProperties>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const visible = opened && dashboard === undefined;
  const saveOpen = (value: boolean) => {
    setOpened(value);
    try { window.localStorage.setItem(OPEN_KEY, String(value)); } catch { /* Keep the in-memory preference. */ }
  };
  const close = () => saveOpen(false);
  useLayoutEffect(() => {
    if (!visible || !trigger.current) return;
    return observePopoverPlacement(trigger.current, setPlacement);
  }, [visible, props.sessionId]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === OPEN_KEY || event.key === null) setOpened(readOpenPreference());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    if (!visible) return;
    if (focusRequested.current) panel.current?.focus({ preventScroll: true });
    focusRequested.current = false;
    const document = trigger.current!.ownerDocument;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented ||
        document.querySelector('[role="dialog"]:not([data-worktree-popover])')) return;
      event.preventDefault(); close(); trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [visible]);
  return <>
    <Tooltip label={props.t('popover.title')} side="bottom" delayMs={500} disabled={visible}>
      <button type="button" ref={trigger} className={styles.popoverTrigger}
        aria-label={props.t('popover.title')} aria-haspopup="dialog" aria-expanded={visible}
        aria-pressed={visible} aria-controls={visible ? id : undefined}
        onClick={() => { focusRequested.current = !visible; saveOpen(!visible); }}>
        <IconBranchOutline16 />
      </button>
    </Tooltip>
    {visible && createPortal(<MenuSurface ref={panel} id={id} role="dialog" tabIndex={-1}
      data-worktree-popover aria-label={props.t('popover.title')} className={styles.popoverPanel}
      style={placement ?? { visibility: 'hidden' }}>
      <PopoverContent key={JSON.stringify([props.sessionId, context.workspaceId, context.value.kind,
        context.value.kind === 'worktree' ? context.value.worktreeId : undefined])} {...props}
        workspaceId={context.sessionId === props.sessionId ? context.workspaceId : undefined}
        mainConfirmed={context.status === 'ready' && context.value.kind === 'main'}
        workspaceTitle={context.workspaceTitle ?? ''} close={close} />
    </MenuSurface>, document.body)}
  </>;
}

function PopoverContent(props: WorktreePopoverProps & {
  workspaceId?: string; mainConfirmed: boolean; workspaceTitle: string; close: () => void;
}) {
  const { manager, viewReader, workspaceId, sessionId, t } = props;
  const [target, setTarget] = useState<PopoverTarget>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(true);
  const [revision, setRevision] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const refreshBusy = useRef(true);
  const refreshLifetime = useRef<AbortController | undefined>(undefined);
  // undefined = no queued refresh; false = reuse central invalidation; true = invalidate.
  const refreshQueued = useRef<boolean | undefined>(undefined);
  const requestRefresh = (invalidate = true) => {
    if (!alive.current) return;
    if (refreshBusy.current) refreshQueued.current = (refreshQueued.current ?? false) || invalidate;
    else void refresh(invalidate);
  };
  const refresh = async (invalidate = false) => {
    if (!alive.current) return;
    if (!workspaceId) { setTarget({ kind: 'unbound' }); setRefreshing(false); return; }
    const ticket = ++generation.current;
    refreshBusy.current = true;
    setRefreshing(true);
    setReadFailed(false);
    if (invalidate) viewReader.invalidate(workspaceId);
    try {
      const view = await viewReader.read(workspaceId, { current: true, signal: refreshLifetime.current?.signal });
      if (alive.current && ticket === generation.current) {
        setTarget(selectPopoverTarget(view, String(sessionId), props.mainConfirmed));
        setRevision((value) => value + 1);
      }
    } catch {
      if (alive.current && ticket === generation.current) {
        setReadFailed(true);
        setTarget((previous) => previous.kind === 'worktree' ? previous : { kind: 'failed' });
      }
    } finally {
      if (alive.current && ticket === generation.current) setRefreshing(false);
    }
  };
  useEffect(() => {
    const lifetime = new AbortController();
    refreshLifetime.current = lifetime;
    alive.current = true;
    void refresh(true);
    const unsubscribe = props.subscribeChanges((change) => {
      // The monitor already invalidated this event and started the shared Context read.
      if (change.workspaceId === workspaceId) requestRefresh(false);
    });
    // This content unmounts when closed or covered by Dashboard. Skip ticks until
    // both Workspace and Git reads settle; never queue overlapping polling reads.
    const timer = workspaceId === undefined ? undefined : window.setInterval(() => {
      if (alive.current && !refreshBusy.current) void refresh(true);
    }, 60_000);
    return () => {
      alive.current = false;
      lifetime.abort();
      refreshQueued.current = undefined;
      generation.current++;
      if (timer !== undefined) window.clearInterval(timer);
      unsubscribe();
    };
  }, [manager, viewReader, workspaceId, sessionId, props.subscribeChanges]);
  const expand = () => {
    if (!workspaceId || (target.kind !== 'worktree' && target.kind !== 'main')) return;
    props.expand(String(sessionId), 'git', workspaceId, target.kind === 'worktree' ? target.record.worktreeId : 'main');
  };
  const record = target.kind === 'worktree' ? target.record : undefined;
  const watchedWorktreeId = record?.worktreeId ?? (target.kind === 'main' ? 'main' : undefined);
  useEffect(() => {
    if (!workspaceId || !watchedWorktreeId || !manager.startGitWatch ||
        !manager.watchGitChanges || !manager.stopGitWatch) return;
    const controller = new AbortController();
    let watchId: string | undefined;
    let retry: number | undefined;
    const release = (id: string) => { void manager.stopGitWatch!(id).catch(() => {}); };
    const listen = async () => {
      try {
        const id = await manager.startGitWatch!({ workspaceId, worktreeId: watchedWorktreeId }, controller.signal);
        if (controller.signal.aborted) { release(id); return; }
        watchId = id;
        // Host sends a one-shot startup reconciliation after registration; start()
        // itself does not establish native watcher readiness.
        let revision = 0;
        while (!controller.signal.aborted) {
          const next = await manager.watchGitChanges!(id, revision, controller.signal);
          if (controller.signal.aborted) return;
          if (next !== revision) requestRefresh();
          revision = next;
        }
      } catch {
        if (!controller.signal.aborted) {
          if (watchId) release(watchId);
          watchId = undefined;
          retry = window.setTimeout(() => { void listen(); }, 60_000);
        }
      }
    };
    void listen();
    return () => {
      controller.abort();
      window.clearTimeout(retry);
      if (watchId) release(watchId);
    };
  }, [manager, workspaceId, watchedWorktreeId]);
  const state = useWorktreeGitOverview({
    manager: record || target.kind === 'main' ? manager : undefined,
    workspaceId: workspaceId ?? '', worktreeId: record?.worktreeId ?? 'main',
    defaultBaselineBranch: record?.baseBranch,
    currentBranch: record?.currentBranch === undefined ? record?.branch : record.currentBranch ?? undefined,
    capturedBaseline: record?.baseCommit !== undefined, refreshKey: revision,
    workingTreeOnly: props.mainConfirmed,
  });
  const busy = refreshing || state.status === 'loading' || (state.status === 'ready' && state.refreshing === true);
  useLayoutEffect(() => {
    refreshBusy.current = busy;
    if (!busy && refreshQueued.current !== undefined && alive.current) {
      const invalidate = refreshQueued.current;
      refreshQueued.current = undefined;
      void refresh(invalidate);
    }
  });
  const title = record?.branch ?? (target.kind === 'main' ? props.workspaceTitle : undefined);
  const branch = record?.currentHead?.name ?? (record?.currentBranch === null
    ? t('dashboard.detached') : record?.currentBranch ?? record?.branch);
  const baseline = record?.baseBranch?.replace(/^refs\/(heads|remotes)\//u, '') ?? record?.baseCommit?.slice(0, 8) ?? '—';
  const failure = readFailed || state.status === 'error';
  const notice = failure ? t('popover.failed') : target.kind !== 'worktree' && target.kind !== 'loading'
    ? t(`popover.${target.kind}`) : state.status === 'unavailable' && record ? t('popover.noComparison') : undefined;
  const skeleton = (className = styles.popoverValuePlaceholder) =>
    <span className={className} aria-hidden="true" data-popover-placeholder />;
  const metricRow = (metric: 'workingTree' | 'aheadBehind' | 'committed') => {
    const content = <>
    <span>{t(metric === 'committed' ? 'dashboard.committedChanges' : `dashboard.${metric}`)}</span>
    <span className={styles.popoverValue}>
      {(record || target.kind === 'main') && state.status === 'ready' ? <WorktreeGitOverviewValue state={state} metric={metric} t={t} />
        : busy ? skeleton() : <span title={notice}>—</span>}
    </span>
    </>;
    if (metric === 'aheadBehind') return record ? <PopoverSyncRow
      record={record} services={props}
      disabled={busy || failure || state.status !== 'ready' || state.history.unavailableReason !== undefined}>
      {content}
    </PopoverSyncRow> : <button type="button" className={styles.popoverRow}
      data-popover-metric={metric} disabled>{content}</button>;
    return <button type="button" className={styles.popoverRow} data-popover-metric={metric}
      onClick={expand} disabled={!record && target.kind !== 'main'} title={t('dashboard.git.title')}>
      {content}
    </button>;
  };
  return <div data-worktree-summary={record?.worktreeId} aria-busy={busy}>
    <div className={styles.popoverHeading}>
      <Tooltip label={title ?? ''} onlyWhenClipped portal side="bottom" maxWidth={360} delayMs={400} disabled={!title}>
        <span className={`${styles.popoverTitle} ${styles.popoverLabel}`} tabIndex={title ? 0 : undefined}>
          {title ?? (busy ? skeleton(styles.popoverTitlePlaceholder) : t('popover.title'))}
        </span>
      </Tooltip>
      <button type="button" className={styles.popoverIconButton} disabled={busy}
        aria-busy={busy} data-popover-refresh
        aria-label={failure ? t('popover.failed') : t('popover.refresh')}
        title={failure ? t('popover.failed') : t('popover.refresh')} onClick={() => void refresh(true)}>
        {busy ? <IconLoadingOutline16 /> : <IconRefreshOutline16 />}
      </button>
    </div>
    {metricRow('workingTree')}
    {!props.mainConfirmed && <>
    <div className={styles.popoverDivider} role="separator" />
    <div className={`${styles.popoverComparison} ${styles.popoverLabel}`} title={notice}>
      {branch ? <span className={styles.popoverComparisonNames}>
        <Tooltip label={branch} onlyWhenClipped portal side="bottom" maxWidth={360} delayMs={400}>
          <span className={styles.popoverBranchName} tabIndex={0}>{branch}</span>
        </Tooltip>
        <span className={styles.popoverComparisonArrow} aria-hidden="true">→</span>
        <Tooltip label={baseline} onlyWhenClipped portal side="bottom" maxWidth={360} delayMs={400}>
          <span className={styles.popoverBaselineName} tabIndex={0}>{baseline}</span>
        </Tooltip>
      </span>
        : busy ? skeleton(styles.popoverTitlePlaceholder) : <span role="status">{notice}</span>}
      {record && <span className={styles.popoverEditBaseline}>
        <WorktreeBaselineEditor iconOnly value={record.baseBranch} branches={[]} loading={false}
          currentBranch={record.currentBranch === null ? undefined : record.currentBranch ?? record.branch}
          disabled={busy || record.status !== 'active' || (record.health !== undefined && record.health !== 'ready')}
          t={t} context={record.branch}
          onLoad={() => manager.listBranches({ workspaceId: record.workspaceId })}
          onFetch={manager.fetchRemoteBranches ? () => manager.fetchRemoteBranches!({ workspaceId: record.workspaceId }) : undefined}
          onSave={async (baseBranch, expectedBaseBranch) => {
            const saved = await manager.updateWorktreeBaseBranch({
              workspaceId: record.workspaceId, worktreeId: record.worktreeId, baseBranch, expectedBaseBranch,
            });
            if (alive.current) {
              setTarget((previous) => previous.kind === 'worktree'
                ? { kind: 'worktree', record: { ...previous.record, baseBranch: saved } } : previous);
              setRevision((value) => value + 1);
            }
            await props.refreshContext(record.workspaceId);
            return saved;
          }} />
      </span>}
    </div>
    {metricRow('aheadBehind')}
    {metricRow('committed')}
    </>}
  </div>;
}

function PopoverSyncRow({ record, services, disabled, children }: {
  record: WorktreeRecord; services: WorktreePopoverProps; disabled: boolean; children: ReactNode;
}) {
  const { manager, t } = services;
  const unavailable = disabled || !record.baseBranch || !manager.syncWorktreeBaseline ||
    record.status !== 'active' || (record.health !== undefined && record.health !== 'ready');
  const { setSyncOpen, syncPending, syncDialog } = useWorktreeBaselineSync({
    record, displayedBaseline: record.baseBranch, manager, t, disabled: unavailable,
    onOpenSession: (sessionId) => services.openSession(record.workspaceId, sessionId),
    onSyncBaseline: async (strategy, baseBranch, requestId) => {
      try {
        return await manager.syncWorktreeBaseline!({
          workspaceId: record.workspaceId, worktreeId: record.worktreeId, strategy, baseBranch, requestId,
        });
      } finally {
        // Refresh only this Workspace; a failed recovery read must not turn an
        // already-dispatched task into a retryable dispatch error.
        void services.refreshContext(record.workspaceId).catch(() => {});
      }
    },
  });
  return <>
    <button type="button" className={styles.popoverRow} data-popover-metric="aheadBehind"
      disabled={unavailable || syncPending} title={t('dashboard.action.sync')}
      aria-haspopup="dialog" onClick={() => setSyncOpen(true)}>
      {children}
    </button>
    {syncDialog}
  </>;
}
