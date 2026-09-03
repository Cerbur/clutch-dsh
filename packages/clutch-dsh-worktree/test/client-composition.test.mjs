import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { loadClientEntry } from './client-fixture.mjs';

const packageDirectory = path.resolve('.');
const packageManifest = JSON.parse(
  await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
);

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function loadRuntimeClientExports() {
  const runtimePath = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-runtime/client'));
  const runtimeBundle = await readFile(runtimePath, 'utf8');
  const handoffs = [];
  new Function('window', runtimeBundle)({
    __ModuleLoader__: {
      load(handoff) {
        handoffs.push(handoff);
      },
    },
  });
  assert.equal(handoffs.length, 1);
  const [cordis, slots] = await Promise.all([
    import('@deepseek-ai/cordis'),
    import('@deepseek-ai/dsh-client-ui-slots'),
  ]);
  return handoffs[0].factory((specifier) => {
    if (specifier === '@deepseek-ai/cordis') return cordis;
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {};
    if (specifier === '@deepseek-ai/dsh-client-ui-slots') return slots;
    throw new Error(`unexpected DSH runtime module request: ${specifier}`);
  });
}

test('publishes an official DSH client-module handoff with a browser-safe apply entry', async () => {
  const clientBundle = await readFile(path.join(packageDirectory, 'lib', 'client.js'), 'utf8');
  assert.match(clientBundle, /window\.__ModuleLoader__\.load/);
  assert.match(clientBundle, /@cerbur\/clutch-dsh-worktree/);
  assert.match(clientBundle, /sidebar\.footer\.action/);
  assert.match(clientBundle, /shell\.overlay/);
  assert.doesNotMatch(clientBundle, /@deepseek-ai\/dsh-api-remotes|\.\/remote/);
  assert.doesNotMatch(clientBundle, /(?:Host|Manage|Provider) runtime/i);
  assert.doesNotMatch(clientBundle, /ctx\.remote\.\$mount|remote\.\$mount/);
});

test('injects native Session actions into the Worktree surface', async () => {
  const source = await readFile(path.join(packageDirectory, 'src', 'client', 'entry.ts'), 'utf8');
  assert.match(source, /renameSession/);
  assert.match(source, /forkSession/);
  assert.match(source, /archiveSession/);
  assert.match(source, /ctx\.sessions\.binding/);
  assert.match(source, /ctx\.sessions\s*\.fork/);
  assert.match(source, /ctx\.workspaces\.archiveSession/);
  assert.match(source, /renameWorkspace/);
  assert.match(source, /deleteWorkspace/);
  assert.match(source, /insertWorkspaceBefore/);
  assert.match(source, /insertSessionBefore/);
  assert.match(source, /ctx\.workspaces\.rename/);
  assert.match(source, /ctx\.workspaces\.delete/);
  assert.match(source, /ctx\.workspaces\.insertBefore/);
  assert.match(source, /ctx\.workspaces\.insertSessionBefore/);
});

test('wraps the shared native fork entry point for Worktree child binding', async () => {
  const source = await readFile(
    path.join(packageDirectory, 'src', 'client', 'entry.ts'),
    'utf8',
  );
  assert.match(source, /createWorktreeSessionForkCoordinator/);
  assert.match(source, /sessions\.fork/);
  assert.match(source, /forkCoordinator\.reconcile\(\)/);
  assert.match(source, /forkCoordinator\.dispose\(\)/);
  assert.match(source, /ensureSessionWorkspace/);
  assert.match(source, /manager\.listBindings/);
});

