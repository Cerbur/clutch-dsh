import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers';
import { ensureNativeForge, NATIVE_FORGE_BUNDLE } from '../lib/client/dashboard/git/native-forge-activation.js';
import { createNativeChangesNavigation } from '../lib/client/dashboard/git/native-changes-navigation.js';
import { createWorktreeConnectionAdapter } from '../lib/client/worktree-connection.js';
const { AbortController } = globalThis;

function fixture() {
  const f = { calls: [], registered: false, enabled: false, controller: new AbortController(),
    confirm: async () => true, application: 'applied' };
  f.manager = {
    readNativeForge: async () => { f.calls.push('read'); return { enabled: f.enabled, manageable: true }; },
    enableNativeForge: async () => { f.calls.push('enable'); f.enabled = true; return f.application; },
  };
  f.run = (extra = {}) => ensureNativeForge({ manager: f.manager, ready: () => f.registered,
    confirm: (signal) => { f.calls.push('confirm'); return f.confirm(signal); },
    signal: f.controller.signal, timeoutMs: 100, pollMs: 1, ...extra });
  return f;
}

test('already registered native Diff does not read or change plugin management', async () => {
  const f = fixture();
  f.registered = true;
  assert.equal(await f.run(), 'ready');
  assert.deepEqual(f.calls, []);
});

test('cancelled confirmation performs no write and rechecks on the next click', async () => {
  const f = fixture();
  f.confirm = async () => false;
  assert.equal(await f.run(), 'cancelled');
  assert.deepEqual(f.calls, ['read', 'confirm']);
  f.confirm = async () => true;
  f.manager.enableNativeForge = async () => { f.calls.push('enable'); f.registered = true; return 'applied'; };
  assert.equal(await f.run(), 'ready');
  assert.deepEqual(f.calls, ['read', 'confirm', 'read', 'confirm', 'read', 'enable']);
});

test('activation waits for browser registration after Host success', async () => {
  const f = fixture();
  f.manager.enableNativeForge = async () => {
    f.calls.push('enable');
    setTimeout(() => { f.registered = true; }, 5);
    return 'applied';
  };
  assert.equal(await f.run(), 'ready');
  assert.deepEqual(f.calls, ['read', 'confirm', 'read', 'enable']);
});

test('lost enable response reconciles saved selection and delayed registration without a second click or write', async () => {
  const f = fixture();
  f.manager.enableNativeForge = () => {
    f.calls.push('enable');
    f.enabled = true;
    setTimeout(() => { f.registered = true; }, 20);
    return new Promise(() => {});
  };
  assert.equal(await f.run({ timeoutMs: 5, recoveryTimeoutMs: 100 }), 'ready');
  assert.equal(f.calls.filter((call) => call === 'enable').length, 1);
  assert.equal(f.calls.at(-1), 'read');
});

test('lost enable response never treats registration alone as consent after Forge is disabled again', async () => {
  const f = fixture();
  f.manager.enableNativeForge = () => {
    f.calls.push('enable');
    f.registered = true;
    return new Promise(() => {});
  };
  assert.equal(await f.run({ timeoutMs: 5, recoveryTimeoutMs: 20 }), 'forge-enable-failed');
  assert.equal(f.calls.filter((call) => call === 'enable').length, 1);
});

test('a permanently missing enable response and registration reaches a distinct bounded timeout', async () => {
  const f = fixture();
  f.manager.enableNativeForge = () => new Promise(() => {});
  assert.equal(await f.run({ timeoutMs: 5, recoveryTimeoutMs: 5 }), 'forge-enable-timeout');
});

test('recovery reread timeout does not claim no enablement occurred', async () => {
  const f = fixture();
  f.manager.enableNativeForge = () => {
    f.enabled = true;
    f.registered = true;
    f.manager.readNativeForge = () => new Promise(() => {});
    return new Promise(() => {});
  };
  assert.equal(await f.run({ timeoutMs: 5 }), 'forge-enable-timeout');
});

