import type { WorktreeGitFileDiff } from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import { parseUnifiedDiff } from './git-diff-parser.js';
import styles from './worktree-git.css';

export interface GitDiffViewProps {
  readonly diff?: WorktreeGitFileDiff;
  readonly t: WorktreeTranslate;
}

function hunkLabel(hunk: ReturnType<typeof parseUnifiedDiff>[number]): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

/** Render unified diff content as escaped plain text with lightweight line numbers. */
export function GitDiffView({ diff, t }: GitDiffViewProps) {
  if (diff === undefined) {
    return <div className={styles.gitDiffEmpty}>{t('dashboard.git.selectFile')}</div>;
  }
  if (diff.binary) {
    return <div className={styles.gitDiffMessage}>{t('dashboard.git.binary')}</div>;
  }
  if (diff.truncated) {
    return <div className={styles.gitDiffMessage}>{t('dashboard.git.diffTruncated')}</div>;
  }
  const hunks = parseUnifiedDiff(diff.patch);
  if (hunks.length === 0) {
    return <pre className={styles.gitRawDiff}>{diff.patch || t('dashboard.git.emptyDiff')}</pre>;
  }
  return (
    <div className={styles.gitDiff} role="document" aria-label={t('dashboard.git.diff')}>
      {hunks.map((hunk, hunkIndex) => (
        <section className={styles.gitDiffHunk} key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
          <div className={styles.gitDiffHunkHeader}>{hunkLabel(hunk)}</div>
          {hunk.lines.map((line, lineIndex) => (
            <div className={`${styles.gitDiffLine} ${styles[`gitDiffLine${line.type}`]}`} key={`${line.type}-${lineIndex}`}>
              <span className={styles.gitDiffLineNumber}>{line.type === 'add' ? '' : line.oldLine}</span>
              <span className={styles.gitDiffLineNumber}>{line.type === 'delete' ? '' : line.newLine}</span>
              <code><span aria-hidden="true">{line.type === 'context' ? ' ' : line.type === 'add' ? '+' : '-'}</span>{line.text}</code>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