test('binds a native fork child through the existing browser-local membership overlay', async () => {
  const fixture = await loadClientEntry({
    sessionListSnapshot: {
      phase: 'ready',
      ids: ['parent-session'],
      byId: { 'parent-session': { blank: false } },
      current: 'parent-session',
    },
    fork: async (input) => {
      assert.deepEqual(input, {
        sessionId: 'parent-session',
        atSeq: 17,
        increaseTitle: true,
      });
      return 'child-session';
    },
    rpc: {
      call(_channel, endpoint, payload) {
        const input = payload.args.input;
        if (endpoint === 'worktreeManager/listBindings') {
          return Promise.resolve({
            ok: true,
            value: {
              ok: true,
              value: input.workspaceId === 'workspace-current'
                ? [{
                    workspaceId: 'workspace-current',
                    worktreeId: 'worktree-one',
                    sessionId: 'parent-session',
                    status: 'active',
                  }]
                : [],
            },
          });
        }
        if (endpoint === 'worktreeManager/bindSession') {
          return Promise.resolve({
            ok: true,
            value: { ok: true, value: { ...input, status: 'active' } },
          });
        }
        return Promise.resolve({ ok: true, value: { ok: true, value: [] } });
      },
    },
  });

  assert.notEqual(fixture.fakeContext.sessions.fork, fixture.nativeFork);
  assert.equal(
    await fixture.fakeContext.sessions.fork({
      sessionId: 'parent-session',
      atSeq: 17,
      increaseTitle: true,
    }),
    'child-session',
  );
  assert.deepEqual(
    fixture.fakeContext.workspaces.list.getSnapshot().items[0].sessionIds,
    ['session-current'],
  );
  fixture.registrationsBySlot.get('shell.overlay').options.inject().syncSessionWorkspaces([
    { workspaceId: 'workspace-current', sessionId: 'child-session' },
  ]);
  assert.deepEqual(
    fixture.fakeContext.workspaces.list.getSnapshot().items[0].sessionIds,
    ['session-current', 'child-session'],
  );
  assert.deepEqual(
    fixture.fakeContext.sessions.list.getSnapshot().ids,
    ['parent-session'],
  );

  for (const dispose of fixture.disposers.reverse()) dispose();
  assert.equal(fixture.fakeContext.sessions.fork, fixture.nativeFork);
});

test('coalesces fork binding reads across repeated Client notifications', async () => {
  const bindingRequests = [];
  let parentOneBindingAvailable = false;
  const sessionSnapshot = {
    phase: 'ready',
    ids: ['parent-one', 'child-one', 'parent-two', 'child-two'],
    byId: {
      'parent-one': { blank: false },
      'child-one': { blank: false, parentId: 'parent-one' },
      'parent-two': { blank: false },
      'child-two': { blank: false, parentId: 'parent-two' },
    },
  };
  const workspaceSnapshot = {
    items: [
      {
        workspaceId: 'workspace-one',
        path: '/tmp/workspace-one',
        title: 'One',
        sessionIds: ['parent-one'],
      },
      {
        workspaceId: 'workspace-two',
        path: '/tmp/workspace-two',
        title: 'Two',
        sessionIds: ['parent-two'],
      },
    ],
  };
  const fixture = await loadClientEntry({
    sessionListSnapshot: sessionSnapshot,
    workspaceSnapshot,
    fork: async () => 'unused',
    rpc: {
      call(_channel, endpoint, payload) {
        const input = payload.args.input;
        if (endpoint === 'worktreeManager/listBindings') {
          bindingRequests.push(input.workspaceId);
          if (input.workspaceId === 'workspace-one' && !parentOneBindingAvailable) {
            return Promise.resolve({
              ok: true,
              value: { ok: true, value: [] },
            });
          }
          const parentSessionId =
            input.workspaceId === 'workspace-one' ? 'parent-one' : 'parent-two';
          return Promise.resolve({
            ok: true,
            value: {
              ok: true,
              value: [
                {
                  workspaceId: input.workspaceId,
                  worktreeId: `worktree-${input.workspaceId}`,
                  sessionId: parentSessionId,
                  status: 'active',
                },
              ],
            },
          });
        }
        if (endpoint === 'worktreeManager/bindSession') {
          return Promise.resolve({
            ok: true,
            value: { ok: true, value: { ...input, status: 'active' } },
          });
        }
        return Promise.resolve({ ok: true, value: { ok: true, value: [] } });
      },
    },
  });
  const flush = async () => {
    await setImmediate();
    await setImmediate();
  };

  await flush();
  assert.deepEqual(bindingRequests, ['workspace-one', 'workspace-two']);

  fixture.setSessionListSnapshot({
    ...sessionSnapshot,
    byId: {
      ...sessionSnapshot.byId,
      'parent-one': { blank: false, running: true, updatedAt: 42 },
    },
  });
  await flush();
  assert.deepEqual(bindingRequests, ['workspace-one', 'workspace-two']);

  parentOneBindingAvailable = true;
  fixture.setWorkspaceSnapshot({
    items: workspaceSnapshot.items.map((workspace) => ({
      ...workspace,
      title: `${workspace.title} renamed`,
    })),
  });
  await flush();
  assert.deepEqual(bindingRequests, ['workspace-one', 'workspace-two']);

  fixture.setWorkspaceSnapshot({
    items: [
      { ...workspaceSnapshot.items[0], sessionIds: ['parent-one', 'child-one'] },
      workspaceSnapshot.items[1],
    ],
  });
  await flush();
  assert.deepEqual(bindingRequests, [
    'workspace-one',
    'workspace-two',
    'workspace-one',
  ]);

  for (const dispose of fixture.disposers.reverse()) dispose();
});

