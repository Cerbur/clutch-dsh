import { IconRightUpOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { useEffect, useMemo, useState } from 'react';
import type { WorktreeGitDiffSegment, WorktreeGitFileDiff } from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import { parseUnifiedDiff } from './git-diff-parser.js';
import type { DiffHunk } from './git-diff-parser.js';
import { GitFileTypeIcon } from './GitFileTypeIcon.js';
import styles from './worktree-git.css';

/**
 * Rendering budget for one patch. The provider already bounds patch bytes, but a
 * large summary can still hold thousands of lines, so the panel folds hunks
 * beyond this budget and offers to render the rest on request.
 */
const MAX_RENDERED_DIFF_LINES = 2000;

export interface GitDiffViewProps {
  readonly diff?: WorktreeGitFileDiff;
  readonly onOpenFile?: (path: string) => void;
  readonly t: WorktreeTranslate;
}

function hunkLabel(hunk: DiffHunk): string {
  return '@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@';
}

function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/** Fold whole hunks once the render budget is reached. */
function limitHunks(
  hunks: readonly DiffHunk[],
  maxLines: number,
): { readonly hunks: readonly DiffHunk[]; readonly hiddenLines: number } {
  const visible: DiffHunk[] = [];
  let rendered = 0;
  let hiddenLines = 0;
  for (const hunk of hunks) {
    const cost = hunk.lines.length + 1;
    if (rendered < maxLines) {
      visible.push(hunk);
      rendered += cost;
      continue;
    }
    hiddenLines += cost;
  }
  return { hunks: visible, hiddenLines };
}

/** Render one unified patch as escaped plain text with lightweight line numbers. */
function DiffHunks({ patch, t }: { readonly patch: string; readonly t: WorktreeTranslate }) {
  const hunks = useMemo(() => parseUnifiedDiff(patch), [patch]);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [patch]);
  if (hunks.length === 0) {
    return <pre className={styles.gitRawDiff}>{patch || t('dashboard.git.emptyDiff')}</pre>;
  }
  const limited = expanded ? { hunks, hiddenLines: 0 } : limitHunks(hunks, MAX_RENDERED_DIFF_LINES);
  return (
    <>
      {limited.hunks.map((hunk, hunkIndex) => (
        <section className={styles.gitDiffHunk} key={hunk.oldStart + '-' + hunk.newStart + '-' + hunkIndex}>
          <div className={styles.gitDiffHunkHeader}>{hunkLabel(hunk)}</div>
          {hunk.lines.map((line, lineIndex) => (
            <div className={styles.gitDiffLine + ' ' + styles['gitDiffLine' + line.type]} key={line.type + '-' + lineIndex}>
              <span className={styles.gitDiffLineNumber}>{line.type === 'add' ? '' : line.oldLine}</span>
              <span className={styles.gitDiffLineNumber}>{line.type === 'delete' ? '' : line.newLine}</span>
              <code><span aria-hidden="true">{line.type === 'context' ? ' ' : line.type === 'add' ? '+' : '-'}</span>{line.text}</code>
            </div>
          ))}
        </section>
      ))}
      {limited.hiddenLines > 0 && (
        <div className={styles.gitDiffFolded}>
          <span>{t('dashboard.git.diffLinesHidden', { n: limited.hiddenLines })}</span>
          <button
            type="button"
            className={styles.gitDiffShowAll}
            data-dashboard-git-show-full-diff
            onClick={() => setExpanded(true)}
          >
            {t('dashboard.git.showFullDiff')}
          </button>
        </div>
      )}
    </>
  );
}

function DiffSegment({ segment, t }: { readonly segment: WorktreeGitDiffSegment; readonly t: WorktreeTranslate }) {
  return (
    <section className={styles.gitDiffSegment}>
      <div className={styles.gitDiffSegmentHeader}>
        {t('dashboard.git.commitDiffSection')} <code>{shortCommit(segment.commit)}</code>
      </div>
      {segment.binary ? (
        <div className={styles.gitDiffMessage}>{t('dashboard.git.binary')}</div>
      ) : segment.truncated ? (
        <div className={styles.gitDiffMessage}>{t('dashboard.git.diffTruncated')}</div>
      ) : (
        <DiffHunks patch={segment.patch} t={t} />
      )}
    </section>
  );
}

/** Render unified diff content as escaped plain text with lightweight line numbers. */
export function GitDiffView({ diff, onOpenFile, t }: GitDiffViewProps) {
  if (diff === undefined) {
    return <div className={styles.gitDiffEmpty}>{t('dashboard.git.selectFile')}</div>;
  }
  const toolbar = (
    <div className={styles.gitDiffToolbar}>
      <span className={styles.gitDiffPath} title={diff.path}>
        <GitFileTypeIcon path={diff.path} className={styles.gitFileIconGlyph} />
        {diff.path}
      </span>
      {onOpenFile !== undefined && (
        <button
          type="button"
          className={styles.gitDiffOpenInSidebar}
          onClick={() => onOpenFile(diff.path)}
          title={t('dashboard.git.openInSidebar')}
          data-dashboard-git-open-file={diff.path}
        >
          <IconRightUpOutline16 size={14} className={styles.gitDiffOpenIcon} />
          <span>{t('dashboard.git.openInSidebar')}</span>
        </button>
      )}
    </div>
  );
  if (diff.segments !== undefined) {
    return (
      <div className={styles.gitDiffContainer}>
        {toolbar}
        <div className={styles.gitDiff} role="document" aria-label={t('dashboard.git.diff')}>
          {diff.segments.map((segment, index) => (
            <DiffSegment key={segment.commit + '-' + index} segment={segment} t={t} />
          ))}
        </div>
      </div>
    );
  }
  if (diff.binary || diff.truncated) {
    return (
      <div className={styles.gitDiffContainer}>
        {toolbar}
        <div className={styles.gitDiffMessage}>
          {diff.binary ? t('dashboard.git.binary') : t('dashboard.git.diffTruncated')}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.gitDiffContainer}>
      {toolbar}
      <div className={styles.gitDiff} role="document" aria-label={t('dashboard.git.diff')}>
        <DiffHunks patch={diff.patch} t={t} />
      </div>
    </div>
  );
}
