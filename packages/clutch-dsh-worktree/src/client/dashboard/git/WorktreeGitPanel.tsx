import { useRef } from 'react';
import type {
  WorktreeGitCommit,
  WorktreeGitCommitFiles,
  WorktreeGitHistory,
  WorktreeManager,
} from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import type { WorktreeLocaleKey } from '../../locales.js';
import { isMainWorktreeId, normalizeBaselineBranch, sumLineTotals } from './git-facts.js';
import { GitChangedFiles } from './GitChangedFiles.js';
import { GitLineStats } from './GitLineStats.js';
import { GitCommitList } from './GitCommitList.js';
import { GitDiffView } from './GitDiffView.js';
import {
  GIT_SPLIT_DEFAULT_COLUMN_PERCENT,
  GIT_SPLIT_DEFAULT_ROW_PERCENT,
  GIT_SPLIT_MIN_COLUMN_PX,
  GIT_SPLIT_MIN_ROW_PX,
} from './git-column-split.js';
import { useGitPaneSplit } from './useGitPaneSplit.js';
import type { GitPaneSplit, GitSplitOrientation } from './useGitPaneSplit.js';
import { useWorktreeGitState } from './useWorktreeGitState.js';
import styles from './worktree-git.css';

export interface WorktreeGitPanelProps {
  readonly manager?: Pick<
    WorktreeManager,
    'listBranches' | 'listWorktreeCommits' | 'listWorktreeCommitFiles' | 'getWorktreeCommitFileDiff'
  >;
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly defaultBaselineBranch?: string;
  readonly currentBranch?: string;
  /** The record captured an acquisition commit the Manager can use implicitly. */
  readonly capturedBaseline?: boolean;
  readonly onOpenFile?: (path: string) => void;
  readonly t: WorktreeTranslate;
}

function shortCommit(commit: string | undefined): string {
  return commit === undefined ? '—' : commit.slice(0, 7);
}

function selectedCommit(
  history: WorktreeGitHistory | undefined,
  sha: string | undefined,
): WorktreeGitCommit | undefined {
  return history?.commits.find((commit) => commit.sha === sha);
}

function commitCountLabel(history: WorktreeGitHistory, t: WorktreeTranslate): string {
  const committedCount = history.commits.filter((commit) => commit.kind !== 'working-tree').length;
  return history.commits.some((commit) => commit.kind === 'working-tree')
    ? t('dashboard.git.commitCountWithWorkingTree', { commits: committedCount })
    : t('dashboard.git.commitCount', { n: committedCount });
}

function commitLabel(commit: WorktreeGitCommit, t: WorktreeTranslate): string {
  return commit.kind === 'working-tree'
    ? t('dashboard.git.workingTree')
    : shortCommit(commit.sha);
}

function readyFiles(value: WorktreeGitCommitFiles | undefined): readonly WorktreeGitCommitFiles['files'][number][] {
  return value?.files ?? [];
}

/** Empty-state copy per honest unavailable reason; one definition for both blocks. */
const UNAVAILABLE_COPY = {
  main: {
    title: 'dashboard.git.mainUnavailableTitle',
    description: 'dashboard.git.mainUnavailableDescription',
  },
  'baseline-unselected': {
    title: 'dashboard.git.selectBaselineTitle',
    description: 'dashboard.git.selectBaselineDescription',
  },
  'baseline-unknown': {
    title: 'dashboard.git.baselineUnknownTitle',
    description: 'dashboard.git.baselineUnknownDescription',
  },
} as const satisfies Record<
  NonNullable<WorktreeGitHistory['unavailableReason']>,
  { readonly title: WorktreeLocaleKey; readonly description: WorktreeLocaleKey }
>;

function UnavailableNotice({
  reason,
  t,
}: {
  readonly reason: NonNullable<WorktreeGitHistory['unavailableReason']>;
  readonly t: WorktreeTranslate;
}) {
  return (
    <div className={styles.gitUnavailable} data-dashboard-git-unavailable>
      <strong>{t(UNAVAILABLE_COPY[reason].title)}</strong>
      <p>{t(UNAVAILABLE_COPY[reason].description)}</p>
    </div>
  );
}