test('keeps Worktree Session preflight in the requested Workspace', async () => {
  const bindingRequests = [];
  const fixture = await loadClientEntry({
    sessionListSnapshot: {
      phase: 'ready',
      ids: [],
      byId: {},
    },
    workspaceSnapshot: {
      items: [
        { workspaceId: 'workspace-one', title: 'One', sessionIds: [] },
        { workspaceId: 'workspace-two', title: 'Two', sessionIds: [] },
      ],
    },
    rpc: {
      call(_channel, endpoint, payload) {
        const input = payload.args.input;
        if (endpoint === 'worktreeManager/listWorktrees') {
          return Promise.resolve({
            ok: true,
            value: {
              ok: true,
              value: [{
                workspaceId: input.workspaceId,
                worktreeId: 'worktree-target',
                absolutePath: '/tmp/worktree-target',
                status: 'active',
                health: 'ready',
              }],
            },
          });
        }
        if (endpoint === 'worktreeManager/listBindings') {
          bindingRequests.push(input.workspaceId);
          return Promise.resolve({
            ok: true,
            value: { ok: true, value: [] },
          });
        }
        if (endpoint === 'worktreeManager/bindSession') {
          return Promise.resolve({
            ok: true,
            value: { ok: true, value: { ...input, status: 'active' } },
          });
        }
        return Promise.resolve({ ok: true, value: { ok: true, value: [] } });
      },
    },
  });

  const overlay = fixture.registrationsBySlot.get('shell.overlay').options.inject();
  await overlay.createSessionForWorktree({
    workspaceId: 'workspace-two',
    worktreeId: 'worktree-target',
    cwd: '/tmp/worktree-target',
  });

  assert.deepEqual(bindingRequests, ['workspace-two']);
  for (const dispose of fixture.disposers.reverse()) dispose();
});

test('does not globally rescan Fork bindings while creating an unconfirmed Worktree Session', async () => {
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({
        dataset: {},
        setAttribute() {},
        remove() {},
        textContent: '',
      }),
      head: { append() {}, appendChild() {} },
      documentElement: {},
    },
  });

  let fixture;
  try {
    const bindingRequests = [];
    const initialSessionSnapshot = {
      phase: 'ready',
      ids: ['parent-session', 'child-session'],
      byId: {
        'parent-session': { blank: false },
        'child-session': { blank: false, parentId: 'parent-session' },
      },
    };
    fixture = await loadClientEntry({
      sessionListSnapshot: initialSessionSnapshot,
      workspaceSnapshot: {
        items: [
          { workspaceId: 'workspace-one', title: 'One', sessionIds: [] },
          { workspaceId: 'workspace-two', title: 'Two', sessionIds: [] },
        ],
      },
      fork: async () => 'unused',
      rpc: {
        call(_channel, endpoint, payload) {
          const input = payload.args.input;
          if (endpoint === 'worktreeManager/listWorktrees') {
            return Promise.resolve({
              ok: true,
              value: {
                ok: true,
                value: [{
                  workspaceId: input.workspaceId,
                  worktreeId: 'worktree-one',
                  absolutePath: '/tmp/worktree-one',
                  status: 'active',
                  health: 'ready',
                }],
              },
            });
          }
          if (endpoint === 'worktreeManager/listBindings') {
            bindingRequests.push(input.workspaceId);
            return Promise.resolve({
              ok: true,
              value: { ok: true, value: [] },
            });
          }
          if (endpoint === 'worktreeManager/bindSession') {
            return Promise.resolve({
              ok: true,
              value: { ok: true, value: { ...input, status: 'active' } },
            });
          }
          if (endpoint === 'worktreeManager/ensureWorktreePermission') {
            return Promise.resolve({
              ok: true,
              value: {
                ok: true,
                value: input.confirmed === true
                  ? {
                      status: 'full-applied',
                      preset: 'worktree-full-access',
                      sandboxMode: 'danger-full-access',
                      approvalPolicy: 'ask',
                      retryable: false,
                    }
                  : { status: 'confirmation-required', retryable: false },
              },
            });
          }
          return Promise.resolve({ ok: true, value: { ok: true, value: [] } });
        },
      },
    });
    const flush = async () => {
      await setImmediate();
      await setImmediate();
    };

    await flush();
    const initialBindingRequestCount = bindingRequests.length;
    assert.deepEqual(bindingRequests, ['workspace-one', 'workspace-two']);

    const overlay = fixture.registrationsBySlot.get('shell.overlay').options.inject();
    const createPromise = overlay.createSessionForWorktree({
      workspaceId: 'workspace-one',
      worktreeId: 'worktree-one',
      cwd: '/tmp/worktree-one',
    });
    await flush();
    assert.deepEqual(overlay.fullAccessConfirmation.getSnapshot(), {
      workspaceId: 'workspace-one',
      worktreeId: 'worktree-one',
      sessionId: 'session-created',
      cwd: '/tmp/worktree-one',
    });

    fixture.setSessionListSnapshot({
      ...initialSessionSnapshot,
      ids: [...initialSessionSnapshot.ids, 'session-created'],
      byId: {
        ...initialSessionSnapshot.byId,
        'session-created': { blank: true },
      },
    });
    await flush();
    fixture.setSessionListSnapshot({
      ...initialSessionSnapshot,
      ids: [...initialSessionSnapshot.ids, 'session-created'],
      byId: {
        ...initialSessionSnapshot.byId,
        'session-created': { blank: false },
      },
    });
    await flush();

    overlay.fullAccessConfirmation.resolve(true);
    assert.equal(await createPromise, 'session-created');
    assert.deepEqual(bindingRequests.slice(initialBindingRequestCount), ['workspace-one']);
  } finally {
    if (fixture !== undefined) {
      for (const dispose of fixture.disposers.reverse()) dispose();
    }
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: previousDocument,
      });
    }
  }
});

