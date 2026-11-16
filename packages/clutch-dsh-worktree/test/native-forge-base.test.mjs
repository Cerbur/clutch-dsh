import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeForgeBaseBridge, syncNativeForgeBase } from '../lib/client/dashboard/git/native-forge-base.js';

function fixture(options = {}) {
  const events = [];
  const based = () => {};
  const scoped = () => {};
  const f = {
    entry: { options: { key: '@deepseek-ai/dsh-experimental-client-ui-forge/changes' },
      store: { create: () => assert.fail('must not create another store'), spec: { actions: { based, scoped } } } },
    tab: { id: 'tab', kind: 'forge-changes', contentId: 'dsh-resource://forge-changes/s/local' },
    live: true, events, releases: 0,
  };
  const slots = {
    entriesOfSlot: () => f.entry ? [f.entry] : [],
    subscribe: (_slot, fn) => { f.changed = fn; return () => { f.changed = undefined; }; },
    register: (options) => {
      assert.equal(options.store, f.entry.store);
      assert.equal(options.name, 'conversation.input.right');
      f.publish = options.inject().publish;
      return () => { f.releases++; };
    },
  };
  f.bridge = createNativeForgeBaseBridge({ slots, activeTab: () => f.tab, timeoutMs: 30, pollMs: 1, ...options });
  f.controller = new globalThis.AbortController();
  f.sync = (extra = {}) => f.bridge.sync({ sessionId: 's', address: f.tab.contentId,
    baseBranch: 'refs/heads/qa/compare', signal: f.controller.signal, isCurrent: () => f.live, ...extra });
  f.state = { byTab: { tab: { scope: 'uncommitted', base: null, commits: ['old'], navigated: 1 } } };
  f.actions = {
    scoped: (id, scope) => { events.push(['scoped', id, scope]); f.state.byTab[id].scope = scope; f.state.byTab[id].commits = null; },
    based: (id, base) => { events.push(['based', id, base]); f.state.byTab[id].base = base; f.state.byTab[id].commits = null; },
  };
  f.publishFace = (session = 's') => f.publish(session, { state: f.state, actions: f.actions });
  return f;
}

test('a new Worktree short main baseline replaces Forge automatic origin/main with the Host-resolved local ref', async () => {
  const f = fixture();
  f.state.byTab.tab.base = { ref: 'refs/remotes/origin/main', name: 'origin/main' };
  f.publishFace();
  const reads = [];
  try {
    const result = await syncNativeForgeBase(f.bridge, {
      listBranches: async (input) => {
        reads.push(input);
        return [{ name: 'main', kind: 'local', ref: 'refs/heads/main' },
          { name: 'origin/main', kind: 'remote', ref: 'refs/remotes/origin/main' }];
      },
    }, { workspaceId: 'w', worktreeId: 'wt', sessionId: 's', address: f.tab.contentId,
      baseBranch: 'main', signal: f.controller.signal, isCurrent: () => f.live });
    assert.equal(result, 'synced');
    assert.deepEqual(f.state.byTab.tab.base, { ref: 'refs/heads/main', name: 'main' });
    assert.deepEqual(reads, [{ workspaceId: 'w' }]);
  } finally { f.bridge.dispose(); }
});

test('canonical refs and explicit None never trigger a resolution read or a saved-Base fallback', async () => {
  const f = fixture();
  f.publishFace();
  const manager = { listBranches: async () => assert.fail('canonical/None needs no read') };
  const input = { workspaceId: 'w', worktreeId: 'main:w', sessionId: 's', address: f.tab.contentId,
    signal: f.controller.signal, isCurrent: () => f.live };
  try {
    assert.equal(await syncNativeForgeBase(f.bridge, manager, { ...input, baseBranch: 'refs/remotes/origin/main' }), 'synced');
    assert.equal(f.state.byTab.tab.base.ref, 'refs/remotes/origin/main');
    f.events.length = 0;
    assert.equal(await syncNativeForgeBase(f.bridge, manager, input), 'no-base');
    assert.deepEqual(f.events, []);
  } finally { f.bridge.dispose(); }
});