/** Git & Changes tab: read-only, on-demand history -> target files -> one-file diff. */
export function WorktreeGitPanel({
  manager,
  workspaceId,
  worktreeId,
  defaultBaselineBranch,
  currentBranch,
  capturedBaseline,
  onOpenFile,
  t,
}: WorktreeGitPanelProps) {
  const isMain = isMainWorktreeId(worktreeId);
  const selectedDefaultBaseline = normalizeBaselineBranch(defaultBaselineBranch, currentBranch);
  const state = useWorktreeGitState({
    manager,
    workspaceId,
    worktreeId,
    defaultBaselineBranch: isMain ? undefined : selectedDefaultBaseline,
    capturedBaseline: isMain ? false : capturedBaseline,
  });
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Both dividers share the grid: one splits rows, one splits columns, in either layout.
  const rows = useGitPaneSplit({
    containerRef: gridRef,
    orientation: 'horizontal',
    property: '--git-rows-top',
    minimum: GIT_SPLIT_MIN_ROW_PX,
    fallback: GIT_SPLIT_DEFAULT_ROW_PERCENT,
  });
  const columns = useGitPaneSplit({
    containerRef: gridRef,
    orientation: 'vertical',
    property: '--git-columns-left',
    minimum: GIT_SPLIT_MIN_COLUMN_PX,
    fallback: GIT_SPLIT_DEFAULT_COLUMN_PERCENT,
  });
  const historyValue = state.history.status === 'ready' ? state.history.value : undefined;
  const commit = selectedCommit(historyValue, state.selectedCommit);
  const files = state.files.status === 'ready' ? readyFiles(state.files.value) : [];
  const diff = state.diff.status === 'ready' ? state.diff.value : undefined;
  const refreshing = state.history.status === 'ready' && state.history.refreshing === true;
  const unavailable = historyValue?.unavailableReason;
  const branchOptions = (state.branches.status === 'ready' ? state.branches.value : [])
    .filter((branch) => branch.name !== currentBranch);
  const branchError = state.branches.status === 'error'
    ? state.branches.error
    : state.branches.status === 'ready'
      ? state.branches.error
      : undefined;
  const baselineCommit = historyValue?.baseline?.commit;
  const baselineRef = state.baselineBranch ?? historyValue?.baseline?.ref;
  const targetLabel = state.view === 'summary'
    ? t('dashboard.git.baselineSummary')
    : state.selectedCommits.length > 1
      ? t('dashboard.git.selectedCommitCount', { n: state.selectedCommits.length })
      : commit === undefined
        ? undefined
        : commitLabel(commit, t);
  const hasTarget = state.view === 'summary' || commit !== undefined;
  const lineTotals = state.files.status === 'ready' && hasTarget ? sumLineTotals(files) : undefined;

  return (
    <section className={styles.gitPanel} data-dashboard-git-panel>
      <header className={styles.gitPanelHeader}>
        <div className={styles.gitPanelHeading}>
          <h2>{t('dashboard.git.title')}</h2>
          {!isMain && (
            <label className={styles.gitBaselineSelector}>
              <span>{t('dashboard.git.baselineSelector')}</span>
              <select
                value={state.baselineBranch ?? ''}
                data-dashboard-git-baseline
                disabled={state.branches.status === 'loading'}
                onChange={(event) => state.selectBaselineBranch(event.currentTarget.value || undefined)}
              >
                <option value="">{t('dashboard.git.selectBaseline')}</option>
                {state.baselineBranch !== undefined && !branchOptions.some((branch) => branch.name === state.baselineBranch) && (
                  <option value={state.baselineBranch}>{state.baselineBranch}</option>
                )}
                {branchOptions.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {baselineCommit !== undefined && (
            <dl className={styles.gitBaselineFacts}>
              <div>
                <dt>{t('dashboard.git.base')}</dt>
                <dd>
                  {baselineRef !== undefined ? (
                    <>
                      {baselineRef}
                      <code>@ {shortCommit(baselineCommit)}</code>
                    </>
                  ) : (
                    <code>{shortCommit(baselineCommit)}</code>
                  )}
                  {historyValue?.baseline?.source === 'derived' && (
                    <span className={styles.gitDerived}>{t('dashboard.git.derived')}</span>
                  )}
                </dd>
              </div>
              {historyValue !== undefined && (
                <>
                  <div>
                    <dt>{t('dashboard.git.head')}</dt>
                    <dd><code>{shortCommit(historyValue.headCommit)}</code></dd>
                  </div>
                  <div>
                    <dt>{t('dashboard.git.commits')}</dt>
                    <dd>{commitCountLabel(historyValue, t)}</dd>
                  </div>
                  {historyValue.ahead !== undefined && historyValue.behind !== undefined && (
                    <div>
                      <dt>{t('dashboard.aheadBehind')}</dt>
                      <dd>
                        <GitLineStats
                          additions={historyValue.ahead}
                          deletions={historyValue.behind}
                          ariaLabel={t('dashboard.git.aheadBehindStats', {
                            ahead: historyValue.ahead,
                            behind: historyValue.behind,
                          })}
                        />
                      </dd>
                    </div>
                  )}
                </>
              )}
            </dl>
          )}
          {isMain && historyValue !== undefined && (
            <dl className={styles.gitBaselineFacts}>
              <div>
                <dt>{t('dashboard.git.head')}</dt>
                <dd><code>{shortCommit(historyValue.headCommit)}</code></dd>
              </div>
              <div>
                <dt>{t('dashboard.git.commits')}</dt>
                <dd>{commitCountLabel(historyValue, t)}</dd>
              </div>
            </dl>
          )}
        </div>
        <button
          type="button"
          className={styles.gitRefresh}
          data-dashboard-git-refresh
          disabled={refreshing || state.history.status === 'loading'}
          aria-busy={refreshing || state.history.status === 'loading'}
          onClick={() => void state.refresh()}
        >
          {refreshing ? t('dashboard.git.refreshing') : t('dashboard.git.refresh')}
        </button>
      </header>

      {branchError !== undefined && (
        <div className={styles.gitError} role="alert">
          <p>{t('dashboard.git.loadFailed', { reason: errorText(branchError, t) })}</p>
          <button type="button" onClick={() => void state.loadBranches()}>{t('dashboard.git.retry')}</button>
        </div>
      )}

      {!isMain && unavailable === 'baseline-unselected' && (
        <div className={styles.gitBaselinePrompt} data-dashboard-git-baseline-prompt>
          <strong>{t('dashboard.git.selectBaselineTitle')}</strong>
          <p>{t('dashboard.git.selectBaselineDescription')}</p>
        </div>
      )}

      {state.history.status === 'loading' && (
        <div className={styles.gitLoading} role="status">{t('dashboard.git.loading')}</div>
      )}
      {state.history.status === 'error' && (
        <div className={styles.gitError} role="alert">
          <p>{t('dashboard.git.loadFailed', { reason: errorText(state.history.error, t) })}</p>
          <button type="button" onClick={() => void state.refresh()}>{t('dashboard.git.retry')}</button>
        </div>
      )}
      {state.history.status === 'ready' && state.history.error !== undefined && (
        <div className={styles.gitError} role="alert">
          <p>{t('dashboard.git.refreshFailed', { reason: errorText(state.history.error, t) })}</p>
          <button type="button" onClick={() => void state.refresh()}>{t('dashboard.git.retry')}</button>
        </div>
      )}

      {state.history.status === 'ready' && historyValue !== undefined && unavailable !== undefined && (
        <UnavailableNotice reason={unavailable} t={t} />
      )}

      {state.history.status === 'ready' && historyValue !== undefined && unavailable === undefined && (
        <div className={styles.gitColumns} ref={gridRef}>
          <section
            className={styles.gitColumn}
            data-dashboard-git-pane="commits"
            aria-label={t('dashboard.git.commits')}
          >
            <div className={styles.gitColumnHeader}>
              <h3>{t('dashboard.git.commits')}</h3>
              <div className={styles.gitColumnHeaderControls}>
                {historyValue.truncated && <span>{t('dashboard.git.truncatedHistory')}</span>}
                <label
                  className={styles.gitCommitMultiSelect}
                  title={t('dashboard.git.multiSelectCommitsDescription')}
                >
                  <input
                    type="checkbox"
                    role="switch"
                    data-dashboard-git-multi-select
                    aria-describedby="dashboard-git-commit-selection-hint"
                    checked={state.commitMultiSelect}
                    onChange={(event) => state.setCommitMultiSelect(event.currentTarget.checked)}
                  />
                  <span className={styles.gitCommitMultiSelectTrack} aria-hidden="true">
                    <span className={styles.gitCommitMultiSelectThumb} />
                  </span>
                  <span className={styles.gitCommitMultiSelectLabel}>
                    {t('dashboard.git.multiSelectCommits')}
                  </span>
                </label>
              </div>
            </div>
            {!isMain && (
              <button
                type="button"
                className={styles.gitSummaryButton}
              data-dashboard-git-summary
              aria-pressed={state.view === 'summary'}
              onClick={state.selectSummary}
            >
              <span>{t('dashboard.git.baselineSummary')}</span>
                <small>{t('dashboard.git.baselineSummaryDescription')}</small>
              </button>
            )}
            {!isMain && state.view === 'summary' && (
              <label className={styles.gitSummaryToggle} data-dashboard-git-include-working-tree>
                <input
                  type="checkbox"
                  checked={state.includeWorkingTree}
                  disabled={state.files.status === 'loading'}
                  onChange={(event) => state.setIncludeWorkingTree(event.currentTarget.checked)}
                />
                <span>
                  <strong>{t('dashboard.git.includeWorkingTree')}</strong>
                  <small>{t('dashboard.git.includeWorkingTreeDescription')}</small>
                </span>
              </label>
            )}
            <span id="dashboard-git-commit-selection-hint" className={styles.gitSrOnly}>{t('dashboard.git.commitSelectionHint')}</span>
            {historyValue.commits.length === 0 && <div className={styles.gitEmpty}>{t('dashboard.git.noCommits')}</div>}
            <GitCommitList
              commits={historyValue.commits}
              selectedCommit={state.selectedCommit}
              selectedCommits={state.selectedCommits}
              multiSelect={state.commitMultiSelect}
              onSelect={state.selectCommit}
              onToggle={state.toggleCommit}
              t={t}
            />
          </section>
          <GitSplitter
            split={rows}
            orientation="horizontal"
            axis="rows"
            label={t('dashboard.git.resizeRows')}
          />
          <section
            className={styles.gitColumn}
            data-dashboard-git-pane="changed-files"
            aria-label={t('dashboard.git.changedFiles')}
            aria-busy={state.files.status === 'loading'}
          >
            <div className={styles.gitColumnHeader}>
              <h3>{t('dashboard.git.changedFiles')}</h3>
              <div className={styles.gitColumnHeaderMeta}>
                {targetLabel !== undefined && (state.selectedCommits.length > 1 || state.view === 'summary'
                  ? <span>{targetLabel}</span>
                  : <code>{targetLabel}</code>)}
                {state.files.status === 'ready' && hasTarget && (
                  lineTotals === undefined ? (
                    <span className={styles.gitColumnHeaderUnknown}>{t('dashboard.unknown')}</span>
                  ) : (
                    <GitLineStats
                      additions={lineTotals.additions}
                      deletions={lineTotals.deletions}
                      ariaLabel={t('dashboard.git.lineStats', {
                        additions: lineTotals.additions,
                        deletions: lineTotals.deletions,
                      })}
                    />
                  )
                )}
              </div>
            </div>
            {state.commitMultiSelect && state.selectedCommits.length > 0 && state.view === 'commits' && (
              <div className={styles.gitSelectionToolbar}>
                <span>{t('dashboard.git.selectedCommitCount', { n: state.selectedCommits.length })}</span>
                <button type="button" onClick={state.clearCommitSelection}>{t('dashboard.git.clearCommitSelection')}</button>
              </div>
            )}
            {!hasTarget ? (
              <div className={styles.gitEmpty}>{t('dashboard.git.selectCommit')}</div>
            ) : state.files.status === 'loading' ? (
              <div className={styles.gitLoading} role="status">{state.view === 'summary' ? t('dashboard.git.loadingSummaryFiles') : t('dashboard.git.loadingFiles')}</div>
            ) : state.files.status === 'error' ? (
              <div className={styles.gitError} role="alert">{errorText(state.files.error, t)}</div>
            ) : (
              <>
                {state.files.status === 'ready' && state.files.error !== undefined && (
                  <div className={styles.gitError} role="alert">{errorText(state.files.error, t)}</div>
                )}
                {state.files.status === 'ready' && state.files.value.truncated === true && (
                  <div className={styles.gitEmpty} role="status" data-dashboard-git-files-truncated>
                    {t('dashboard.git.truncatedFiles')}
                  </div>
                )}
                {files.length === 0 && !(state.files.status === 'ready' && state.files.value.truncated === true) ? (
                  <div className={styles.gitEmpty}>
                    {state.view === 'summary'
                      ? state.includeWorkingTree
                        ? t('dashboard.git.noLiveBaselineChanges')
                        : t('dashboard.git.noBaselineChanges')
                      : t('dashboard.git.noFiles')}
                  </div>
                ) : (
                  <GitChangedFiles files={files} selectedPath={state.selectedPath} onSelect={state.selectPath} t={t} />
                )}
              </>
            )}
          </section>
          <GitSplitter
            split={columns}
            orientation="vertical"
            axis="columns"
            label={t('dashboard.git.resizeColumns')}
          />
          <section
            className={styles.gitColumn}
            data-dashboard-git-pane="diff"
            aria-label={t('dashboard.git.diff')}
            aria-busy={state.diff.status === 'loading'}
          >
            <div className={styles.gitColumnHeader}>
              <h3>{state.view === 'summary' ? t('dashboard.git.summaryDiff') : t('dashboard.git.diff')}</h3>
              {state.selectedPath !== undefined && <code title={state.selectedPath}>{state.selectedPath}</code>}
            </div>
            {state.diff.status === 'loading' ? (
              <div className={styles.gitLoading} role="status">{state.view === 'summary' ? t('dashboard.git.loadingSummaryDiff') : t('dashboard.git.loadingDiff')}</div>
            ) : state.diff.status === 'error' ? (
              <div className={styles.gitError} role="alert">{errorText(state.diff.error, t)}</div>
            ) : (
              <GitDiffView diff={diff} onOpenFile={onOpenFile} t={t} />
            )}
          </section>
        </div>
      )}
    </section>
  );
}

interface GitSplitterProps {
  /** Divider state, handlers, and ref published by useGitPaneSplit. */
  readonly split: GitPaneSplit;
  /** Axis the divider resizes: rows by height, columns by width. */
  readonly orientation: GitSplitOrientation;
  /** Stable hook used by the layout CSS to place this divider per breakpoint. */
  readonly axis: 'rows' | 'columns';
  readonly label: string;
}

/**
 * Draggable divider that resizes one axis of the Git grid. The wide layout puts
 * the row divider inside the left column and the column divider beside it; the
 * narrow layout keeps both, between the top panes and above the diff.
 */
function GitSplitter({ split, orientation, axis, label }: GitSplitterProps) {
  return (
    <div
      className={styles.gitColumnSplitter}
      data-dashboard-git-splitter={axis}
      data-dashboard-git-splitting={split.dragging ? 'true' : undefined}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split.percent)}
      title={label}
      tabIndex={0}
      ref={split.splitterRef}
      onPointerDown={split.startDrag}
      onPointerMove={split.drag}
      onPointerUp={split.endDrag}
      onPointerCancel={split.endDrag}
      onLostPointerCapture={split.endDrag}
      onDoubleClick={split.reset}
      onKeyDown={split.onKeyDown}
    />
  );
}

function errorText(error: Error, t: WorktreeTranslate): string {
  return error.message || t('dashboard.unknownError');
}