test('does not treat browser-local Worktree membership as a Fork scope change', async () => {
  const bindingRequests = [];
  const fixture = await loadClientEntry({
    sessionListSnapshot: {
      phase: 'ready',
      ids: ['parent-session', 'child-session'],
      byId: {
        'parent-session': { blank: false },
        'child-session': { blank: false, parentId: 'parent-session' },
      },
    },
    workspaceSnapshot: {
      items: [
        { workspaceId: 'workspace-one', title: 'One', sessionIds: [] },
        { workspaceId: 'workspace-two', title: 'Two', sessionIds: [] },
      ],
    },
    fork: async () => 'unused',
    rpc: {
      call(_channel, endpoint, payload) {
        if (endpoint === 'worktreeManager/listBindings') {
          bindingRequests.push(payload.args.input.workspaceId);
        }
        return Promise.resolve({ ok: true, value: { ok: true, value: [] } });
      },
    },
  });
  const flush = async () => {
    await setImmediate();
    await setImmediate();
  };

  await flush();
  const baseline = [...bindingRequests];
  assert.deepEqual(baseline, ['workspace-one', 'workspace-two']);

  const overlay = fixture.registrationsBySlot.get('shell.overlay').options.inject();
  overlay.syncSessionWorkspaces([
    { workspaceId: 'workspace-one', sessionId: 'session-created' },
  ]);
  await flush();

  assert.deepEqual(bindingRequests, baseline);
  for (const dispose of fixture.disposers.reverse()) dispose();
});

test('does not rescan bindings when Workspace order changes', async () => {
  const bindingRequests = [];
  const workspaceSnapshot = {
    items: [
      { workspaceId: 'workspace-one', title: 'One', sessionIds: [] },
      { workspaceId: 'workspace-two', title: 'Two', sessionIds: [] },
    ],
  };
  const fixture = await loadClientEntry({
    sessionListSnapshot: {
      phase: 'ready',
      ids: ['parent-session', 'child-session'],
      byId: {
        'parent-session': { blank: false },
        'child-session': { blank: false, parentId: 'parent-session' },
      },
    },
    workspaceSnapshot,
    fork: async () => 'unused',
    rpc: {
      call(_channel, endpoint, payload) {
        if (endpoint === 'worktreeManager/listBindings') {
          bindingRequests.push(payload.args.input.workspaceId);
          return Promise.resolve({
            ok: true,
            value: { ok: true, value: [] },
          });
        }
        return Promise.resolve({ ok: true, value: { ok: true, value: [] } });
      },
    },
  });
  const flush = async () => {
    await setImmediate();
    await setImmediate();
  };

  await flush();
  assert.deepEqual(bindingRequests, ['workspace-one', 'workspace-two']);

  fixture.setWorkspaceSnapshot({
    items: [...workspaceSnapshot.items].reverse(),
  });
  await flush();

  assert.deepEqual(bindingRequests, ['workspace-one', 'workspace-two']);
  for (const dispose of fixture.disposers.reverse()) dispose();
});

