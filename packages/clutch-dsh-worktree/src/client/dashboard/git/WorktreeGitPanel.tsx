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
    'listWorktreeCommits' | 'listWorktreeCommitFiles' | 'getWorktreeCommitFileDiff'
  >;
  readonly workspaceId: string;
  readonly worktreeId: string;
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

function readyFiles(value: WorktreeGitCommitFiles | undefined): readonly WorktreeGitCommitFiles['files'][number][] {
  return value?.files ?? [];
}

/** Git & Changes tab: read-only, on-demand history → files → one-file diff. */
export function WorktreeGitPanel({ manager, workspaceId, worktreeId, t }: WorktreeGitPanelProps) {
  const state = useWorktreeGitState({ manager, workspaceId, worktreeId });
  const historyValue = state.history.status === 'ready' ? state.history.value : undefined;
  const commit = selectedCommit(historyValue, state.selectedCommit);
  const files = state.files.status === 'ready' ? readyFiles(state.files.value) : [];
  const diff = state.diff.status === 'ready' ? state.diff.value : undefined;
  const refreshing = state.history.status === 'ready' && state.history.refreshing === true;
  const unavailable = historyValue?.unavailableReason;

  return (
    <section className={styles.gitPanel} data-dashboard-git-panel>
      <header className={styles.gitPanelHeader}>
        <div>
          <h2>{t('dashboard.git.title')}</h2>
          {historyValue?.baseline !== undefined ? (
            <dl className={styles.gitBaselineFacts}>
              <div>
                <dt>{t('dashboard.git.base')}</dt>
                <dd>
                  {historyValue.baseline.ref ?? t('dashboard.git.commit')}
                  <code>@ {shortCommit(historyValue.baseline.commit)}</code>
                  {historyValue.baseline.source === 'derived' && (
                    <span className={styles.gitDerived}>{t('dashboard.git.derived')}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t('dashboard.git.head')}</dt>
                <dd><code>{shortCommit(historyValue.headCommit)}</code></dd>
              </div>
              <div>
                <dt>{t('dashboard.git.commits')}</dt>
                <dd>{t('dashboard.git.commitCount', { n: historyValue.commits.length })}</dd>
              </div>
            </dl>
          ) : null}
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
          <strong>{unavailable === 'main' ? t('dashboard.git.mainUnavailableTitle') : t('dashboard.git.baselineUnknownTitle')}</strong>
          <p>{unavailable === 'main' ? t('dashboard.git.mainUnavailableDescription') : t('dashboard.git.baselineUnknownDescription')}</p>
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
                  {commit !== undefined && <code>{shortCommit(commit.sha)}</code>}
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
