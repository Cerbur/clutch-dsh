import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorktreeFullAccessConfirmationController,
  worktreeFullAccessConfirmationMessage,
} from '../lib/client/worktree-permission.js';

const input = {
  workspaceId: 'workspace-one',
  worktreeId: 'worktree-one',
  sessionId: 'session-one',
  cwd: '/tmp/worktree-one',
};

test('explains the Worktree-specific reason for Full Access and keeps approval enabled', () => {
  const message = worktreeFullAccessConfirmationMessage(input, 'en-US');

  assert.match(message, /Git metadata/i);
  assert.match(message, /Full Access/i);
  assert.match(message, /approval prompts remain enabled/i);
  assert.match(message, /network and process policy is unchanged/i);
  assert.match(message, /worktree-one/);
});

test('exposes one Worktree Full Access request as observable dialog state', async () => {
  const controller = createWorktreeFullAccessConfirmationController();
  const updates = [];
  const unsubscribe = controller.subscribe(() => {
    updates.push(controller.getSnapshot()?.sessionId ?? null);
  });

  const pending = controller.request(input);

  assert.deepEqual(controller.getSnapshot(), input);
  assert.deepEqual(updates, ['session-one']);
  controller.resolve(true);
  assert.equal(await pending, true);
  assert.equal(controller.getSnapshot(), undefined);
  assert.deepEqual(updates, ['session-one', null]);

  unsubscribe();
  controller.dispose();
});

test('queues concurrent confirmations and fails them closed on disposal', async () => {
  const controller = createWorktreeFullAccessConfirmationController();
  const secondInput = { ...input, sessionId: 'session-two' };
  const first = controller.request(input);
  const second = controller.request(secondInput);

  assert.equal(controller.getSnapshot()?.sessionId, 'session-one');
  controller.resolve(false);
  assert.equal(await first, false);
  assert.equal(controller.getSnapshot()?.sessionId, 'session-two');

  controller.dispose();
  assert.equal(await second, false);
  assert.equal(controller.getSnapshot(), undefined);
});

test('provides a Chinese confirmation reason when the DSH locale is Chinese', () => {
  const message = worktreeFullAccessConfirmationMessage(input, 'zh-CN');

  assert.match(message, /Git 元数据/);
  assert.match(message, /完全访问/);
  assert.match(message, /保留审批提示/);
});