test('looks up a Fork parent only in its known owning Workspace', async () => {
  const bindingRequests = [];
  const fixture = await loadClientEntry({
    sessionListSnapshot: {
      phase: 'ready',
      ids: ['parent-one'],
      byId: { 'parent-one': { blank: false } },
    },
    workspaceSnapshot: {
      items: [
        {
          workspaceId: 'workspace-one',
          path: '/tmp/workspace-one',
          title: 'One',
          sessionIds: ['parent-one'],
        },
        {
          workspaceId: 'workspace-two',
          path: '/tmp/workspace-two',
          title: 'Two',
          sessionIds: [],
        },
      ],
    },
    fork: async () => 'child-one',
    rpc: {
      call(_channel, endpoint, payload) {
        if (endpoint === 'worktreeManager/listBindings') {
          bindingRequests.push(payload.args.input.workspaceId);
          return Promise.resolve({
            ok: true,
            value: {
              ok: true,
              value: payload.args.input.workspaceId === 'workspace-one'
                ? [{
                    workspaceId: 'workspace-one',
                    worktreeId: 'worktree-one',
                    sessionId: 'parent-one',
                    status: 'active',
                  }]
                : [],
            },
          });
        }
        if (endpoint === 'worktreeManager/bindSession') {
          return Promise.resolve({ ok: true, value: { ok: true, value: payload.args.input } });
        }
        return Promise.resolve({ ok: true, value: { ok: true, value: [] } });
      },
    },
  });

  assert.equal(await fixture.fakeContext.sessions.fork({ sessionId: 'parent-one' }), 'child-one');
  assert.deepEqual(bindingRequests, ['workspace-one']);
  for (const dispose of fixture.disposers.reverse()) dispose();
});

test('uses a found Fork binding when an unrelated fallback Workspace read fails', async () => {
  const bindingRequests = [];
  const bindCalls = [];
  const fixture = await loadClientEntry({
    sessionListSnapshot: {
      phase: 'ready',
      ids: ['parent-known', 'child-known', 'parent-unknown', 'child-unknown'],
      byId: {
        'parent-known': { blank: false },
        'child-known': { blank: false, parentId: 'parent-known' },
        'parent-unknown': { blank: false },
        'child-unknown': { blank: false, parentId: 'parent-unknown' },
      },
    },
    workspaceSnapshot: {
      items: [
        {
          workspaceId: 'workspace-known',
          path: '/tmp/workspace-known',
          title: 'Known',
          sessionIds: ['parent-known'],
        },
        {
          workspaceId: 'workspace-unrelated',
          path: '/tmp/workspace-unrelated',
          title: 'Unrelated',
          sessionIds: [],
        },
      ],
    },
    fork: async () => 'unused',
    rpc: {
      call(_channel, endpoint, payload) {
        if (endpoint === 'worktreeManager/listBindings') {
          const workspaceId = payload.args.input.workspaceId;
          bindingRequests.push(workspaceId);
          if (workspaceId === 'workspace-unrelated') {
            return Promise.reject(new Error('unrelated Workspace unavailable'));
          }
          return Promise.resolve({
            ok: true,
            value: {
              ok: true,
              value: [{
                workspaceId: 'workspace-known',
                worktreeId: 'worktree-known',
                sessionId: 'parent-known',
                status: 'active',
              }],
            },
          });
        }
        if (endpoint === 'worktreeManager/bindSession') {
          bindCalls.push(payload.args.input);
          return Promise.resolve({
            ok: true,
            value: { ok: true, value: payload.args.input },
          });
        }
        return Promise.resolve({ ok: true, value: { ok: true, value: [] } });
      },
    },
  });

  await setImmediate();
  await setImmediate();

  assert.deepEqual(bindingRequests, ['workspace-known', 'workspace-unrelated']);
  assert.deepEqual(bindCalls, [{
    workspaceId: 'workspace-known',
    worktreeId: 'worktree-known',
    sessionId: 'child-known',
  }]);
  const recovery = fixture.registrationsBySlot.get('shell.overlay').options.inject()
    .forkRecovery.getSnapshot();
  assert.deepEqual(recovery.pending.map((item) => item.childSessionId), ['child-unknown']);
  assert.deepEqual(recovery.affectedWorkspaceIds, ['workspace-known']);
  for (const dispose of fixture.disposers.reverse()) dispose();
});

