import { useEffect, useState } from 'react';
import type {
  WorktreeGitChangedFile,
  WorktreeGitHistory,
  WorktreeManager,
} from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import { GitLineStats } from './GitLineStats.js';
import styles from '../dashboard.css';

export interface WorktreeGitOverviewInput {
  readonly manager?: Pick<WorktreeManager, 'listWorktreeCommits' | 'listWorktreeCommitFiles'>;
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly defaultBaselineBranch?: string;
  readonly currentBranch?: string;
}

export type WorktreeGitOverviewState =
  | { readonly status: 'unavailable' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly history: WorktreeGitHistory;
      readonly files: readonly WorktreeGitChangedFile[];
    }
  | { readonly status: 'error' };

function normalizeBaseline(value: string | undefined, currentBranch: string | undefined): string | undefined {
  const baseline = value?.trim();
  return baseline !== undefined && baseline.length > 0 && baseline !== currentBranch ? baseline : undefined;
}

function isWorkingTreeCommit(commit: WorktreeGitHistory['commits'][number]): boolean {
  return commit.kind === 'working-tree' || commit.sha === 'working-tree';
}

function sumMetrics(files: readonly WorktreeGitChangedFile[]):
  | { readonly additions: number; readonly deletions: number }
  | undefined {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    if (file.additions === undefined || file.deletions === undefined) return undefined;
    additions += file.additions;
    deletions += file.deletions;
  }
  return { additions, deletions };
}

/** Read the small Git projection needed by the Overview status facts. */
export function useWorktreeGitOverview(
  input: WorktreeGitOverviewInput,
): WorktreeGitOverviewState {
  const baselineBranch = normalizeBaseline(input.defaultBaselineBranch, input.currentBranch);
  const [state, setState] = useState<WorktreeGitOverviewState>({ status: 'unavailable' });
  useEffect(() => {
    if (
      input.manager === undefined ||
      input.worktreeId === 'main' ||
      input.worktreeId.startsWith('main:') ||
      baselineBranch === undefined
    ) {
      setState({ status: 'unavailable' });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    void input.manager.listWorktreeCommits({
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
      baseBranch: baselineBranch,
    })
      .then(async (history) => {
        const workingTree = history.commits.find(isWorkingTreeCommit);
        const files = workingTree === undefined
          ? []
          : (await input.manager!.listWorktreeCommitFiles({
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
              baseBranch: baselineBranch,
              commit: workingTree.sha,
            })).files;
        if (active) setState({ status: 'ready', history, files });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [baselineBranch, input.manager, input.workspaceId, input.worktreeId]);
  return state;
}

export function WorktreeGitOverviewValue({
  state,
  metric,
  t,
}: {
  readonly state: WorktreeGitOverviewState;
  readonly metric: 'aheadBehind' | 'workingTree';
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
  const totals = sumMetrics(state.files);
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
