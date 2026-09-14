import type {
  WorktreeGitCommit,
  WorktreeGitCommitFiles,
  WorktreeGitHistory,
  WorktreeManager,
} from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import { GitChangedFiles } from './GitChangedFiles.js';
import { GitCommitList } from './GitCommitList.js';
import { GitDiffView } from './GitDiffView.js';
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
  readonly t: WorktreeTranslate;
}

function shortCommit(commit: string | undefined): string {
  return commit === undefined ? '—' : commit.slice(0, 7);
}

function errorText(error: Error): string {
  return error.message || 'Unknown error';
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

/** Git & Changes tab: read-only, on-demand history → files → one-file diff. */
export function WorktreeGitPanel({
  manager,
  workspaceId,
  worktreeId,
  defaultBaselineBranch,
  t,
}: WorktreeGitPanelProps) {
  const isMain = worktreeId === 'main' || worktreeId.startsWith('main:');
  const state = useWorktreeGitState({
    manager,
    workspaceId,
    worktreeId,
    defaultBaselineBranch: isMain ? undefined : defaultBaselineBranch,
  });
  const historyValue = state.history.status === 'ready' ? state.history.value : undefined;
  const commit = selectedCommit(historyValue, state.selectedCommit);
  const files = state.files.status === 'ready' ? readyFiles(state.files.value) : [];
  const diff = state.diff.status === 'ready' ? state.diff.value : undefined;
  const refreshing = state.history.status === 'ready' && state.history.refreshing === true;
  const unavailable = historyValue?.unavailableReason;
  const branchOptions = state.branches.status === 'ready' ? state.branches.value : [];
  const branchError = state.branches.status === 'error'
    ? state.branches.error
    : state.branches.status === 'ready'
      ? state.branches.error
      : undefined;
  const baselineCommit = historyValue?.baseline?.commit;
  const baselineRef = state.baselineBranch ?? historyValue?.baseline?.ref;

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
          {baselineRef !== undefined && (
            <dl className={styles.gitBaselineFacts}>
              <div>
                <dt>{t('dashboard.git.base')}</dt>
                <dd>
                  {baselineRef}
                  {baselineCommit !== undefined && <code>@ {shortCommit(baselineCommit)}</code>}
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
                </>
              )}
            </dl>
          )}
        </div>
        <button
          type="button"
          className={styles.gitRefresh}
          data-dashboard-git-refresh
          disabled={isMain || state.baselineBranch === undefined || refreshing || state.history.status === 'loading'}
          aria-busy={refreshing || state.history.status === 'loading'}
          onClick={() => void state.refresh()}
        >
          {refreshing ? t('dashboard.git.refreshing') : t('dashboard.git.refresh')}
        </button>
      </header>

      {branchError !== undefined && (
        <div className={styles.gitError} role="alert">
          <p>{t('dashboard.git.loadFailed', { reason: errorText(branchError) })}</p>
          <button type="button" onClick={() => void state.loadBranches()}>{t('dashboard.git.retry')}</button>
        </div>
      )}

      {isMain && (
        <div className={styles.gitUnavailable} data-dashboard-git-unavailable>
          <strong>{t('dashboard.git.mainUnavailableTitle')}</strong>
          <p>{t('dashboard.git.mainUnavailableDescription')}</p>
        </div>
      )}
      {!isMain && state.baselineBranch === undefined && (
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
          <p>{t('dashboard.git.loadFailed', { reason: errorText(state.history.error) })}</p>
          <button type="button" onClick={() => void state.refresh()}>{t('dashboard.git.retry')}</button>
        </div>
      )}
      {state.history.status === 'ready' && state.history.error !== undefined && (
        <div className={styles.gitError} role="alert">
          <p>{t('dashboard.git.refreshFailed', { reason: errorText(state.history.error) })}</p>
          <button type="button" onClick={() => void state.refresh()}>{t('dashboard.git.retry')}</button>
        </div>
      )}

      {state.history.status === 'ready' && unavailable !== undefined && (
        <div className={styles.gitUnavailable} data-dashboard-git-unavailable>
          <strong>{unavailable === 'main'
            ? t('dashboard.git.mainUnavailableTitle')
            : unavailable === 'baseline-unselected'
              ? t('dashboard.git.selectBaselineTitle')
              : t('dashboard.git.baselineUnknownTitle')}</strong>
          <p>{unavailable === 'main'
            ? t('dashboard.git.mainUnavailableDescription')
            : unavailable === 'baseline-unselected'
              ? t('dashboard.git.selectBaselineDescription')
              : t('dashboard.git.baselineUnknownDescription')}</p>
        </div>
      )}

      {state.history.status === 'ready' && historyValue !== undefined && unavailable === undefined && (
        <>
          {historyValue.commits.length === 0 ? (
            <div className={styles.gitEmpty}>{t('dashboard.git.noCommits')}</div>
          ) : (
            <div className={styles.gitColumns}>
              <section className={styles.gitColumn} aria-label={t('dashboard.git.commits')}>
                <div className={styles.gitColumnHeader}>
                  <h3>{t('dashboard.git.commits')}</h3>
                  {historyValue.truncated && <span>{t('dashboard.git.truncatedHistory')}</span>}
                </div>
                <GitCommitList
                  commits={historyValue.commits}
                  selectedCommit={state.selectedCommit}
                  onSelect={state.selectCommit}
                  t={t}
                />
              </section>
              <section className={styles.gitColumn} aria-label={t('dashboard.git.changedFiles')}>
                <div className={styles.gitColumnHeader}>
                  <h3>{t('dashboard.git.changedFiles')}</h3>
                  {commit !== undefined && (commit.kind === 'working-tree'
                    ? <span>{commitLabel(commit, t)}</span>
                    : <code>{commitLabel(commit, t)}</code>)}
                </div>
                {commit === undefined ? (
                  <div className={styles.gitEmpty}>{t('dashboard.git.selectCommit')}</div>
                ) : state.files.status === 'loading' ? (
                  <div className={styles.gitLoading} role="status">{t('dashboard.git.loadingFiles')}</div>
                ) : state.files.status === 'error' ? (
                  <div className={styles.gitError} role="alert">{errorText(state.files.error)}</div>
                ) : files.length === 0 ? (
                  <div className={styles.gitEmpty}>{t('dashboard.git.noFiles')}</div>
                ) : (
                  <GitChangedFiles files={files} selectedPath={state.selectedPath} onSelect={state.selectPath} t={t} />
                )}
              </section>
              <section className={styles.gitColumn} aria-label={t('dashboard.git.diff')}>
                <div className={styles.gitColumnHeader}>
                  <h3>{t('dashboard.git.diff')}</h3>
                  {state.selectedPath !== undefined && <code title={state.selectedPath}>{state.selectedPath}</code>}
                </div>
                {state.diff.status === 'loading' ? (
                  <div className={styles.gitLoading} role="status">{t('dashboard.git.loadingDiff')}</div>
                ) : state.diff.status === 'error' ? (
                  <div className={styles.gitError} role="alert">{errorText(state.diff.error)}</div>
                ) : (
                  <GitDiffView diff={diff} t={t} />
                )}
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}
