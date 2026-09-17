import type { ReactNode } from 'react';
import styles from './worktree-git.css';

export interface GitLineStatsProps {
  readonly additions?: number;
  readonly deletions?: number;
  readonly ariaLabel?: string;
  readonly className?: string;
}

/** Compact, color-coded Git line counts shared by overview and changed-file rows. */
export function GitLineStats({
  additions,
  deletions,
  ariaLabel,
  className,
}: GitLineStatsProps): ReactNode {
  if (additions === undefined && deletions === undefined) return null;
  return (
    <span
      className={[styles.gitLineStats, className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      data-dashboard-git-line-stats
    >
      {additions !== undefined && (
        <span className={styles.gitLineAdded} data-dashboard-git-additions>
          +{additions}
        </span>
      )}
      {deletions !== undefined && (
        <span className={styles.gitLineRemoved} data-dashboard-git-deletions>
          -{deletions}
        </span>
      )}
    </span>
  );
}
