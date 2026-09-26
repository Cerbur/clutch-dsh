import { IconFolderClose16, IconFolderOpen16 } from '../../dsh-icons.js';
import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { WorktreeGitChangedFile, WorktreeGitFileStatus } from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import type { WorktreeLocaleKey } from '../../locales.js';
import { buildGitFileTree, type GitFileTreeNode } from './git-file-tree.js';
import { GitFileTypeIcon } from './GitFileTypeIcon.js';
import { GitLineStats } from './GitLineStats.js';
import styles from './worktree-git.css';

export interface GitChangedFilesProps {
  readonly files: readonly WorktreeGitChangedFile[];
  readonly selectedPath?: string;
  readonly onSelect: (path: string) => void;
  readonly t: WorktreeTranslate;
}

/** Localized status wording for the row title and accessible label, so the color cue is still announced. */
const STATUS_LABELS = {
  added: 'dashboard.git.status.added',
  modified: 'dashboard.git.status.modified',
  deleted: 'dashboard.git.status.deleted',
  renamed: 'dashboard.git.status.renamed',
  copied: 'dashboard.git.status.copied',
  'type-changed': 'dashboard.git.status.typeChanged',
} as const satisfies Record<WorktreeGitFileStatus, WorktreeLocaleKey>;

function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

function fileName(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
}

function fileTitle(file: WorktreeGitChangedFile): string {
  return file.oldPath !== undefined && file.oldPath !== file.path
    ? file.oldPath + ' → ' + file.path
    : file.path;
}

function fileLabel(file: WorktreeGitChangedFile): ReactNode {
  const name = fileName(file.path);
  if (file.oldPath === undefined || file.oldPath === file.path) return name;
  return (
    <>
      {fileName(file.oldPath)} <span aria-hidden="true">→</span> {name}
    </>
  );
}

function folderId(treeId: string, path: string): string {
  return 'dashboard-git-folder-' + treeId + '-' + encodeURIComponent(path);
}

interface RenderTreeNodesInput {
  readonly treeId: string;
  readonly level: number;
  readonly nodes: readonly GitFileTreeNode[];
  readonly collapsedFolders: ReadonlySet<string>;
  readonly toggleFolder: (path: string) => void;
  readonly selectedPath?: string;
  readonly onSelect: (path: string) => void;
  readonly t: WorktreeTranslate;
}

function renderTreeNodes({
  treeId,
  level,
  nodes,
  collapsedFolders,
  toggleFolder,
  selectedPath,
  onSelect,
  t,
}: RenderTreeNodesInput): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.kind === 'folder') {
      const collapsed = collapsedFolders.has(node.path);
      const childrenId = folderId(treeId, node.path);
      return (
        <li
          key={'folder:' + node.path}
          className={styles.gitFolder}
          role="treeitem"
          aria-level={level}
          aria-posinset={index + 1}
          aria-setsize={nodes.length}
          aria-expanded={!collapsed}
        >
          <button
            type="button"
            className={styles.gitFolderButton}
            data-dashboard-git-folder={node.path}
            aria-expanded={!collapsed}
            aria-controls={childrenId}
            onClick={() => toggleFolder(node.path)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' && collapsed) {
                event.preventDefault();
                toggleFolder(node.path);
              } else if (event.key === 'ArrowLeft' && !collapsed) {
                event.preventDefault();
                toggleFolder(node.path);
              }
            }}
          >
            <span className={styles.gitFolderIcon} aria-hidden="true">
              {collapsed ? <IconFolderClose16 /> : <IconFolderOpen16 />}
            </span>
            <span className={styles.gitFolderName} title={node.path}>
              {node.name}
            </span>
          </button>
          <ul
            id={childrenId}
            className={styles.gitFolderChildren}
            role="group"
            hidden={collapsed}
          >
            {renderTreeNodes({
              treeId,
              level: level + 1,
              nodes: node.children,
              collapsedFolders,
              toggleFolder,
              selectedPath,
              onSelect,
              t,
            })}
          </ul>
        </li>
      );
    }

    const { file } = node;
    const isSelected = selectedPath === file.path || selectedPath === file.oldPath;
    // The row color carries the status visually; the localized wording stays in the
    // title and accessible label so the row remains readable without color.
    const statusText = fileTitle(file) + ' · ' + t(STATUS_LABELS[file.status]);
    return (
      <li
        key={'file:' + (file.oldPath ?? '') + '\u0000' + file.path}
        role="treeitem"
        aria-level={level}
        aria-posinset={index + 1}
        aria-setsize={nodes.length}
        aria-selected={isSelected}
      >
        <button
          type="button"
          aria-selected={isSelected}
          data-dashboard-git-file={file.path}
          aria-label={statusText}
          title={statusText}
          onClick={() => onSelect(file.path)}
        >
          <span className={styles.gitFileIcon} aria-hidden="true">
            <GitFileTypeIcon path={file.path} className={styles.gitFileIconGlyph} />
          </span>
          <span className={styles.gitFilePath} data-status={file.status} title={statusText}>
            {fileLabel(file)}
          </span>
          <GitLineStats
            additions={file.additions}
            deletions={file.deletions}
            ariaLabel={file.additions === undefined || file.deletions === undefined
              ? undefined
              : t('dashboard.git.lineStats', { additions: file.additions, deletions: file.deletions })}
          />
          {file.commits !== undefined && file.commits.length > 0 && (
            <code className={styles.gitFileContributors} title={file.commits.join(', ')}>
              {file.commits.map(shortCommit).join(', ')}
            </code>
          )}
        </button>
      </li>
    );
  });
}

/** Changed-file tree; only paths returned by Host are selectable. */
export function GitChangedFiles({ files, selectedPath, onSelect, t }: GitChangedFilesProps) {
  const treeInstanceId = useId().replaceAll(':', '');
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Building the tree sorts every folder, so it is derived once per file list
  // instead of on each render of the surrounding panel.
  const tree = useMemo(() => buildGitFileTree(files), [files]);
  const toggleFolder = (path: string): void => {
    setCollapsedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <ul
      className={styles.gitChangedFileList}
      role="tree"
      aria-label={t('dashboard.git.changedFiles')}
      data-dashboard-git-file-tree
    >
      {renderTreeNodes({
        treeId: treeInstanceId,
        level: 1,
        nodes: tree,
        collapsedFolders,
        toggleFolder,
        selectedPath,
        onSelect,
        t,
      })}
    </ul>
  );
}