test('shares an overlapping direct Fork lookup with notification reconciliation', async () => {
  const bindingRequests = [];
  const nativeForkResult = deferred();
  const bindingResult = deferred();
  let fixture;
  fixture = await loadClientEntry({
    sessionListSnapshot: {
      phase: 'ready',
      ids: ['parent-one'],
      byId: { 'parent-one': { blank: false } },
    },
    workspaceSnapshot: {
      items: [{
        workspaceId: 'workspace-one',
        path: '/tmp/workspace-one',
        title: 'One',
        sessionIds: ['parent-one'],
      }],
    },
    fork: async () => {
      fixture.setSessionListSnapshot({
        phase: 'ready',
        ids: ['parent-one', 'child-one'],
        byId: {
          'parent-one': { blank: false },
          'child-one': { blank: false, parentId: 'parent-one' },
        },
      });
      return nativeForkResult.promise;
    },
    rpc: {
      call(_channel, endpoint, payload) {
        if (endpoint === 'worktreeManager/listBindings') {
          bindingRequests.push(payload.args.input.workspaceId);
          return bindingResult.promise;
        }
        if (endpoint === 'worktreeManager/bindSession') {
          return Promise.resolve({
            ok: true,
            value: { ok: true, value: { ...payload.args.input, status: 'active' } },
          });
        }
        return Promise.resolve({ ok: true, value: { ok: true, value: [] } });
      },
    },
  });

  const forkPromise = fixture.fakeContext.sessions.fork({ sessionId: 'parent-one' });
  nativeForkResult.resolve('child-one');
  fixture.setWorkspaceSnapshot({
    items: [{
      workspaceId: 'workspace-one',
      path: '/tmp/workspace-one',
      title: 'One',
      sessionIds: ['parent-one', 'child-one'],
    }],
  });
  await setImmediate();
  await setImmediate();
  assert.deepEqual(bindingRequests, ['workspace-one']);
  bindingResult.resolve({
    ok: true,
    value: {
      ok: true,
      value: [{
        workspaceId: 'workspace-one',
        worktreeId: 'worktree-one',
        sessionId: 'parent-one',
        status: 'active',
      }],
    },
  });
  assert.equal(await forkPromise, 'child-one');
  for (const dispose of fixture.disposers.reverse()) dispose();
});

test('routes Worktree Session creation through the browser Session connector', async () => {
  const source = await readFile(path.join(packageDirectory, 'src', 'client', 'entry.ts'), 'utf8');
  assert.match(source, /createWorktreeSessionConnector/);
  assert.match(source, /worktreeSessionConnector\.create\(input\)/);
  assert.match(source, /worktreeSessionConnector\.dispose\(\)/);
  assert.doesNotMatch(source, /createSessionForWorktree\(\{/);
});

test('loads and disposes the Client entry through the DSH module handoff', async () => {
  const clientBundle = await readFile(path.join(packageDirectory, 'lib', 'client.js'), 'utf8');
  const registrations = [];
  const windowObject = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration);
      },
    },
  };

  const evaluate = new Function('window', clientBundle);
  evaluate(windowObject);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, packageManifest.name);

  const fixture = await loadClientEntry();
  assert.equal(typeof fixture.exports.apply, 'function');
  assert.deepEqual([...fixture.registrationsBySlot.keys()].sort(), [
    'conversation.session.header.actions',
    'shell.overlay',
    'sidebar.footer.action',
  ]);

  for (const dispose of fixture.disposers.reverse()) dispose();
  assert.equal(fixture.registrationsBySlot.size, 0);
});