for (const mode of ['remote', 'ambiguous', 'legacy', 'unavailable', 'error', 'abort', 'selection', 'timeout']) {
  test('short Base resolution handles ' + mode + ' without guessing or late writes', async () => {
    const f = fixture();
    f.publishFace();
    let resolve;
    const pending = syncNativeForgeBase(f.bridge, {
      listBranches: () => mode === 'error' ? Promise.reject(new Error('read failed'))
        : new Promise((done) => { resolve = done; }),
    }, { workspaceId: 'w', worktreeId: 'wt', sessionId: 's', address: f.tab.contentId,
      baseBranch: 'origin/main', signal: f.controller.signal, isCurrent: () => f.live }, 5);
    try {
      if (mode === 'abort') f.controller.abort();
      if (mode === 'selection') f.live = false;
      const branches = mode === 'unavailable' ? [] : mode === 'legacy' ? [{ name: 'origin/main' }]
        : [{ name: 'origin/main', kind: 'remote', ref: 'refs/remotes/origin/main' }];
      if (mode === 'ambiguous') branches.push({ name: 'origin/main', kind: 'local', ref: 'refs/heads/origin/main' });
      if (mode !== 'timeout') resolve?.(branches);
      const expected = { remote: 'synced', ambiguous: 'unsupported', legacy: 'no-base',
        unavailable: 'no-base', error: 'unsupported', abort: 'stale', selection: 'stale', timeout: 'timeout' }[mode];
      assert.equal(await pending, expected);
      if (mode === 'timeout') { resolve(branches); await Promise.resolve(); }
      if (mode === 'remote') assert.equal(f.state.byTab.tab.base.ref, 'refs/remotes/origin/main');
      else assert.deepEqual(f.events, []);
    } finally { f.bridge.dispose(); }
  });
}

for (const elapsed of [5, 30]) {
  test('short Base resolution rejects a result at elapsed ' + elapsed + 'ms before the timeout callback runs', async (t) => {
    let now = 100;
    t.mock.method(Date, 'now', () => now);
    const f = fixture();
    f.publishFace();
    let resolve;
    try {
      const pending = syncNativeForgeBase(f.bridge, {
        listBranches: () => new Promise((done) => { resolve = done; }),
      }, { workspaceId: 'w', worktreeId: 'wt', sessionId: 's', address: f.tab.contentId,
        baseBranch: 'main', signal: f.controller.signal, isCurrent: () => f.live }, 5);
      // Advance wall time without yielding to timers, as in a busy browser.
      now += elapsed;
      resolve([{ name: 'main', kind: 'local', ref: 'refs/heads/main' }]);
      assert.equal(await pending, 'timeout');
      assert.deepEqual(f.events, []);
      assert.equal(f.state.byTab.tab.base, null);
    } finally { f.bridge.dispose(); }
  });
}

test('shares the declared handle, applies exact Base once per click and preserves later native choices', async () => {
  const f = fixture();
  f.publishFace();
  assert.deepEqual(f.events, [], 'mount does not synchronize');
  assert.equal(await f.sync(), 'synced');
  assert.deepEqual(f.events, [['scoped', 'tab', 'branch'],
    ['based', 'tab', { ref: 'refs/heads/qa/compare', name: 'qa/compare' }]]);
  assert.equal(f.state.byTab.tab.commits, null);
  f.state.byTab.tab.base = { ref: 'refs/heads/manual', name: 'manual' };
  f.publishFace();
  assert.equal(f.state.byTab.tab.base.name, 'manual', 'no ongoing synchronization');
  assert.equal(await f.sync({ baseBranch: 'refs/remotes/origin/main' }), 'synced');
  assert.equal(f.state.byTab.tab.base.name, 'origin/main');
  f.bridge.dispose();
  assert.equal(f.releases, 1);
});

test('waits for native bucket initialization without synthesizing navigation state', async () => {
  const f = fixture();
  const state = f.state;
  f.state = { byTab: {} };
  f.publishFace();
  const pending = f.sync();
  f.state = state;
  f.publishFace();
  assert.equal(await pending, 'synced');
  f.bridge.dispose();
});

