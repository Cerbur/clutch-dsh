import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import ts from 'typescript';
import { en, zh } from '../lib/client/locales.js';
import { RestartNotice } from '../lib/client/restart-notice.js';

import {
  createWorktreeFullAccessConfirmationController,
  worktreeFullAccessConfirmationMessage,
} from '../lib/client/permission/worktree-permission.js';

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

test('equivalent pending confirmations share one dialog and one result', async () => {
  const controller = createWorktreeFullAccessConfirmationController();
  const first = controller.request(input);
  const duplicate = controller.request({ ...input });
  assert.equal(first, duplicate);
  controller.resolve(true);
  assert.deepEqual(await Promise.all([first, duplicate]), [true, true]);
  assert.equal(controller.getSnapshot(), undefined);
  const retry = controller.request(input);
  assert.notEqual(retry, first, 'completed confirmation must not be cached');
  controller.dispose();
  assert.equal(await retry, false);
});

test('different target paths never share consent even for the same Session', async () => {
  const controller = createWorktreeFullAccessConfirmationController();
  const first = controller.request(input);
  const moved = controller.request({ ...input, cwd: '/tmp/other' });
  controller.resolve(true);
  assert.equal(await first, true);
  assert.equal(controller.getSnapshot().cwd, '/tmp/other');
  controller.dispose();
  assert.equal(await moved, false);
});

test('production dialog retains the native checkbox contract and explains Custom in both locales', async () => {
  const source = await readFile(new URL('../lib/client/surface/components/AccessConfirmation.js', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const jsx = (type, props) => ({ type, props });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@deepseek-ai/dsh-client-ui-primitives': { RiskConfirmation: 'native-RiskConfirmation' },
  };
  const exports = {};
  new Function('require', 'exports', compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), name);
    return modules[name];
  }, exports);
  for (const dictionary of [en, zh]) {
    const controller = createWorktreeFullAccessConfirmationController();
    const pending = controller.request(input);
    let acknowledged = false;
    const render = () => exports.AccessConfirmation({
      source: {
        fullAccessConfirmationSnapshot: controller.getSnapshot(),
        fullAccessAcknowledged: acknowledged,
        setFullAccessAcknowledged: value => { acknowledged = value; },
      },
      props: { t: key => dictionary[key], fullAccessConfirmation: controller },
    }).props.children;
    const dialog = render();
    assert.equal(dialog.type, 'native-RiskConfirmation');
    assert.equal(dialog.props.open, true);
    assert.equal(dialog.props.acknowledged, false);
    assert.ok(dialog.props.acknowledgeLabel);
    assert.match(dialog.props.description, /Custom/);
    dialog.props.onAcknowledgedChange(true);
    assert.equal(render().props.acknowledged, true);
    render().props.onConfirm();
    assert.equal(await pending, true);
    assert.equal(acknowledged, false);
    controller.dispose();
  }
});

test('successful Custom policy result does not request a preset restart', () => {
  const notice = new RestartNotice(async () => ({ ok: true }));
  notice.reportPermissionResult({
    status: 'full-applied', preset: 'custom', sandboxMode: 'danger-full-access', approvalPolicy: 'ask', retryable: false,
  });
  assert.equal(notice.getSnapshot(), false);
  notice.dispose();
});