test('contributes context to the active Session title row and the Hero overlay', async () => {
  const fixture = await loadClientEntry();
  assert.deepEqual([...fixture.registrationsBySlot.keys()].sort(), [
    'conversation.session.header.actions',
    'shell.overlay',
    'sidebar.footer.action',
  ]);
  assert.equal(
    fixture.registrationsBySlot.get('conversation.session.header.actions').options.order,
    -5,
  );
  const store = fixture.registrationsBySlot
    .get('conversation.session.header.actions')
    .options.inject().hooks.worktreeContext;
  assert.equal(typeof store.getSnapshot, 'function');
  const overlay = fixture.registrationsBySlot.get('shell.overlay').options.inject();
  assert.equal(overlay.hooks.worktreeContext, store);

  for (const dispose of fixture.disposers.reverse()) dispose();
});

test('shares one Worktree view reader between Context and Surface for one Client fiber', async () => {
  const pending = deferred();
  const calls = [];
  const fixture = await loadClientEntry({
    sessionListSnapshot: {
      phase: 'ready',
      ids: ['session-one'],
      byId: { 'session-one': { blank: false } },
      current: 'session-one',
    },
    workspaceSnapshot: {
      items: [
        {
          workspaceId: 'workspace-one',
          path: '/tmp/workspace-one',
          title: 'One',
          sessionIds: ['session-one'],
        },
        {
          workspaceId: 'workspace-two',
          path: '/tmp/workspace-two',
          title: 'Two',
          sessionIds: [],
        },
      ],
    },
    rpc: {
      call(_channel, endpoint) {
        calls.push(endpoint);
        return pending.promise;
      },
    },
  });
  const overlay = fixture.registrationsBySlot.get('shell.overlay').options.inject();
  const reader = overlay.viewReader;
  const surfaceRead = reader.read('workspace-one');

  assert.equal(typeof reader.readMany, 'function');
  assert.deepEqual(calls, [
    'worktreeManager/listWorktrees',
    'worktreeManager/listBranches',
    'worktreeManager/listBindings',
  ]);

  for (const dispose of fixture.disposers.reverse()) dispose();
  pending.resolve({ ok: true, value: { ok: true, value: [] } });
  await surfaceRead;
  await assert.rejects(reader.read('workspace-one'), /reader disposed/);

  const nextFixture = await loadClientEntry();
  const nextReader = nextFixture.registrationsBySlot.get('shell.overlay').options.inject()
    .viewReader;
  assert.notEqual(nextReader, reader);
  for (const dispose of nextFixture.disposers.reverse()) dispose();
});

