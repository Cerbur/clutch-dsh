import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorktreeToolSettings } from '../lib/host/tool-settings.js';
import { WORKTREE_TOOL_IDS } from '../lib/contract/tool-settings.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'clutch-tool-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: new WorktreeToolSettings(root) };
}
const general = { kind: 'general' };
const local = { kind: 'local', workspaceId: 'ws/one' };
const worktree = { kind: 'worktree', workspaceId: 'ws/one', worktreeId: 'wt/one' };

test('preferences persist separately from relations and isolate Workspace/Worktree identities', async (t) => {
  const { root, store } = await fixture(t);
  const initial = await store.read(general);
  assert.equal(initial.enabled, false);
  const chosen = { enabled: true, tools: WORKTREE_TOOL_IDS.slice(1, 4) };
  await store.update(general, chosen, initial);
  await store.update(
    worktree,
    { enabled: true, tools: [WORKTREE_TOOL_IDS[0]] },
    await store.read(worktree),
  );
  const localSelection = { enabled: true, tools: [WORKTREE_TOOL_IDS[4]] };
  await store.update(local, localSelection, await store.read(local));
  const restarted = new WorktreeToolSettings(root);
  assert.deepEqual(await restarted.read(general), chosen);
  assert.deepEqual((await restarted.read(worktree)).tools, [WORKTREE_TOOL_IDS[0]]);
  assert.deepEqual(await restarted.read(local), localSelection);
  assert.equal((await restarted.read({ ...local, workspaceId: 'ws/two' })).enabled, false);
  assert.equal((await store.read({ ...worktree, workspaceId: 'ws/two' })).enabled, false);
  assert.equal((await store.read({ ...worktree, worktreeId: 'wt/two' })).enabled, false);
  assert.deepEqual(await readdir(path.join(root, 'clutch-dsh-worktree')), ['tool-settings']);
  const directory = path.join(root, 'clutch-dsh-worktree', 'tool-settings');
  assert.deepEqual((await readdir(directory)).sort(), ['general.json', 'locals', 'worktrees']);
  assert.deepEqual(await readdir(path.join(directory, 'locals')), ['ws-ws%2Fone.json']);
  const empty = await store.update(general, { enabled: true, tools: [] }, chosen);
  assert.deepEqual(empty, { enabled: false, tools: [] });
});

test('concurrent changes reject stale expected selections and leave a valid published file', async (t) => {
  const { root, store } = await fixture(t);
  const expected = await store.read(general);
  const selected = { enabled: true, tools: [WORKTREE_TOOL_IDS[0]] };
  const changes = await Promise.allSettled([
    store.update(general, selected, expected),
    store.update(general, { enabled: true, tools: [WORKTREE_TOOL_IDS[1]] }, expected),
  ]);
  assert.equal(changes[0].status, 'fulfilled');
  assert.equal(changes[1].status, 'rejected');
  assert.match(changes[1].reason.message, /changed elsewhere/);
  const directory = path.join(root, 'clutch-dsh-worktree', 'tool-settings');
  assert.deepEqual(await readdir(directory), ['general.json']);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, 'general.json'), 'utf8')).selection,
    selected,
  );
});

test('invalid preferences fail closed without overwriting the damaged file', async (t) => {
  const { root, store } = await fixture(t);
  const directory = path.join(root, 'clutch-dsh-worktree', 'tool-settings');
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'general.json');
  await writeFile(filename, '{broken');
  await assert.rejects(store.read(general));
  await assert.rejects(
    store.update(general, { enabled: true, tools: [] }, { enabled: false, tools: [] }),
  );
  assert.equal(await readFile(filename, 'utf8'), '{broken');
});
