import type { WorktreeGitChangedFile } from '../../../contract/index.js';

export interface GitFileTreeFileNode {
  readonly kind: 'file';
  readonly name: string;
  readonly file: WorktreeGitChangedFile;
}

export interface GitFileTreeFolderNode {
  readonly kind: 'folder';
  readonly name: string;
  readonly path: string;
  readonly children: readonly GitFileTreeNode[];
}

export type GitFileTreeNode = GitFileTreeFileNode | GitFileTreeFolderNode;

type MutableNode =
  | GitFileTreeFileNode
  | {
      readonly kind: 'folder';
      readonly name: string;
      readonly path: string;
      readonly children: Map<string, MutableNode>;
    };

function compareNodes(left: MutableNode, right: MutableNode): number {
  if (left.kind !== right.kind) return left.kind === 'folder' ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function materialize(nodes: Map<string, MutableNode>): readonly GitFileTreeNode[] {
  return [...nodes.values()].sort(compareNodes).map((node) =>
    node.kind === 'folder'
      ? {
          kind: 'folder' as const,
          name: node.name,
          path: node.path,
          children: materialize(node.children),
        }
      : node,
  );
}

/** Build a stable, directory-first tree from Git's slash-separated relative paths. */
export function buildGitFileTree(files: readonly WorktreeGitChangedFile[]): readonly GitFileTreeNode[] {
  const roots = new Map<string, MutableNode>();
  for (const file of files) {
    const segments = file.path.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      roots.set(file.path, { kind: 'file', name: file.path, file });
      continue;
    }

    let nodes = roots;
    let directoryPath = '';
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      directoryPath = directoryPath.length === 0 ? segment : directoryPath + '/' + segment;
      const folderKey = 'folder:' + segment;
      const existing = nodes.get(folderKey);
      if (existing?.kind === 'folder') {
        nodes = existing.children;
        continue;
      }
      const folder: MutableNode = {
        kind: 'folder',
        name: segment,
        path: directoryPath,
        children: new Map(),
      };
      nodes.set(folderKey, folder);
      nodes = folder.children;
    }

    const name = segments[segments.length - 1];
    const fileKey = 'file:' + name + ':' + file.path + ':' + (file.oldPath ?? '');
    nodes.set(fileKey, { kind: 'file', name, file });
  }
  return materialize(roots);
}
