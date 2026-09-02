import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const packageDirectory = path.resolve(import.meta.dirname, '..');

test('manifest describes the atomic discuss plugin and publishes runtime resources', async () => {
  const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));

  assert.equal(manifest.name, '@cerbur/clutch-dsh-discuss');
  assert.equal(manifest.version, '0.0.1-alpha');
  assert.equal(manifest.type, 'module');
  assert.deepEqual(manifest.files, ['lib', 'cordis.patch.yml', 'skills', 'assets']);
  assert.equal(manifest.exports['.'].import, './lib/index.js');
  assert.equal(manifest.exports['.'].types, './lib/index.d.ts');
  assert.equal(manifest.exports['./package.json'], './package.json');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.deepEqual(manifest.clutchDsh, {
    plugin: '@cerbur/clutch-dsh-discuss',
    role: 'plugin',
    serviceDefinition: '@cerbur/clutch-dsh-discuss',
  });
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '4.0.1');
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-commands'], '>=0.1.1-rc.2 <0.2.0-0');
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-llm'], '>=0.1.1-rc.2 <0.2.0-0');
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-skill'], '>=0.1.0-rc.8 <0.2.0-0');
});

test('Cordis patch inserts the discuss plugin into the DSH bundle', async () => {
  const patch = parse(await readFile(path.join(packageDirectory, 'cordis.patch.yml'), 'utf8'));

  assert.deepEqual(patch, [
    {
      insert: [
        {
          id: 'clutch-dsh-discuss',
          name: '@cerbur/clutch-dsh-discuss',
        },
      ],
    },
  ]);
});

test('documents the four required sections and ships the skill resources', async () => {
  const readme = await readFile(path.join(packageDirectory, 'README.md'), 'utf8');
  const readmeZh = await readFile(path.join(packageDirectory, 'README.zh.md'), 'utf8');
  const skill = await readFile(
    path.join(packageDirectory, 'skills/brainstorming/SKILL.md'),
    'utf8',
  );

  assert.ok(readme.indexOf('## Feature introduction') < readme.indexOf('## Capabilities'));
  assert.ok(readme.indexOf('## Capabilities') < readme.indexOf('## Installation'));
  assert.ok(readme.indexOf('## Installation') < readme.indexOf('## Detailed usage'));
  assert.ok(readmeZh.indexOf('## 功能介绍') < readmeZh.indexOf('## 能力'));
  assert.ok(readmeZh.indexOf('## 能力') < readmeZh.indexOf('## 安装'));
  assert.ok(readmeZh.indexOf('## 安装') < readmeZh.indexOf('## 详细使用'));
  assert.match(readme, /assets\/screenshots\/discuss-mvp\.svg/u);
  assert.match(readmeZh, /assets\/screenshots\/discuss-mvp\.svg/u);
  assert.match(readme, /dsh plugin --profile web add @cerbur\/clutch-dsh-discuss/u);
  assert.match(readmeZh, /dsh plugin --profile web add @cerbur\/clutch-dsh-discuss/u);
  assert.match(skill, /docs\/clutch\/specs\//u);
  assert.doesNotMatch(skill, /docs\/superpowers\/specs\/YYYY-MM-DD-<topic>-design\.md/u);
});
