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

test('anchors repository-relative Git paths at the checkout root for a nested Session cwd', () => {
  assert.equal(
    buildSessionFileAddress('sess-1', 'packages/nested/src/index.ts', '/tmp/checkout'),
    'dsh-resource://file/session/sess-1//tmp/checkout/packages/nested/src/index.ts',
  );
  assert.equal(
    buildSessionFileAddress('sess-1', 'packages/nested/src/index.ts', 'C:\\worktrees\\topic'),
    'dsh-resource://file/session/sess-1/C:/worktrees/topic/packages/nested/src/index.ts',
  );
});
