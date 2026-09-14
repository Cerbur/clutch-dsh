import type { WorktreeGitChangedFile, WorktreeGitFileStatus } from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import styles from './worktree-git.css';

export interface GitChangedFilesProps {
  readonly files: readonly WorktreeGitChangedFile[];
  readonly selectedPath?: string;
  readonly onSelect: (path: string) => void;
  readonly t: WorktreeTranslate;
}

function statusKey(status: WorktreeGitFileStatus): Parameters<WorktreeTranslate>[0] {
  return `dashboard.git.status.${status === 'type-changed' ? 'typeChanged' : status}` as Parameters<WorktreeTranslate>[0];
}

/** Changed-file authorization projection; only paths returned by Host are selectable. */
export function GitChangedFiles({ files, selectedPath, onSelect, t }: GitChangedFilesProps) {
  return (
    <ul className={styles.gitChangedFileList} role="listbox" aria-label={t('dashboard.git.changedFiles')}>
      {files.map((file) => (
        <li key={`${file.oldPath ?? ''}\u0000${file.path}`}>
          <button
            type="button"
            role="option"
            aria-selected={selectedPath === file.path || selectedPath === file.oldPath}
            data-dashboard-git-file={file.path}
            onClick={() => onSelect(file.path)}
          >
            <span className={styles.gitFileStatus} data-status={file.status} aria-hidden="true">
              {file.status === 'added' ? 'A' : file.status === 'modified' ? 'M' : file.status === 'deleted' ? 'D' : file.status === 'renamed' ? 'R' : file.status === 'copied' ? 'C' : 'T'}
            </span>
            <span className={styles.gitFilePath} title={file.path}>
              {file.oldPath !== undefined && file.oldPath !== file.path ? (
                <>
                  {file.oldPath} <span aria-hidden="true">→</span> {file.path}
                </>
              ) : file.path}
            </span>
            <span className={styles.gitFileStatusLabel}>{t(statusKey(file.status))}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
