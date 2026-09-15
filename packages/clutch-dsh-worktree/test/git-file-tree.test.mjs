import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGitFileTree } from '../lib/client/dashboard/git/git-file-tree.js';

function file(path, status = 'modified', oldPath) {
  return oldPath === undefined ? { path, status } : { path, oldPath, status };
}

function simplify(nodes) {
  return nodes.map((node) =>
    node.kind === 'folder'
      ? { kind: 'folder', name: node.name, path: node.path, children: simplify(node.children) }
      : { kind: 'file', name: node.name, path: node.file.path, oldPath: node.file.oldPath },
  );
}

test('builds a directory-first tree while retaining rename metadata', () => {
  const tree = buildGitFileTree([
    file('README.md'),
    file('src/z.ts'),
    file('src/lib/parser.ts'),
    file('src/index.ts'),
    file('docs/guide.md'),
    file('src/old-name.ts', 'renamed', 'src/old-name-before.ts'),
  ]);

  assert.deepEqual(simplify(tree), [
    {
      kind: 'folder',
      name: 'docs',
      path: 'docs',
      children: [{ kind: 'file', name: 'guide.md', path: 'docs/guide.md', oldPath: undefined }],
    },
    {
      kind: 'folder',
      name: 'src',
      path: 'src',
      children: [
        { kind: 'folder', name: 'lib', path: 'src/lib', children: [{ kind: 'file', name: 'parser.ts', path: 'src/lib/parser.ts', oldPath: undefined }] },
        { kind: 'file', name: 'index.ts', path: 'src/index.ts', oldPath: undefined },
        { kind: 'file', name: 'old-name.ts', path: 'src/old-name.ts', oldPath: 'src/old-name-before.ts' },
        { kind: 'file', name: 'z.ts', path: 'src/z.ts', oldPath: undefined },
      ],
    },
    { kind: 'file', name: 'README.md', path: 'README.md', oldPath: undefined },
  ]);
});

test('retains both nodes when malformed input has a file-directory prefix collision', () => {
  const tree = buildGitFileTree([file('a'), file('a/b.txt')]);

  assert.deepEqual(
    simplify(tree),
    [
      { kind: 'folder', name: 'a', path: 'a', children: [{ kind: 'file', name: 'b.txt', path: 'a/b.txt', oldPath: undefined }] },
      { kind: 'file', name: 'a', path: 'a', oldPath: undefined },
    ],
  );
});

test('sorts file and folder names with natural numeric order', () => {
  const tree = buildGitFileTree([
    file('file10.ts'),
    file('file2.ts'),
    file('file1.ts'),
    file('folder10/sub.ts'),
    file('folder2/sub.ts'),
  ]);

  assert.deepEqual(simplify(tree), [
    {
      kind: 'folder',
      name: 'folder2',
      path: 'folder2',
      children: [{ kind: 'file', name: 'sub.ts', path: 'folder2/sub.ts', oldPath: undefined }],
    },
    {
      kind: 'folder',
      name: 'folder10',
      path: 'folder10',
      children: [{ kind: 'file', name: 'sub.ts', path: 'folder10/sub.ts', oldPath: undefined }],
    },
    { kind: 'file', name: 'file1.ts', path: 'file1.ts', oldPath: undefined },
    { kind: 'file', name: 'file2.ts', path: 'file2.ts', oldPath: undefined },
    { kind: 'file', name: 'file10.ts', path: 'file10.ts', oldPath: undefined },
  ]);
});

test('returns an empty tree for an empty file response', () => {
  assert.deepEqual(buildGitFileTree([]), []);
});
