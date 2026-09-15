import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';

const cssUrl = new URL('../src/client/dashboard/git/worktree-git.css', import.meta.url);
const changedFilesUrl = new URL('../src/client/dashboard/git/GitChangedFiles.tsx', import.meta.url);
const gitPanelUrl = new URL('../src/client/dashboard/git/WorktreeGitPanel.tsx', import.meta.url);

function cssBlock(source, selector) {
  const start = source.indexOf(selector);
  assert.notEqual(start, -1, 'missing CSS selector: ' + selector);
  const end = source.indexOf('}', start);
  assert.notEqual(end, -1, 'unterminated CSS block: ' + selector);
  return source.slice(start, end).replace(/\s+/gu, ' ').replace(/\(\s+/gu, '(').replace(/\s+\)/gu, ')');
}

test('Git diff surfaces use DSH theme tokens for dark mode', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const diff = cssBlock(css, '.gitDiff {');
  const hunk = cssBlock(css, '.gitDiffHunkHeader {');
  const additions = cssBlock(css, '.gitDiffLineadd {');
  const deletions = cssBlock(css, '.gitDiffLinedelete {');
  const raw = cssBlock(css, '.gitRawDiff {');

  assert.ok(diff.includes('background: var(--dsw-alias-markdown-code-block, #fafbfc);'));
  assert.ok(diff.includes('color: var(--dsw-alias-label-primary, #263342);'));
  assert.ok(hunk.includes('background: var(--dsw-alias-markdown-code-block-banner, #edf3fb);'));
  assert.ok(hunk.includes('color: var(--dsw-alias-state-business-primary, #4a70a1);'));
  assert.ok(
    additions.includes(
      'background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #23845f) 18%, var(--dsw-alias-markdown-code-block, #fafbfc));',
    ),
  );
  assert.ok(
    deletions.includes(
      'background: color-mix(in srgb, var(--dsw-alias-state-error-secondary, #bd5d55) 18%, var(--dsw-alias-markdown-code-block, #fafbfc));',
    ),
  );
  assert.ok(raw.includes('background: var(--dsw-alias-markdown-code-block, #fafbfc);'));
  assert.ok(raw.includes('color: var(--dsw-alias-label-primary, #263342);'));

  for (const lightOnlyColor of ['#fafbfc', '#263342', '#edf3fb', '#ecf8f0', '#fff0ef']) {
    assert.equal(diff.includes('background: ' + lightOnlyColor), false);
    assert.equal(diff.includes('color: ' + lightOnlyColor), false);
    assert.equal(hunk.includes('background: ' + lightOnlyColor), false);
    assert.equal(hunk.includes('color: ' + lightOnlyColor), false);
    assert.equal(additions.includes('background: ' + lightOnlyColor), false);
    assert.equal(deletions.includes('background: ' + lightOnlyColor), false);
    assert.equal(raw.includes('background: ' + lightOnlyColor), false);
    assert.equal(raw.includes('color: ' + lightOnlyColor), false);
  }
});

test('Git panes stay bounded and scroll their data independently', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const columns = cssBlock(css, '.gitColumns {');
  const column = cssBlock(css, '.gitColumn {');
  const lists = cssBlock(css, '.gitCommitList,');
  const diff = cssBlock(css, '.gitDiff {');
  const raw = cssBlock(css, '.gitRawDiff {');

  assert.match(columns, /height: var\(--git-columns-height\);/);
  assert.match(columns, /min-height: 0;/);
  assert.match(columns, /resize: none;/);
  assert.match(column, /display: flex;/);
  assert.match(column, /min-height: 0;/);
  assert.match(column, /overflow: hidden;/);
  assert.match(lists, /flex: 1 1 auto;/);
  assert.match(lists, /min-height: 0;/);
  assert.match(lists, /overflow-y: auto;/);
  assert.match(diff, /flex: 1 1 auto;/);
  assert.match(diff, /min-height: 0;/);
  assert.match(diff, /overflow: auto;/);
  assert.match(raw, /overflow: auto;/);
  assert.match(css, /@container \(max-width: 900px\)[\s\S]*grid-template-rows: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@container \(max-width: 520px\)[\s\S]*height: clamp\(260px, calc\(100dvh - 360px\), 360px\);/);
});

