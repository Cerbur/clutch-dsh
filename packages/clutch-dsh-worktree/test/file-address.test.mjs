import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionFileAddress } from '../lib/client/dashboard/git/file-address.js';

test('builds canonical session file resource address', () => {
  assert.equal(
    buildSessionFileAddress('sess-1', 'src/client/index.ts'),
    'dsh-resource://file/session/sess-1/src/client/index.ts',
  );
});

test('handles special characters and spaces with proper URI component encoding', () => {
  assert.equal(
    buildSessionFileAddress('sess 1', 'src/hello world#1.ts'),
    'dsh-resource://file/session/sess%201/src/hello%20world%231.ts',
  );
});

test('normalizes leading dot-slash and backslashes', () => {
  assert.equal(
    buildSessionFileAddress('sess-1', '.\\src\\index.ts'),
    'dsh-resource://file/session/sess-1/src/index.ts',
  );
});

test('keeps files inside a nested Session cwd relative to that directory', () => {
  assert.equal(
    buildSessionFileAddress('sess-1', 'packages/nested/src/index.ts', '/tmp/checkout', '/tmp/checkout/packages/nested'),
    'dsh-resource://file/session/sess-1/src/index.ts',
  );
  assert.equal(
    buildSessionFileAddress('sess-1', 'packages/nested/src/index.ts', 'C:\\worktrees\\topic', 'C:\\worktrees\\topic\\packages\\nested'),
    'dsh-resource://file/session/sess-1/src/index.ts',
  );
});

test('rejects checkout files outside Session cwd including sibling prefix collisions', () => {
  assert.throws(
    () => buildSessionFileAddress('sess-1', 'README #1.md', '/tmp/checkout', '/tmp/checkout/packages/nested'),
    { code: 'GIT_FILE_OUTSIDE_SESSION' },
  );
  assert.throws(
    () => buildSessionFileAddress('sess-1', 'packages/nested-other/index.ts', '/tmp/checkout', '/tmp/checkout/packages/nested'),
    { code: 'GIT_FILE_OUTSIDE_SESSION' },
  );
});

test('uses the original cwd for an already-bound Git-root Session', () => {
  assert.equal(
    buildSessionFileAddress('sess-1', 'packages/nested/src/index.ts', '/tmp/checkout', '/tmp/checkout'),
    'dsh-resource://file/session/sess-1/packages/nested/src/index.ts',
  );
});

test('uses the checkout root when Session cwd is unknown', () => {
  assert.equal(
    buildSessionFileAddress('sess-1', 'packages/nested/src/index.ts', '/tmp/checkout'),
    'dsh-resource://file/session/sess-1/packages/nested/src/index.ts',
  );
});

test('supports filesystem-root checkouts and Sessions', () => {
  for (const root of ['/', 'C:/', 'C:\\']) {
    assert.equal(buildSessionFileAddress('s', 'src/index.ts', root, root),
      'dsh-resource://file/session/s/src/index.ts');
  }
});

test('supports Windows case, extended drive and UNC spellings', () => {
  for (const [root, cwd] of [
    [String.raw`C:\Repo`, String.raw`\\?\c:\repo\packages\nested`],
    [String.raw`\\server\share\repo`, String.raw`\\?\UNC\SERVER\SHARE\repo\packages\nested`],
  ]) {
    assert.equal(buildSessionFileAddress('s', 'packages/nested/hello #1.ts', root, cwd),
      'dsh-resource://file/session/s/hello%20%231.ts');
  }
});

test('rejects absolute paths, traversal and malformed Git paths', () => {
  for (const value of ['../secret', 'src/../../secret', '/etc/passwd', 'C:/secret', 'src/./file', '', 'a\0b']) {
    assert.throws(() => buildSessionFileAddress('s', value, '/repo', '/repo'),
      { code: 'GIT_FILE_OUTSIDE_SESSION' });
  }
});
