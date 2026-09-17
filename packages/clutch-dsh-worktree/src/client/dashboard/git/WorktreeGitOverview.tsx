import { useEffect, useState } from 'react';
import { WORKTREE_GIT_WORKING_TREE } from '../../../contract/index.js';
import type {
  WorktreeGitChangedFile,
  WorktreeGitHistory,
  WorktreeManager,
} from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import { isMainWorktreeId, normalizeBaselineBranch, sumLineTotals } from './git-facts.js';
import { GitLineStats } from './GitLineStats.js';
import styles from '../dashboard.css';

export interface WorktreeGitOverviewInput {
  readonly manager?: Pick<WorktreeManager, 'listWorktreeCommits' | 'listWorktreeCommitFiles'>;
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly defaultBaselineBranch?: string;
  readonly currentBranch?: string;
  /** The record captured an acquisition commit the Manager can use implicitly. */
  readonly capturedBaseline?: boolean;
}

export type WorktreeGitOverviewState =
  | { readonly status: 'unavailable' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly history: WorktreeGitHistory;
      readonly committedFiles: readonly WorktreeGitChangedFile[];
      readonly workingTreeFiles: readonly WorktreeGitChangedFile[];
    }
  | { readonly status: 'error' };

function isWorkingTreeCommit(commit: WorktreeGitHistory['commits'][number]): boolean {
  return commit.kind === 'working-tree' || commit.sha === WORKTREE_GIT_WORKING_TREE;
}

/** Read the compact Git projections needed by the Overview status facts. */
export function useWorktreeGitOverview(
  input: WorktreeGitOverviewInput,
): WorktreeGitOverviewState {
  const baselineBranch = normalizeBaselineBranch(input.defaultBaselineBranch, input.currentBranch);
  // A captured acquisition commit keeps the Overview readable without a selected
  // branch; Main and genuinely baseline-less records still make no Git request.
  const readable = input.capturedBaseline === true || baselineBranch !== undefined;
  const [state, setState] = useState<WorktreeGitOverviewState>({ status: 'unavailable' });
  useEffect(() => {
    if (input.manager === undefined || isMainWorktreeId(input.worktreeId) || !readable) {
      setState({ status: 'unavailable' });
      return;
    }
    const manager = input.manager;
    let active = true;
    setState({ status: 'loading' });
    void manager.listWorktreeCommits({
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
      baseBranch: baselineBranch,
    })
      .then(async (history) => {
        const workingTree = history.commits.find(isWorkingTreeCommit);
        const committedFilesPromise = history.unavailableReason === undefined
          ? manager.listWorktreeCommitFiles({
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
              baseBranch: baselineBranch,
              selection: { kind: 'summary', includeWorkingTree: false },
            }).then((result) => result.files)
          : Promise.resolve([] as readonly WorktreeGitChangedFile[]);
        const workingTreeFilesPromise = workingTree === undefined
          ? Promise.resolve([] as readonly WorktreeGitChangedFile[])
          : manager.listWorktreeCommitFiles({
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
              baseBranch: baselineBranch,
              commit: workingTree.sha,
            }).then((result) => result.files);
        const [committedFiles, workingTreeFiles] = await Promise.all([
          committedFilesPromise,
          workingTreeFilesPromise,
        ]);
        if (active) setState({ status: 'ready', history, committedFiles, workingTreeFiles });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [baselineBranch, readable, input.manager, input.workspaceId, input.worktreeId]);
  return state;
}

export function WorktreeGitOverviewValue({
  state,
  metric,
  t,
}: {
  readonly state: WorktreeGitOverviewState;
  readonly metric: 'aheadBehind' | 'committed' | 'workingTree';
  readonly t: WorktreeTranslate;
}) {
  if (state.status !== 'ready') {
    return <span className={styles.dashboardHistorical}>{t('dashboard.notConnected')}</span>;
  }
  if (metric === 'aheadBehind') {
    const { ahead, behind } = state.history;
    if (ahead === undefined || behind === undefined) {
      return <span className={styles.dashboardHistorical}>{t('dashboard.notConnected')}</span>;
    }
    return (
      <GitLineStats
        additions={ahead}
        deletions={behind}
        ariaLabel={t('dashboard.git.aheadBehindStats', { ahead, behind })}
      />
    );
  }
  if (state.history.unavailableReason !== undefined) {
    return <span className={styles.dashboardHistorical}>{t('dashboard.notConnected')}</span>;
  }
  const files = metric === 'committed' ? state.committedFiles : state.workingTreeFiles;
  const totals = sumLineTotals(files);
  if (totals === undefined) {
    return <span className={styles.dashboardHistorical}>{t('dashboard.unknown')}</span>;
  }
  return (
    <GitLineStats
      additions={totals.additions}
      deletions={totals.deletions}
      ariaLabel={t('dashboard.git.lineStats', {
        additions: totals.additions,
        deletions: totals.deletions,
      })}
    />
  );
}
