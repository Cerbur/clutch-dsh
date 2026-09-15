import { IconFolderClose16, IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { WorktreeGitChangedFile, WorktreeGitFileStatus } from '../../../contract/index.js';
import type { WorktreeTranslate } from '../../surface/types.js';
import { buildGitFileTree, type GitFileTreeNode } from './git-file-tree.js';
import styles from './worktree-git.css';

export interface GitChangedFilesProps {
  readonly files: readonly WorktreeGitChangedFile[];
  readonly selectedPath?: string;
  readonly onSelect: (path: string) => void;
  readonly t: WorktreeTranslate;
}

function statusKey(status: WorktreeGitFileStatus): Parameters<WorktreeTranslate>[0] {
  return 'dashboard.git.status.' + (status === 'type-changed' ? 'typeChanged' : status) as Parameters<WorktreeTranslate>[0];
}

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
            <span className={styles.gitFolderDisclosure} aria-hidden="true">
              {collapsed ? '▸' : '▾'}
            </span>
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
          aria-label={fileTitle(file)}
          title={fileTitle(file)}
          onClick={() => onSelect(file.path)}
        >
          <span className={styles.gitFileStatus} data-status={file.status} aria-hidden="true">
            {file.status === 'added'
              ? 'A'
              : file.status === 'modified'
                ? 'M'
                : file.status === 'deleted'
                  ? 'D'
                  : file.status === 'renamed'
                    ? 'R'
                    : file.status === 'copied'
                      ? 'C'
                      : 'T'}
          </span>
          <span className={styles.gitFilePath} title={fileTitle(file)}>
            {fileLabel(file)}
          </span>
          <span className={styles.gitFileStatusLabel}>{t(statusKey(file.status))}</span>
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
  const tree = buildGitFileTree(files);
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
