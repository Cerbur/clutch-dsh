import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const readmeZh = await readFile(path.join(root, 'README.zh.md'), 'utf8');

test('English and Chinese README files keep the public documentation contract aligned', async () => {
  const requiredEnglish = [
    '## Feature overview',
    '## Capabilities',
    '## Installation',
    '### npm registry',
    '### Source checkout',
    '## Usage',
  ];
  const requiredChinese = [
    '## 功能介绍',
    '## 能力',
    '## 安装',
    '### npm registry',
    '### 源码 checkout',
    '## 详细使用',
  ];

  for (const heading of requiredEnglish) assert.notEqual(readme.indexOf(heading), -1);
  for (const heading of requiredChinese) assert.notEqual(readmeZh.indexOf(heading), -1);
  assert.ok(readme.indexOf('## Feature overview') < readme.indexOf('## Capabilities'));
  assert.ok(readme.indexOf('## Capabilities') < readme.indexOf('## Installation'));
  assert.ok(readme.indexOf('## Installation') < readme.indexOf('## Usage'));
  assert.ok(readme.includes('assets/screenshots/title-default.svg'));
  assert.ok(readmeZh.includes('assets/screenshots/title-default.svg'));
  assert.ok(readme.includes('dsh plugin --profile web add @cerbur/clutch-dsh-title'));
  assert.ok(readmeZh.includes('dsh plugin --profile web add @cerbur/clutch-dsh-title'));
  assert.ok(
    readme.includes(
      'dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title',
    ),
  );
  assert.ok(
    readmeZh.includes(
      'dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-title',
    ),
  );
  assert.ok(readme.includes('>=0.1.2-rc.1'));
  assert.ok(readmeZh.includes('>=0.1.2-rc.1'));
  assert.ok(!/0\.1\.0/.test(readme));
  assert.ok(!/0\.1\.0/.test(readmeZh));

  const requiredKeys = [
    'preset',
    'template',
    'fields',
    'daytime',
    'type',
    'desc',
    'kind',
    'instruction',
    'values',
    'maxCharacters',
    'format',
    'timezone',
  ];
  for (const key of requiredKeys) {
    assert.ok(readme.includes(key), `English README is missing ${key}`);
    assert.ok(readmeZh.includes(key), `Chinese README is missing ${key}`);
  }

  const yamlStart = readme.indexOf('```yaml');
  const yamlEnd = readme.indexOf('```', yamlStart + 7);
  const yamlStartZh = readmeZh.indexOf('```yaml');
  const yamlEndZh = readmeZh.indexOf('```', yamlStartZh + 7);
  assert.notEqual(yamlStart, -1);
  assert.notEqual(yamlStartZh, -1);
  assert.equal(readme.slice(yamlStart, yamlEnd), readmeZh.slice(yamlStartZh, yamlEndZh));
});