test('a bucket published after the deadline cannot revive a delayed polling continuation', async (t) => {
  let now = 100;
  t.mock.method(Date, 'now', () => now);
  const f = fixture({ timeoutMs: 2 });
  const pending = f.sync();
  now = 125; // A suspended/busy browser resumes after the initialization budget.
  f.publishFace();
  assert.equal(await pending, 'timeout');
  assert.deepEqual(f.events, []);
  f.bridge.dispose();
});

for (const kind of ['session', 'tab', 'unload', 'abort', 'dispose']) {
  test('pending Base synchronization is retired by ' + kind, async () => {
    const f = fixture();
    const pending = f.sync();
    if (kind === 'session') f.live = false;
    if (kind === 'tab') f.tab = { ...f.tab, id: 'other' };
    if (kind === 'unload') f.entry = undefined; // Before the registry's batched notification.
    if (kind === 'abort') f.controller.abort();
    if (kind === 'dispose') f.bridge.dispose();
    f.publishFace();
    assert.equal(await pending, 'stale');
    assert.deepEqual(f.events, []);
    f.bridge.dispose();
  });
}

test('Forge reload releases old handle and never revives its pending request', async () => {
  const f = fixture();
  const pending = f.sync();
  const oldPublish = f.publish;
  f.entry = { ...f.entry, store: { ...f.entry.store } };
  f.changed();
  assert.equal(f.releases, 1);
  oldPublish('s', { state: f.state, actions: f.actions });
  f.publishFace();
  assert.equal(await pending, 'stale');
  assert.equal(await f.sync(), 'synced');
  f.bridge.dispose();
});

test('repeated Forge unload/reload releases every bridge and ignores late old-face cleanup', async () => {
  const f = fixture();
  for (let cycle = 0; cycle < 8; cycle++) {
    const original = f.entry;
    const oldPublish = f.publish;
    const oldCleanup = f.publishFace();
    f.entry = undefined;
    f.changed();
    assert.equal(f.releases, cycle + 1, 'unload releases the extra handle reference');
    f.entry = { ...original, store: { ...original.store } };
    f.changed();
    f.publishFace();
    oldCleanup();
    oldPublish('s', { state: f.state, actions: {
      scoped: () => assert.fail('retired handle must not receive writes'),
      based: () => assert.fail('retired handle must not receive writes'),
    } });
    assert.equal(await f.sync(), 'synced', 'late cleanup must not remove the replacement face');
  }
  f.bridge.dispose();
  assert.equal(f.releases, 9);
  assert.equal(f.changed, undefined, 'plugin disposal unregisters its registry subscription');
});

test('another Session face cannot initialize the current Session bucket', async () => {
  const f = fixture();
  f.publishFace('other');
  assert.equal(await f.sync(), 'timeout');
  assert.deepEqual(f.events, []);
  f.publishFace();
  assert.equal(await f.sync(), 'synced');
  f.bridge.dispose();
});

test('a newer click without a compatible Base still retires older pending synchronization', async () => {
  const f = fixture();
  const pending = f.sync();
  assert.equal(await f.sync({ baseBranch: undefined }), 'no-base');
  f.publishFace();
  assert.equal(await pending, 'stale');
  assert.deepEqual(f.events, []);
  f.bridge.dispose();
});

test('missing API, unknown state and ambiguous Base degrade without writes', async () => {
  const missing = fixture({ slots: {} });
  assert.equal(await missing.sync(), 'unsupported');
  missing.bridge.dispose();
  const f = fixture();
  f.publishFace();
  for (const baseBranch of [undefined, 'main', 'abc123', 'refs/tags/v1']) {
    assert.equal(await f.sync({ baseBranch }), 'no-base');
  }
  f.state.byTab.tab.scope = 'new-upstream-scope';
  assert.equal(await f.sync(), 'unsupported');
  assert.deepEqual(f.events, []);
  f.bridge.dispose();
});