test('declares the native Conversation package without depending on a Hero context seat', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const clientReadme = await readFile(new URL('../src/client/README.md', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/client/entry.ts', import.meta.url), 'utf8');

  assert.equal(
    manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'),
    true,
  );
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-conversation'], '*');
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-ui-conversation'], '0.1.1-rc.2');
  assert.match(clientReadme, /conversation\.session\.header\.actions/);
  assert.doesNotMatch(clientReadme, /conversation\.hero\.context/);
  assert.match(source, /conversation\.session\.header\.actions/);
  assert.doesNotMatch(source, /conversation\.hero\.context/);
});

test('declares the DSH locale service and namespace on both Client Slots', async () => {
  const source = await readFile(path.join(packageDirectory, 'src', 'client', 'entry.ts'), 'utf8');
  assert.match(source, /@deepseek-ai\/dsh-client-locale\/client/);
  assert.match(source, /locale:\s*WORKTREE_NS/);
  assert.equal(packageManifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'), true);

  const fixture = await loadClientEntry();
  assert.equal(fixture.fakeContext.localeRegistrations.length, 1);
  assert.equal(fixture.fakeContext.localeRegistrations[0].namespace, 'worktree');
  assert.deepEqual(Object.keys(fixture.fakeContext.localeRegistrations[0].dictionaries).sort(), [
    'en',
    'zh',
  ]);
  assert.equal(fixture.registrationsBySlot.get('sidebar.footer.action').options.locale, 'worktree');
  assert.equal(fixture.registrationsBySlot.get('shell.overlay').options.locale, 'worktree');

  for (const dispose of fixture.disposers.reverse()) dispose();
  assert.equal(fixture.fakeContext.localeRegistrations.length, 0);
});

test('disposes Client slot contributions through a real Cordis Client context', async () => {
  const clientBundle = await readFile(path.join(packageDirectory, 'lib', 'client.js'), 'utf8');
  const handoffs = [];
  new Function('window', clientBundle)({
    __ModuleLoader__: {
      load(handoff) {
        handoffs.push(handoff);
      },
    },
  });
  assert.equal(handoffs.length, 1);

  const [{ Context }, runtime, react, jsxRuntime, slots] = await Promise.all([
    import('@deepseek-ai/cordis'),
    loadRuntimeClientExports(),
    import('react'),
    import('react/jsx-runtime'),
    import('@deepseek-ai/dsh-client-ui-slots'),
  ]);
  const { SlotRegistry } = runtime;
  const { apply, inject } = handoffs[0].factory((specifier) => {
    if (specifier === '@deepseek-ai/dsh-client-runtime/client') return runtime;
    if (specifier === 'react') return react;
    if (specifier === 'react/jsx-runtime') return jsxRuntime;
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {};
    if (specifier === '@deepseek-ai/dsh-client-ui-slots') return slots;
    throw new Error(`unexpected browser module request: ${specifier}`);
  });

  const ctx = new Context();
  ctx.provide('connection', {
    rpc: {
      call: async () => ({ ok: true, value: { ok: true, value: [] } }),
    },
  });
  ctx.provide('locale', {
    register() {
      return () => {};
    },
  });
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ current: undefined }),
      subscribe: () => () => {},
    },
    open() {},
  });
  ctx.provide('workspaces', {
    list: {
      getSnapshot: () => ({ items: [] }),
      set() {},
      subscribe: () => () => {},
    },
    startSession() {},
  });
  const slotsFiber = ctx.plugin(SlotRegistry);
  await slotsFiber.await();
  const rootDisposer = ctx.slots.register(
    {
      name: 'root',
      children: {
        'conversation.session.header.actions': { kind: 'list', scope: 'session' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    },
    () => null,
  );

  try {
    const clientFiber = ctx.plugin({ inject, apply });
    await clientFiber.await();
    assert.equal(ctx.slots.entries('conversation.session.header.actions').length, 1);
    assert.equal(ctx.slots.entries('sidebar.footer.action').length, 1);
    assert.equal(ctx.slots.entries('shell.overlay').length, 1);

    await clientFiber.dispose();
    assert.equal(ctx.slots.entries('conversation.session.header.actions').length, 0);
    assert.equal(ctx.slots.entries('sidebar.footer.action').length, 0);
    assert.equal(ctx.slots.entries('shell.overlay').length, 0);
  } finally {
    rootDisposer();
    await ctx.fiber.dispose();
  }
});

test('Client fiber disposal aborts an in-flight Worktree Connection call', async () => {
  let signal;
  const fixture = await loadClientEntry({
    rpc: {
      call: (_channel, _endpoint, _payload, requestSignal) => {
        signal = requestSignal;
        return new Promise((_resolve, reject) => {
          requestSignal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      },
    },
  });
  const manager = fixture.registrationsBySlot.get('shell.overlay').options.inject().manager;
  const pending = manager.listWorktrees({ workspaceId: 'ws1' });

  for (const dispose of fixture.disposers.reverse()) dispose();

  assert.equal(signal.aborted, true);
  await assert.rejects(pending);
});

test('injects a separate structural expand-state store alongside view mode', async () => {
  const fixture = await loadClientEntry();
  const overlay = fixture.registrationsBySlot.get('shell.overlay');
  const injected = overlay.options.inject();
  const viewStore = overlay.options.store.create();

  assert.equal(typeof injected.expandState.getSnapshot, 'function');
  assert.equal(typeof injected.expandState.subscribe, 'function');
  assert.equal(typeof injected.expandState.actions.toggleWorkspace, 'function');
  assert.equal(typeof injected.expandState.actions.toggleMain, 'function');
  assert.equal(typeof injected.expandState.actions.toggleWorktree, 'function');
  assert.equal(typeof injected.expandState.actions.retain, 'function');
  assert.notEqual(injected.expandState, viewStore);

  for (const dispose of fixture.disposers.reverse()) dispose();
});

test('injects a separate browser-local Session order store', async () => {
  const fixture = await loadClientEntry();
  const overlay = fixture.registrationsBySlot.get('shell.overlay');
  const injected = overlay.options.inject();

  assert.equal(typeof injected.sessionOrder.getSnapshot, 'function');
  assert.equal(typeof injected.sessionOrder.subscribe, 'function');
  assert.equal(typeof injected.sessionOrder.actions.reconcile, 'function');
  assert.equal(typeof injected.sessionOrder.actions.setOrder, 'function');
  assert.notEqual(injected.sessionOrder, injected.expandState);

  for (const dispose of fixture.disposers.reverse()) dispose();
});
