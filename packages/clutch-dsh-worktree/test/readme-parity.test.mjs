import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const readmeZh = await readFile(new URL('../README.zh.md', import.meta.url), 'utf8');

function headingShape(source) {
  return [...source.matchAll(/^(#{1,3})\s+/gm)].map(([heading]) => heading.trim().length);
}

function indexOfAny(source, patterns) {
  const indexes = patterns.map((pattern) => source.indexOf(pattern));
  return Math.min(...indexes.filter((index) => index >= 0));
}

test('keeps English and Chinese plugin READMEs structurally aligned', async () => {
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

  assert.match(readme, /Git must be installed and available on `PATH`/);
  assert.match(readme, /A missing Git\s+executable shows install guidance and no command block/);
  assert.match(readme, /does not run setup or installation commands/);
  assert.match(readmeZh, /Git 必须已安装且可在 PATH 中使用/);
  assert.match(readmeZh, /Git 可执行文件缺失时显示安装提示且不显示命令块/);
  assert.match(readmeZh, /不会执行 setup 或安装命令/);

  const clientReadme = await readFile(
    new URL('../src/client/README.md', import.meta.url),
    'utf8',
  );
  assert.match(clientReadme, /Git must be installed and available on `PATH`/);
  assert.match(clientReadme, /missing Git.*install guidance/i);
  assert.match(clientReadme, /does not run.*commands/i);
});
