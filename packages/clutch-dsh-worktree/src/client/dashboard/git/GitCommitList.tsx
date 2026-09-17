import { useRef } from 'react';
import type { WorktreeGitCommit } from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import styles from './worktree-git.css';

export interface GitCommitListProps {
  readonly commits: readonly WorktreeGitCommit[];
  readonly selectedCommit?: string;
  readonly selectedCommits?: readonly string[];
  /** When off, a click replaces the selection instead of toggling one commit. */
  readonly multiSelect?: boolean;
  readonly onSelect: (commit: string) => void;
  readonly onToggle?: (commit: string) => void;
  readonly t: WorktreeTranslate;
}

function commitDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** Keyboard-navigable, optionally multi-selectable, graph-free commit list for the Dashboard. */
export function GitCommitList({ commits, selectedCommit, selectedCommits = [], multiSelect = false, onSelect, onToggle, t }: GitCommitListProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number, direction: -1 | 1 | 'first' | 'last'): void => {
    const nextIndex = direction === 'first'
      ? 0
      : direction === 'last'
        ? commits.length - 1
        : Math.max(0, Math.min(commits.length - 1, index + direction));
    itemRefs.current[nextIndex]?.focus();
  };
  const pick = (commit: WorktreeGitCommit): void => {
    // The working tree is a single live target, so it always replaces the selection.
    if (!multiSelect || commit.kind === 'working-tree' || onToggle === undefined) onSelect(commit.sha);
    else onToggle(commit.sha);
  };

  return (
    <ul
      className={styles.gitCommitList}
      role="listbox"
      aria-multiselectable={multiSelect}
      data-dashboard-git-commit-multiselect={multiSelect ? 'on' : 'off'}
      aria-label={t('dashboard.git.commits')}
      aria-describedby={multiSelect ? 'dashboard-git-commit-selection-hint' : undefined}
    >
      {commits.map((commit, index) => {
        const isWorkingTree = commit.kind === 'working-tree';
        const isSelected = isWorkingTree
          ? selectedCommit === commit.sha
          : selectedCommits.includes(commit.sha);
        return (
          <li key={commit.sha}>
            <button
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-posinset={index + 1}
              aria-setsize={commits.length}
              data-dashboard-git-commit={commit.sha}
              data-dashboard-git-commit-kind={commit.kind ?? 'commit'}
              onClick={() => pick(commit)}
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
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  pick(commit);
                }
              }}
            >
              {multiSelect && (
                <span className={styles.gitCommitSelectionMark} aria-hidden="true">{isSelected ? '✓' : '○'}</span>
              )}
              <span className={styles.gitCommitSubject}>
                {isWorkingTree ? t('dashboard.git.uncommittedChanges') : commit.subject || t('dashboard.git.untitledCommit')}
              </span>
              <span className={styles.gitCommitMeta}>
                {isWorkingTree ? (
                  <span className={styles.gitCommitWorkingTree}>{t('dashboard.git.workingTree')}</span>
                ) : (
                  <>
                    <code>{commit.sha.slice(0, 7)}</code>
                    <span>{commit.authorName}</span>
                    <time dateTime={commit.authoredAt} title={commitDate(commit.authoredAt)}>
                      {commitDate(commit.authoredAt)}
                    </time>
                  </>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