test('changed-file lists scroll long names without ellipsis', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const filePath = cssBlock(css, '.gitFilePath {');
  const folderName = cssBlock(css, '.gitFolderName {');
  const fileButton = cssBlock(css, '.gitChangedFileList button {\n  display: flex;');

  assert.match(css, /\.gitChangedFileList \{[\s\S]*overflow-x: auto;/);
  assert.match(css, /\.gitChangedFileList > li,[\s\S]*width: max-content;/);
  assert.match(fileButton, /width: max-content;/);
  assert.match(fileButton, /min-width: 100%;/);
  assert.match(filePath, /min-width: max-content;/);
  assert.match(filePath, /overflow: visible;/);
  assert.match(filePath, /text-overflow: clip;/);
  assert.match(folderName, /min-width: max-content;/);
  assert.match(folderName, /text-overflow: clip;/);
});

test('changed-file folders use the native DSH folder icons', async () => {
  const source = await readFile(changedFilesUrl, 'utf8');

  assert.match(source, /IconFolderClose16/);
  assert.match(source, /IconFolderOpen16/);
  assert.match(source, /collapsed \? <IconFolderClose16 \/> : <IconFolderOpen16 \/>/);
  assert.doesNotMatch(source, /gitFolderDisclosure/);
  assert.doesNotMatch(await readFile(cssUrl, 'utf8'), /\.gitFolderDisclosure/);
});

test('changed-file names carry the Git status color without status markers', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const source = await readFile(changedFilesUrl, 'utf8');

  assert.match(source, /<span className=\{styles\.gitFilePath\} data-status=\{file\.status\}/u);
  assert.doesNotMatch(source, /gitFileStatus(?:Label)?/);
  assert.doesNotMatch(css, /\.gitFileStatus(?:Label)?/);
  assert.match(css, /\.gitFilePath\[data-status='added'\][\s\S]*state-success-primary/u);
  assert.match(css, /\.gitFilePath\[data-status='deleted'\][\s\S]*state-error-secondary/u);
  assert.match(css, /\.gitFilePath\[data-status='modified'\][\s\S]*state-business-primary/u);
  assert.match(css, /\.gitFilePath\[data-status='renamed'\][\s\S]*state-business-primary/u);
});

test('changed-file stats use explicit green additions and red deletions', async () => {
  const css = await readFile(cssUrl, 'utf8');
  const source = await readFile(changedFilesUrl, 'utf8');
  const panel = await readFile(gitPanelUrl, 'utf8');
  const lineStats = await readFile(new URL('../src/client/dashboard/git/GitLineStats.tsx', import.meta.url), 'utf8');

  assert.match(source, /<GitLineStats[\s\S]*additions=\{file\.additions\}[\s\S]*deletions=\{file\.deletions\}/u);
  assert.match(panel, /data-dashboard-git-summary/);
  assert.match(panel, /gitColumnHeaderMeta/);
  assert.match(panel, /lineTotals\.additions/);
  assert.match(panel, /lineTotals\.deletions/);
  assert.match(lineStats, /data-dashboard-git-additions/);
  assert.match(lineStats, /data-dashboard-git-deletions/);
  assert.match(css, /\.gitLineAdded[\s\S]*state-success-primary/u);
  assert.match(css, /\.gitLineRemoved[\s\S]*state-error-secondary/u);
  assert.match(css, /\.gitChangedFileList \.gitLineStats[\s\S]*font-size: 11px;/u);
});

test('Overview Git facts reuse history, committed summary, and working-tree reads', async () => {
  const source = await readFile(new URL('../src/client/dashboard/git/WorktreeGitOverview.tsx', import.meta.url), 'utf8');

  assert.match(source, /listWorktreeCommits/);
  assert.match(source, /listWorktreeCommitFiles/);
  assert.match(source, /selection: \{ kind: 'summary', includeWorkingTree: false \}/u);
  assert.match(source, /committedFiles/);
  assert.match(source, /workingTreeFiles/);
  assert.match(source, /metric: 'aheadBehind' \| 'committed' \| 'workingTree'/u);
  assert.match(source, /history\.unavailableReason/);
});
