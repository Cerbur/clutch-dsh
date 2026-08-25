import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const readmeZh = await readFile(new URL('../README.zh.md', import.meta.url), 'utf8');

function headingShape(source) {
  return [...source.matchAll(/^(#{1,3})\s+/gm)].map(([heading]) => heading.trim().length);
}

function indexOfAny(source, patterns) {
  const indexes = patterns.map((pattern) => source.indexOf(pattern));
  return Math.min(...indexes.filter((index) => index >= 0));
}

test('keeps English and Chinese plugin READMEs structurally aligned', () => {
  assert.deepEqual(headingShape(readme), headingShape(readmeZh));
  assert.match(readme, /assets\/screenshots\/screenshots-en\.png/);
  assert.match(readmeZh, /assets\/screenshots\/screenshots-zh\.png/);

  const npmInstall = indexOfAny(readme, [
    'dsh plugin --profile web add @cerbur/clutch-dsh-worktree',
  ]);
  const repositoryInstall = indexOfAny(readme, [
    'pnpm --filter @cerbur/clutch-dsh-worktree build',
    'github:Cerbur/clutch-dsh#path:/packages/clutch-dsh-worktree',
  ]);
  assert.ok(npmInstall >= 0);
  assert.ok(repositoryInstall > npmInstall);
});
