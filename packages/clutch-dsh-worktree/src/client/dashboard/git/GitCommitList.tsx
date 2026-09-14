import type { WorktreeGitCommit } from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import styles from './worktree-git.css';

export interface GitCommitListProps {
  readonly commits: readonly WorktreeGitCommit[];
  readonly selectedCommit?: string;
  readonly onSelect: (commit: string) => void;
  readonly t: WorktreeTranslate;
}

function commitDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Keyboard-navigable, graph-free commit list for the V1 Dashboard. */
export function GitCommitList({ commits, selectedCommit, onSelect, t }: GitCommitListProps) {
  const move = (index: number, direction: -1 | 1 | 'first' | 'last'): void => {
    const nextIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? commits.length - 1
        : Math.max(0, Math.min(commits.length - 1, index + direction));
    const next = commits[nextIndex];
    if (next !== undefined) onSelect(next.sha);
  };

  return (
    <ul className={styles.gitCommitList} role="listbox" aria-label={t('dashboard.git.commits')}>
      {commits.map((commit, index) => (
        <li key={commit.sha}>
          <button
            type="button"
            role="option"
            aria-selected={selectedCommit === commit.sha}
            data-dashboard-git-commit={commit.sha}
            onClick={() => onSelect(commit.sha)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                move(index, -1);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                move(index, 'first');
              } else if (event.key === 'End') {
                event.preventDefault();
                move(index, 'last');
              } else if (event.key === 'Enter') {
                event.preventDefault();
                onSelect(commit.sha);
              }
            }}
          >
            <span className={styles.gitCommitSubject}>{commit.subject || t('dashboard.git.untitledCommit')}</span>
            <span className={styles.gitCommitMeta}>
              <code>{commit.sha.slice(0, 7)}</code>
              <span>{commit.authorName}</span>
              <time dateTime={commit.authoredAt} title={commitDate(commit.authoredAt)}>
                {commitDate(commit.authoredAt)}
              </time>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
