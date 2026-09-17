import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

import { en } from '../lib/client/locales.js';

const changedFilesUrl = new URL('../src/client/dashboard/git/GitChangedFiles.tsx', import.meta.url);
const diffViewUrl = new URL('../src/client/dashboard/git/GitDiffView.tsx', import.meta.url);

function createMockHarness(sourceCode) {
  const { outputText: output } = ts.transpileModule(sourceCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });

  const jsx = (type, props) => (typeof type === 'function' ? type(props) : { type, props });
  const react = {
    useId: () => 'test-id',
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useMemo: (factory) => factory(),
    useEffect: () => {},
  };

  const primitivesMock = {
    IconFolderClose16: () => jsx('svg', { 'data-icon': 'folder-close' }),
    IconFolderOpen16: () => jsx('svg', { 'data-icon': 'folder-open' }),
    IconRightUpOutline16: (props) => jsx('svg', { 'data-icon': 'right-up', ...props }),
  };

  const exports = {};
  new Function('require', 'exports', output)(
    (name) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitivesMock;
      if (name === './worktree-git.css') return { default: {} };
      if (name === './GitFileTypeIcon.js') return { GitFileTypeIcon: ({ path }) => jsx('span', { 'data-file-icon': path }) };
      if (name === './GitLineStats.js') return { GitLineStats: () => null };
      if (name === './git-diff-parser.js') return { parseUnifiedDiff: () => [] };
      if (name === './git-file-tree.js') {
        return {
          buildGitFileTree: (files) =>
            files.map((file) => ({ kind: 'file', name: file.path, file })),
        };
      }
      return {};
    },
    exports,
  );
  return exports;
}

function findAll(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...[node.props?.children].flat(Infinity).flatMap((child) => findAll(child, predicate)),
  ];
}

const t = (key) => en[key] ?? key;

test('GitChangedFiles stays a plain selectable tree without row actions or status markers', async () => {
  const source = await readFile(changedFilesUrl, 'utf8');
  const { GitChangedFiles } = createMockHarness(source);

  const files = [
    { path: 'src/index.ts', status: 'modified', additions: 10, deletions: 2 },
    { path: 'deleted.ts', status: 'deleted', additions: 0, deletions: 5 },
  ];

  let selectedPath;
  const node = GitChangedFiles({
    files,
    selectedPath: 'src/index.ts',
    onSelect: (path) => { selectedPath = path; },
    t,
  });

  // Opening a changed file is now the summary diff toolbar's action only, and the
  // row status is carried by color, so no marker element is rendered.
  assert.equal(findAll(node, (item) => item.props?.['data-dashboard-git-open-file']).length, 0);
  assert.equal(findAll(node, (item) => item.props?.['data-dashboard-git-status']).length, 0);

  const rows = findAll(node, (item) => item.props?.['data-dashboard-git-file']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].props['aria-label'], 'src/index.ts · Modified');
  rows[0].props.onClick();
  assert.equal(selectedPath, 'src/index.ts');

  const fileIcons = findAll(node, (item) => item.props?.['data-file-icon']);
  assert.equal(fileIcons.length, 2);
  assert.equal(fileIcons[0].props['data-file-icon'], 'src/index.ts');
});

test('GitDiffView renders diff toolbar with path and open-in-sidebar button', async () => {
  const source = await readFile(diffViewUrl, 'utf8');
  const { GitDiffView } = createMockHarness(source);

  const diff = {
    commit: 'abc1234',
    path: 'src/client/App.tsx',
    patch: '@@ -1,3 +1,4 @@\n+import React from "react";\n',
    binary: false,
  };

  let openedPath;
  const node = GitDiffView({
    diff,
    onOpenFile: (path) => { openedPath = path; },
    t,
  });

  const openButtons = findAll(node, (item) => item.props?.['data-dashboard-git-open-file']);
  assert.equal(openButtons.length, 1);
  assert.equal(openButtons[0].props['data-dashboard-git-open-file'], 'src/client/App.tsx');
  assert.equal(openButtons[0].props['title'], 'Open in Sidebar');

  openButtons[0].props.onClick();
  assert.equal(openedPath, 'src/client/App.tsx');
});
