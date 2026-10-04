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

test('keeps checkout files outside Session cwd absolute and Session-scoped', () => {
  assert.equal(
    buildSessionFileAddress('sess-1', 'README #1.md', '/tmp/checkout', '/tmp/checkout/packages/nested'),
    'dsh-resource://file/session/sess-1//tmp/checkout/README%20%231.md',
  );
  assert.equal(
    buildSessionFileAddress('sess-1', 'packages/nested-other/index.ts', '/tmp/checkout', '/tmp/checkout/packages/nested'),
    'dsh-resource://file/session/sess-1//tmp/checkout/packages/nested-other/index.ts',
  );
});

test('uses the original cwd for an already-bound Git-root Session', () => {
  assert.equal(
    buildSessionFileAddress('sess-1', 'packages/nested/src/index.ts', '/tmp/checkout', '/tmp/checkout'),
    'dsh-resource://file/session/sess-1/packages/nested/src/index.ts',
  );
});

test('falls back to an absolute address when Session cwd is unknown', () => {
  assert.equal(
    buildSessionFileAddress('sess-1', 'packages/nested/src/index.ts', '/tmp/checkout'),
    'dsh-resource://file/session/sess-1//tmp/checkout/packages/nested/src/index.ts',
  );
});
