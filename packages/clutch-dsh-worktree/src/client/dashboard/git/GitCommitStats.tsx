import type { WorktreeTranslate } from '../../surface/types.js';
import styles from './worktree-git.css';

/** Commit divergence is a neutral count, separate from added/deleted code lines. */
export function GitCommitStats({ ahead, behind, t }: {
  readonly ahead: number;
  readonly behind: number;
  readonly t: WorktreeTranslate;
}) {
  return <span className={styles.gitCommitStats} data-dashboard-git-commit-stats
    aria-label={t('dashboard.git.aheadBehindStats', { ahead, behind })}>
    <span>↑ {ahead}</span><span>↓ {behind}</span>
  </span>;
}
