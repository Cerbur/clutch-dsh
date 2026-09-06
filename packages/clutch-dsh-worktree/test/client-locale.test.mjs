import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKTREE_NS,
  en,
  zh,
} from '../lib/client/locales.js';

test('exports the Worktree namespace and balanced zh/en dictionaries', () => {
  assert.equal(WORKTREE_NS, 'worktree');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  assert.ok(Object.keys(zh).length >= 60);
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(typeof value, 'string', 'zh.' + key + ' must be a string');
    assert.ok(value.length > 0, 'zh.' + key + ' must not be empty');
    assert.equal(typeof en[key], 'string', 'en.' + key + ' must be a string');
    assert.ok(en[key].length > 0, 'en.' + key + ' must not be empty');
  }
});

test('keeps parameter placeholders in the translated templates', () => {
  assert.match(zh['workspace.options'], /\{name\}/);
  assert.match(en['workspace.options'], /\{name\}/);
  assert.match(zh['session.expandMore'], /\{count\}/);
  assert.match(en['session.expandMore'], /\{count\}/);
  assert.match(zh['error.sessionBindingFailed'], /\{sessionId\}/);
  assert.match(zh['error.sessionBindingFailed'], /\{reason\}/);
  assert.match(en['error.sessionBindingFailed'], /\{sessionId\}/);
  assert.match(en['error.sessionBindingFailed'], /\{reason\}/);
});

test('uses localized Local copy with the current branch', () => {
  assert.equal(zh['worktree.main'], '本地');
  assert.equal(en['worktree.main'], 'Local');
  assert.equal(zh['worktree.mainWithBranch'], '本地（{branch}）');
  assert.equal(en['worktree.mainWithBranch'], 'Local ({branch})');
});

test('localizes the unavailable Worktree ordering error', () => {
  assert.equal(
    zh['error.worktreeOrderingUnavailable'],
    'Worktree 排序不可用，请重新连接后重试。',
  );
  assert.equal(
    en['error.worktreeOrderingUnavailable'],
    'Worktree ordering is unavailable; retry after reconnecting.',
  );
});

test('uses native-compatible blank Session labels', () => {
  assert.equal(zh['session.new'], '新会话');
  assert.equal(en['session.new'], 'New Session');
});

test('localizes the external Worktree import and removal warning', () => {
  for (const key of [
    'worktree.tabCreate',
    'worktree.tabImport',
    'worktree.importDescription',
    'worktree.importLoading',
    'worktree.importEmpty',
    'worktree.importPlaceholder',
    'worktree.importSelected',
    'worktree.import',
    'worktree.removeExternalDescription',
    'error.worktreeImportInvalid',
    'error.worktreeAlreadyManaged',
    'error.worktreeRegistrationSessionUnavailable',
  ]) {
    assert.ok(zh[key].length > 0, `zh.${key} must be present`);
    assert.ok(en[key].length > 0, `en.${key} must be present`);
  }
});
test('cleanup confirmation explains user-owned activity checks and deletion risks in both languages', () => {
  assert.match(zh['worktree.cleanDiskDescription'], /插件不会检查 Session 或子代理/);
  assert.match(zh['worktree.cleanDiskDescription'], /请自行确认.*任务均已停止/);
  assert.match(zh['worktree.cleanDiskDescription'], /任务失败或数据丢失/);
  assert.match(en['worktree.cleanDiskDescription'], /plugin does not check.*Sessions or subagents/);
  assert.match(en['worktree.cleanDiskDescription'], /Confirm that all tasks.*have stopped/);
  assert.match(en['worktree.cleanDiskDescription'], /task failures or data loss/);
  for (const dictionary of [en, zh]) {
    assert.match(dictionary['worktree.cleanDiskDescription'], /\{path\}/);
  }
});
test('completed cleanup copy accounts for absent Git metadata and preserved files', () => {
  assert.equal(zh['worktree.cleaned'], 'Worktree 已移除');
  assert.equal(en['worktree.cleaned'], 'Worktree removed');
  assert.match(zh['worktree.cleanDiskDescription'], /目录或 \.git 已不存在.*剩余文件不会删除/);
  assert.match(en['worktree.cleanDiskDescription'], /directory or \.git is already absent.*remaining files are not deleted/);
});
