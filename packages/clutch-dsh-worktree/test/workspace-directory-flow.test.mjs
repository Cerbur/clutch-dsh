import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import ts from 'typescript';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import * as stores from '@deepseek-ai/dsh-client-store';

const source = await readFile(new URL('../src/client/view/workspace-directory-flow.ts', import.meta.url), 'utf8');
const exports = {};
new Function('require', 'exports', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)((name) => {
  assert.equal(name, '@deepseek-ai/dsh-client-store');
  return stores;
}, exports);
const { createWorkspaceDirectoryFlow } = exports;
const nativeSlot = 'sidebar.workspaces.directoryFlow';
const privateSlot = 'clutch.worktree.directoryFlow';

function fixture(adopt = async () => {}) {
  const slots = new SlotCore();
  const root = slots.register({ name: 'root', children: {
    [nativeSlot]: { kind: 'single', scope: 'root' },
    [privateSlot]: { kind: 'single', scope: 'root' },
  } }, () => null);
  // This test declares both slots first; production uses declaration-aware injection.
  slots.inject = (_key, callback) => callback();
  const flow = createWorkspaceDirectoryFlow(slots, adopt);
  const injected = { listDirectory: async () => ['/tmp/from-browse'], t: (key) => key };
  const picker = (props) => props;
  const install = () => slots.register({ name: nativeSlot, inject: () => injected }, picker);
  return { slots, flow, injected, picker, install, dispose: () => { flow.dispose(); root(); } };
}

test('mirrors the composed browse picker and injected capability without taking native slot ownership', async () => {
  const paths = [];
  let complete;
  const f = fixture((path) => { paths.push(path); return new Promise((resolve) => { complete = resolve; }); });
  try {
    assert.equal(f.flow.store.getSnapshot().available, false);
    await f.flow.request();
    assert.deepEqual(paths, []);
    const remove = f.install();
    await Promise.resolve();
    const original = f.slots.entriesOfSlot(nativeSlot)[0];
    const mirrored = f.slots.entriesOfSlot(privateSlot)[0];
    assert.strictEqual(mirrored.component, f.picker);
    assert.strictEqual(mirrored.inject(), f.injected);
    assert.strictEqual(f.slots.entriesOfSlot(nativeSlot)[0], original);
    const action = f.flow.request();
    assert.strictEqual(f.flow.request(), action, 'double trigger shares one interaction');
    const owner = f.flow.store.getSnapshot().owner;
    const props = mirrored.component({ ...mirrored.inject(), ...owner });
    assert.equal(props.open, true);
    assert.deepEqual(paths, []);
    const [path] = await props.listDirectory();
    props.onPicked(path);
    props.onPicked('/tmp/duplicate');
    assert.equal(f.flow.store.getSnapshot().owner.busy, true);
    await Promise.resolve();
    assert.deepEqual(paths, ['/tmp/from-browse']);
    complete();
    await action;
    assert.equal(f.flow.store.getSnapshot().owner.open, false);
    remove();
    await Promise.resolve();
    assert.equal(f.flow.store.getSnapshot().available, false);
    assert.equal(f.slots.entriesOfSlot(privateSlot).length, 0);
  } finally { f.dispose(); }
});

test('cancellation, picker failure and adoption failure settle and allow retry', async () => {
  let shouldFail = true;
  const paths = [];
  const f = fixture(async (path) => { paths.push(path); if (shouldFail) throw new Error('adoption denied'); });
  try {
    f.install();
    await Promise.resolve();
    let action = f.flow.request();
    const cancelled = f.flow.store.getSnapshot().owner;
    cancelled.onCancel();
    await action;
    cancelled.onPicked('/tmp/stale-cancel');
    assert.deepEqual(paths, []);
    action = f.flow.request();
    const rejected = assert.rejects(action, /picker denied/);
    f.flow.store.getSnapshot().owner.onError('picker denied');
    await rejected;
    action = f.flow.request();
    const adoptionRejected = assert.rejects(action, /adoption denied/);
    f.flow.store.getSnapshot().owner.onPicked('/tmp/denied');
    await adoptionRejected;
    assert.equal(f.flow.store.getSnapshot().owner.busy, false);
    shouldFail = false;
    action = f.flow.request();
    f.flow.store.getSnapshot().owner.onPicked('/tmp/retry');
    await action;
    assert.deepEqual(paths, ['/tmp/denied', '/tmp/retry']);
  } finally { f.dispose(); }
});

test('picker replacement, mode exit and disposal discard late outcomes', async () => {
  const paths = [];
  const f = fixture(async (path) => { paths.push(path); });
  try {
    let remove = f.install();
    await Promise.resolve();
    let action = f.flow.request();
    const withdrawn = f.flow.store.getSnapshot().owner;
    remove();
    await action;
    remove = f.install();
    await Promise.resolve();
    action = f.flow.request();
    withdrawn.onPicked('/tmp/withdrawn');
    withdrawn.onError('stale error');
    assert.equal(f.flow.store.getSnapshot().owner.open, true);
    const exited = f.flow.store.getSnapshot().owner;
    f.flow.cancel();
    await action;
    exited.onPicked('/tmp/exited');
    action = f.flow.request();
    const disposed = f.flow.store.getSnapshot().owner;
    f.flow.dispose();
    await action;
    disposed.onPicked('/tmp/disposed');
    await Promise.resolve();
    assert.deepEqual(paths, []);
    assert.equal(f.slots.entriesOfSlot(privateSlot).length, 0);
    assert.equal(f.slots.entriesOfSlot(nativeSlot).length, 1, 'native registration survives plugin disposal');
    remove();
  } finally { f.dispose(); }
});