test('cancelling lost-response recovery settles promptly and never rolls back enablement', async () => {
  const f = fixture();
  f.manager.enableNativeForge = () => { f.enabled = true; return new Promise(() => {}); };
  assert.equal(await f.run({ timeoutMs: 5, recoveryTimeoutMs: 1000, onDiagnostic: (event) => {
    if (event.phase === 'enable-response-lost') f.controller.abort();
  } }), 'stale');
  assert.equal(f.enabled, true);
});

test('registration can precede the first Session store adoption after activation', async () => {
  let registered = false;
  let adopted = false;
  let screen = { sessionId: 's', workspaceId: 'ws', cwd: '/repo', ready: true, mountedSessionId: 's' };
  const calls = [];
  const navigation = createNativeChangesNavigation({
    screen: () => screen,
    sidebar: () => ({ accepts: () => registered, open: () => {
      if (!adopted) throw new Error('sidebarRight: no session surface is mounted');
      calls.push('opened');
    } }),
    manager: { canOpenNativeChanges: async () => { calls.push('verified'); return true; } },
    openSession: () => assert.fail('same Session must not switch'),
    ensureAvailable: async () => {
      registered = true;
      screen = { ...screen, cwd: undefined, ready: false };
      setTimeout(() => { screen = { ...screen, cwd: '/repo', ready: true }; }, 5);
      setTimeout(() => { adopted = true; }, 15);
      return 'ready';
    },
    readyTimeoutMs: 100, pollMs: 1,
  });
  assert.equal(await navigation.open({ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo' }, [], () => true), 'opened');
  assert.equal(calls.at(-2), 'verified', 'revalidate after adoption, not using a pre-wait directory check');
  assert.equal(calls.at(-1), 'opened');
  navigation.dispose();
});

for (const screen of [
  { supported: true, ready: false },
  { sessionId: 'other', workspaceId: 'other-ws', cwd: '/other', ready: false },
  { sessionId: 'other', workspaceId: 'ws', cwd: '/other', ready: false },
]) test('activation authorizes a retained candidate before waiting on an absent or unrelated current surface', async () => {
  const selected = [];
  const navigation = createNativeChangesNavigation({
    screen: () => screen,
    sidebar: () => ({ accepts: () => false, open: () => assert.fail('selection must require a fresh click') }),
    manager: { canOpenNativeChanges: async ({ sessionId }) => sessionId === 'saved' },
    openSession: (id) => selected.push(id),
    ensureAvailable: async () => assert.fail('switching Sessions must not activate Forge'),
    readyTimeoutMs: 5, pollMs: 1,
  });
  assert.equal(await navigation.open({ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo' }, ['saved'], () => true), 'session-switching');
  assert.deepEqual(selected, ['saved']);
  navigation.dispose();
});

for (const change of ['session', 'cwd', 'close', 'dispose', 'timeout', 'directory-rejected']) {
  test(`activation mount wait handles ${change} without opening a stale Diff`, async () => {
    let current = true;
    let screen = { sessionId: 's', workspaceId: 'ws', cwd: '/repo', ready: true, mountedSessionId: 's' };
    let registered = false;
    let verified = 0;
    const events = [];
    const navigation = createNativeChangesNavigation({
      screen: () => screen,
      sidebar: () => ({ accepts: () => registered, open: () => assert.fail('must not open') }),
      manager: { canOpenNativeChanges: async () => {
        verified++;
        return !(change === 'directory-rejected' && verified > 1);
      } },
      openSession: () => assert.fail('must not switch'),
      ensureAvailable: async () => {
        registered = true;
        screen = { ...screen, mountedSessionId: undefined };
        return 'ready';
      },
      onDiagnostic: (event) => {
        events.push(event);
        if (event.phase !== 'session-mount-wait') return;
        if (change === 'session') screen = { ...screen, sessionId: 'other' };
        if (change === 'cwd') screen = { ...screen, cwd: '/other' };
        if (change === 'close') current = false;
        if (change === 'dispose') navigation.dispose();
        if (change === 'directory-rejected') screen = { ...screen, mountedSessionId: 's' };
      },
      readyTimeoutMs: 10, pollMs: 1,
    });
    const expected = { session: 'session-switching', cwd: 'session-switching', close: 'stale', dispose: 'stale',
      timeout: 'session-ready-timeout', 'directory-rejected': 'directory-mismatch' }[change];
    assert.equal(await navigation.open({ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo' }, [], () => current), expected);
    assert.equal(verified, change === 'directory-rejected' ? 2 : 1,
      'authorize the current target first, then revalidate only after its surface becomes ready');
    assert.equal(events.at(-1).result, expected);
    assert.ok(events.every((event) => Object.keys(event).every((key) => ['phase', 'elapsedMs', 'result'].includes(key))));
    navigation.dispose();
  });
}

test('a cwd first published during authorization requires a new Host check before opening', async () => {
  let registered = false;
  let verified = 0;
  let opened = 0;
  let screen = { sessionId: 's', workspaceId: 'ws', cwd: undefined, ready: true, mountedSessionId: 's' };
  const navigation = createNativeChangesNavigation({
    screen: () => screen,
    sidebar: () => ({ accepts: () => registered, open: () => { opened++; } }),
    manager: { canOpenNativeChanges: async () => {
      verified++;
      if (verified === 1) { screen = { ...screen, cwd: '/other' }; return true; }
      return false;
    } },
    openSession: () => assert.fail('same Session must not switch'),
    ensureAvailable: async () => { registered = true; return 'ready'; },
    readyTimeoutMs: 100, pollMs: 1,
  });
  assert.equal(await navigation.open({ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo' }, [], () => true), 'directory-mismatch');
  assert.equal(verified, 2);
  assert.equal(opened, 0);
  navigation.dispose();
});

test('concurrent enablement during confirmation is reused without another write', async () => {
  const f = fixture();
  f.confirm = async () => { f.enabled = true; f.registered = true; return true; };
  assert.equal(await f.run(), 'ready');
  assert.deepEqual(f.calls, ['read', 'confirm', 'read']);
});

test('enabled but unavailable panel times out without force-enabling its rows', async () => {
  const f = fixture();
  f.enabled = true;
  assert.equal(await f.run({ timeoutMs: 5 }), 'forge-timeout');
  assert.deepEqual(f.calls, ['read']);
});

for (const [application, expected] of [
  ['restart-required', 'forge-restart-required'], ['overridden', 'forge-overridden'],
  ['failed', 'forge-enable-failed'], ['cancelled', 'forge-enable-failed'],
]) test(`native management result ${application} does not open Diff`, async () => {
  const f = fixture();
  f.application = application;
  assert.equal(await f.run(), expected);
  assert.equal(f.registered, false);
});

for (const state of [undefined, { enabled: false, manageable: false }]) {
  test('missing or unmanageable Forge never requests confirmation or writes', async () => {
    const f = fixture();
    f.manager.readNativeForge = async () => state;
    assert.equal(await f.run(), 'unavailable');
    assert.deepEqual(f.calls, []);
  });
}

test('request deadlines bound a non-cooperative management service', async () => {
  const f = fixture();
  f.manager.readNativeForge = () => new Promise(() => {});
  assert.equal(await f.run({ timeoutMs: 5 }), 'forge-state-timeout');
});

test('synchronous selection change after confirmation cannot race the cancellation poll into a write', async () => {
  const f = fixture();
  let current = true;
  f.confirm = async () => { current = false; return true; };
  assert.equal(await f.run({ isCurrent: () => current }), 'stale');
  assert.deepEqual(f.calls, ['read', 'confirm']);
});

test('cancellation during confirmation, management and registration never rolls back selection', async () => {
  for (const stage of ['confirm', 'enable', 'ready']) {
    const f = fixture();
    if (stage === 'confirm') f.confirm = async () => { f.controller.abort(); return true; };
    if (stage === 'enable') f.manager.enableNativeForge = async () => {
      f.calls.push('enable'); f.controller.abort(); return 'applied';
    };
    if (stage === 'ready') f.manager.enableNativeForge = async () => {
      f.calls.push('enable'); setTimeout(() => f.controller.abort(), 5); return 'applied';
    };
    assert.equal(await f.run(), 'stale');
    assert.equal(f.calls.filter((call) => call === 'enable').length, stage === 'confirm' ? 0 : 1);
  }
});

test('native endpoints use direct Gateway values and only enable the exact official bundle', async () => {
  const calls = [];
  const adapter = createWorktreeConnectionAdapter({ call: async (...args) => {
    calls.push(args);
    return { ok: true, value: args[1] === 'pluginManager/listBundles'
      ? [{ name: NATIVE_FORGE_BUNDLE, enabled: false, availability: 'installation' }]
      : { target: NATIVE_FORGE_BUNDLE, stage: 'enable', application: 'applied' } };
  } });
  assert.deepEqual(await adapter.readNativeForge(new AbortController().signal), { enabled: false, manageable: true });
  assert.equal(await adapter.enableNativeForge(new AbortController().signal), 'applied');
  assert.deepEqual(calls.map((call) => call.slice(0, 3)), [
    ['/api', 'pluginManager/listBundles', { args: {} }],
    ['/api', 'pluginManager/setBundleEnabled', { args: { name: NATIVE_FORGE_BUNDLE, enabled: true } }],
  ]);
  adapter.dispose();
  assert.equal(calls.length, 2);
});

test('native adapter rejects malformed responses and propagates Gateway failures', async () => {
  for (const value of [null, {}, { ok: true, value: [] }]) {
    const adapter = createWorktreeConnectionAdapter({ call: async () => ({ ok: true, value }) });
    await assert.rejects(adapter.readNativeForge(new AbortController().signal), { code: 'WORKTREE_RPC_INVALID_RESULT' });
    await assert.rejects(adapter.enableNativeForge(new AbortController().signal), { code: 'WORKTREE_RPC_INVALID_RESULT' });
    adapter.dispose();
  }
  const adapter = createWorktreeConnectionAdapter({ call: async () => ({
    ok: false, error: { code: 'gateway/service-unavailable', message: 'missing', details: {} },
  }) });
  await assert.rejects(adapter.readNativeForge(new AbortController().signal), { code: 'gateway/service-unavailable' });
  adapter.dispose();
});

for (const reason of ['directory-mismatch', 'verification-failed', 'verification-timeout']) {
  test(`Forge is not offered or written when directory preflight ends in ${reason}`, async () => {
    const f = fixture();
    const navigation = createNativeChangesNavigation({
      screen: () => ({ workspaceId: 'ws', sessionId: 'current', cwd: '/other', ready: true }),
      sidebar: () => ({ accepts: () => false, open: () => assert.fail('no authorized target') }),
      openSession: () => assert.fail('no authorized target'),
      manager: { canOpenNativeChanges: async () => {
        if (reason === 'verification-failed') throw new Error('Host unavailable');
        if (reason === 'verification-timeout') return new Promise(() => {});
        return false;
      } }, verificationTimeoutMs: 10,
      ensureAvailable: () => f.run(),
    });
    assert.equal(await navigation.open({ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/target' }, [], () => true), reason);
    assert.deepEqual(f.calls, [], 'no management read, confirmation, or profile write');
    navigation.dispose();
  });
}

test('switching the current Session during confirmation does not save Forge selection', async () => {
  const f = fixture();
  let sessionId = 'current';
  const navigation = createNativeChangesNavigation({
    screen: () => ({ workspaceId: 'ws', sessionId, ready: true, cwd: '/repo' }),
    sidebar: () => ({ accepts: () => false, open: () => assert.fail('stale open') }),
    manager: { canOpenNativeChanges: async () => true }, openSession: () => assert.fail('stale switch'),
    ensureAvailable: (_address, confirm, signal, isCurrent) => f.run({ confirm, signal, isCurrent }),
  });
  assert.equal(await navigation.open({ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo' }, [], () => true,
    undefined, async () => { sessionId = 'other'; return true; }), 'session-switching');
  assert.deepEqual(f.calls, ['read']);
  navigation.dispose();
});

test('loss of directory authorization during activation does not redirect to a retained Session', async () => {
  let registered = false;
  const checked = [];
  const navigation = createNativeChangesNavigation({
    screen: () => ({ workspaceId: 'ws', sessionId: 'current', mountedSessionId: 'current', ready: true, cwd: '/repo' }),
    sidebar: () => ({ accepts: () => registered, open: () => assert.fail('stale authorization') }),
    manager: { canOpenNativeChanges: async ({ sessionId }) => { checked.push(sessionId); return !registered || sessionId === 'other'; } },
    openSession: () => assert.fail('a profile confirmation must not redirect to a different Session'),
    ensureAvailable: async () => { registered = true; return 'ready'; },
  });
  assert.equal(await navigation.open({ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo' }, ['other'], () => true), 'directory-mismatch');
  assert.deepEqual(checked, ['current', 'current']);
  navigation.dispose();
});

test('one open click confirms, activates, revalidates cwd and opens native Diff without a second click', async () => {
  const f = fixture();
  const calls = [];
  const record = { workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo/wt' };
  const screen = { sessionId: 's', workspaceId: 'ws', cwd: '/repo/wt', ready: true, mountedSessionId: 's' };
  f.manager.enableNativeForge = async () => { f.calls.push('enable'); f.registered = true; return 'applied'; };
  const navigation = createNativeChangesNavigation({
    screen: () => screen,
    sidebar: () => ({ accepts: () => f.registered, open: (address) => calls.push(address) }),
    manager: { canOpenNativeChanges: async () => { calls.push('verified'); return true; } },
    openSession: () => assert.fail('must reuse current Session'),
    ensureAvailable: (_address, confirm, signal) => f.run({ confirm, signal }),
  });
  const result = navigation.open(record, [], () => true, undefined, async () => { calls.push('confirm'); return true; });
  assert.equal(navigation.open(record, [], () => true), result);
  assert.equal(await result, 'opened');
  assert.deepEqual(calls, ['verified', 'confirm', 'verified', 'dsh-resource://forge-changes/s/local']);
  navigation.dispose();
  assert.equal(f.calls.filter((call) => call === 'enable').length, 1);
});

test('closing or disposing during activation cancels the pending open, but keeps Forge enabled', async () => {
  for (const dispose of [false, true]) {
    const f = fixture();
    let current = true;
    let reads = 0;
    let entered;
    const enabling = new Promise((resolve) => { entered = resolve; });
    f.manager.enableNativeForge = async () => { f.enabled = true; entered(); return 'applied'; };
    const navigation = createNativeChangesNavigation({
      screen: () => ({ sessionId: 's', workspaceId: 'ws', cwd: '/repo', ready: true, mountedSessionId: 's' }),
      sidebar: () => ({ accepts: () => false, open: () => assert.fail('stale open') }),
      manager: { canOpenNativeChanges: async () => { reads++; return true; } },
      openSession: () => assert.fail('stale navigation'),
      ensureAvailable: (_address, confirm, signal) => f.run({ confirm, signal, timeoutMs: 1000 }),
    });
    const result = navigation.open({ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo' },
      [], () => current, undefined, async () => true);
    await enabling;
    if (dispose) navigation.dispose();
    else current = false;
    assert.equal(await result, 'stale');
    assert.equal(reads, 1, 'preflight only; no validation after cancellation');
    assert.equal(f.enabled, true);
    navigation.dispose();
  }
});
