import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const readmeZh = await readFile(path.join(root, 'README.zh.md'), 'utf8');

test('English and Chinese README files keep the public documentation contract aligned', async () => {
  const requiredEnglish = [
    '## Installation',
    '### Install from npm',
    '### Install from a local checkout',
    '## Features',
    '## Usage',
    '### Choose a title template',
    '### Manage templates',
    '### Create a custom template',
    '### Refresh / regenerate a title',
    '### Disable custom titles',
    '### View generation statistics',
    '## Template reference',
    '## Configuration',
    '## Behavior and limitations',
    '## Requirements',
  ];
  const requiredChinese = [
    '## 安装',
    '### 从 npm 安装',
    '### 从本地 checkout 安装',
    '## 功能',
    '## 使用',
    '### 选择标题模板',
    '### 管理模板',
    '### 创建自定义模板',
    '### 刷新 / 重新生成标题',
    '### 关闭自定义标题',
    '### 查看生成统计',
    '## 模板参考',
    '## 配置',
    '## 行为与限制',
    '## 要求',
  ];

  for (const heading of requiredEnglish) assert.notEqual(readme.indexOf(heading), -1);
  for (const heading of requiredChinese) assert.notEqual(readmeZh.indexOf(heading), -1);
  assert.match(
    readme,
    /^\[English\]\(README\.md\) \| \[简体中文\]\(README\.zh\.md\)\n\n# @cerbur\/clutch-dsh-title/,
  );
  assert.match(
    readmeZh,
    /^\[English\]\(README\.md\) \| \[简体中文\]\(README\.zh\.md\)\n\n# @cerbur\/clutch-dsh-title/,
  );
  assert.ok(!readme.includes('## Capabilities'));
  assert.ok(!readmeZh.includes('## 能力'));

  assert.ok(readme.indexOf('## Installation') < readme.indexOf('## Features'));
  assert.ok(readme.indexOf('## Features') < readme.indexOf('## Usage'));
  assert.ok(readme.indexOf('## Usage') < readme.indexOf('## Template reference'));
  assert.ok(readme.indexOf('## Template reference') < readme.indexOf('## Configuration'));
  assert.ok(readme.indexOf('## Configuration') < readme.indexOf('## Behavior and limitations'));
  assert.ok(readme.indexOf('## Behavior and limitations') < readme.indexOf('## Requirements'));
  assert.ok(readmeZh.indexOf('## 安装') < readmeZh.indexOf('## 功能'));
  assert.ok(readmeZh.indexOf('## 功能') < readmeZh.indexOf('## 使用'));
  assert.ok(readmeZh.indexOf('## 使用') < readmeZh.indexOf('## 模板参考'));
  assert.ok(readmeZh.indexOf('## 模板参考') < readmeZh.indexOf('## 配置'));
  assert.ok(readmeZh.indexOf('## 配置') < readmeZh.indexOf('## 行为与限制'));
  assert.ok(readmeZh.indexOf('## 行为与限制') < readmeZh.indexOf('## 要求'));
  assert.ok(!/^npm install/m.test(readme));
  assert.ok(!/^npm install/m.test(readmeZh));

  for (const screenshot of [
    'assets/screenshots/session-title-list.png',
    'assets/screenshots/title-settings.png',
  ]) {
    assert.ok(readme.includes(screenshot), 'English README is missing ' + screenshot);
    assert.ok(readmeZh.includes(screenshot), 'Chinese README is missing ' + screenshot);
    assert.ok(readme.indexOf(screenshot) > readme.indexOf('## Features'));
    assert.ok(readme.indexOf(screenshot) < readme.indexOf('## Usage'));
    assert.ok(readmeZh.indexOf(screenshot) > readmeZh.indexOf('## 功能'));
    assert.ok(readmeZh.indexOf(screenshot) < readmeZh.indexOf('## 使用'));
  }

  assert.ok(readme.includes('dsh plugin --profile web add @cerbur/clutch-dsh-title'));
  assert.ok(readmeZh.includes('dsh plugin --profile web add @cerbur/clutch-dsh-title'));
  const localPath = '/absolute/path/to/clutch-dsh/packages/clutch-dsh-title';
  assert.ok(readme.includes('dsh plugin --profile web add ' + localPath));
  assert.ok(readmeZh.includes('dsh plugin --profile web add ' + localPath));
  assert.ok(readme.includes('pnpm --filter @cerbur/clutch-dsh-title build'));
  assert.ok(readmeZh.includes('pnpm --filter @cerbur/clutch-dsh-title build'));
  const sourceInstall = 'pnpm dsh plugin --profile web add ' + localPath;
  assert.ok(readme.includes(sourceInstall));
  assert.ok(readmeZh.includes(sourceInstall));
  assert.ok(readme.includes('>=0.1.2-rc.1'));
  assert.ok(readmeZh.includes('>=0.1.2-rc.1'));
  assert.ok(!/0\.1\.3/.test(readme));
  assert.ok(!/0\.1\.3/.test(readmeZh));

  const requiredKeys = [
    ['template', 'template'],
    ['fields', 'fields'],
    ['daytime', 'daytime'],
    ['desc', 'desc'],
    ['kind', 'kind'],
    ['source', 'source'],
    ['instruction', 'instruction'],
    ['maxCharacters', 'maxCharacters'],
    ['format', 'format'],
    ['timezone', 'timezone'],
    ['datetime', 'datetime'],
    ['literal', 'literal'],
    ['llm-enum', 'llm-enum'],
    ['llm-text', 'llm-text'],
    ['settings.yaml', 'settings.yaml'],
    ['clutch-dsh-title', 'clutch-dsh-title'],
    ['session.createdAt', 'session.createdAt'],
    ['generation', '生成'],
    ['default', 'default'],
    ['emoji', 'emoji'],
  ];
  for (const [englishKey, chineseKey] of requiredKeys) {
    assert.ok(readme.includes(englishKey), 'English README is missing ' + englishKey);
    assert.ok(readmeZh.includes(chineseKey), 'Chinese README is missing ' + chineseKey);
  }
  for (const [englishPattern, chinesePattern] of [
    [/input\s+tokens/i, /输入\s+Token/],
    [/output\s+tokens/i, /输出\s+Token/],
    [/total\s+tokens/i, /总\s+Token/],
  ]) {
    assert.match(readme, englishPattern);
    assert.match(readmeZh, chinesePattern);
  }

  const codeFence = String.fromCharCode(96).repeat(3);
  const yamlStart = readme.indexOf(codeFence + 'yaml');
  const yamlEnd = readme.indexOf(codeFence, yamlStart + codeFence.length + 'yaml'.length);
  const yamlStartZh = readmeZh.indexOf(codeFence + 'yaml');
  const yamlEndZh = readmeZh.indexOf(codeFence, yamlStartZh + codeFence.length + 'yaml'.length);
  assert.notEqual(yamlStart, -1);
  assert.notEqual(yamlStartZh, -1);
  assert.equal(readme.slice(yamlStart, yamlEnd), readmeZh.slice(yamlStartZh, yamlEndZh));
});
