import { readFile } from 'node:fs/promises';
import path from 'node:path';

const packageDirectory = path.resolve('.');

/**
 * Evaluate the generated DSH Client handoff with the loader's injected module
 * table and a small slot/context fixture. The real Client loader owns the
 * same registration call; this fixture only supplies its platform modules.
 */
export async function loadClientEntry({
  remote = {},
  rpc,
  sessionListSnapshot,
  workspaceSnapshot: initialWorkspaceSnapshot,
  fork,
} = {}) {
  const clientBundle = await readFile(path.join(packageDirectory, 'lib', 'client.js'), 'utf8');
  const registrations = [];
  const registrationsBySlot = new Map();
  const disposers = [];
  const openedSessions = [];
  const startedSessions = [];
  const createdSessions = [];
  const createdWorkspaces = [];
  const forkCalls = [];
  const rpcCalls = [];
  const localeRegistrations = [];
  const localStore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')?.value;

  const normalizeWorkspaceSnapshot = (snapshot) => ({
    ...snapshot,
    items: (Array.isArray(snapshot?.items) ? snapshot.items : []).map((workspace) => ({
      ...workspace,
      createdAt: workspace.createdAt ?? '2026-01-01T00:00:00.000Z',
      updatedAt: workspace.updatedAt ?? '2026-01-01T00:00:00.000Z',
    })),
    archivedSessionIds: Array.isArray(snapshot?.archivedSessionIds)
      ? snapshot.archivedSessionIds
      : [],
    state: snapshot?.state ?? 'idle',
    phase: snapshot?.phase ?? 'ready',
    error: snapshot?.error ?? null,
  });

  const normalizeSessionSnapshot = (snapshot) => ({
    ...snapshot,
    ids: Array.isArray(snapshot?.ids) ? snapshot.ids : [],
    byId: snapshot?.byId !== undefined && snapshot.byId !== null
      ? snapshot.byId
      : {},
    current: snapshot?.current,
    phase: snapshot?.phase ?? 'ready',
    subagentsByParent: snapshot?.subagentsByParent ?? {},
    jobsBySession: snapshot?.jobsBySession ?? {},
    currentAddress: snapshot?.currentAddress,
  });

  let workspaceSnapshot = normalizeWorkspaceSnapshot(initialWorkspaceSnapshot ?? {
    items: [
      {
        workspaceId: 'workspace-current',
        path: '/tmp/workspace-current',
        title: 'Current',
        sessionIds: ['session-current'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  });
  const workspaceSubscribers = new Set();
  const workspaceList = {
    getSnapshot: () => workspaceSnapshot,
    subscribe(subscriber) {
      workspaceSubscribers.add(subscriber);
      return () => workspaceSubscribers.delete(subscriber);
    },
  };
  const setNativeWorkspaceSnapshot = (next) => {
    workspaceSnapshot = normalizeWorkspaceSnapshot(next);
    for (const subscriber of workspaceSubscribers) subscriber();
  };

  const connectionRpc = rpc ?? {
    call(channel, endpoint, payload, signal) {
      rpcCalls.push({ channel, endpoint, payload, signal });
      const input = payload.args.input;
      const value =
        endpoint === 'worktreeManager/createWorktree'
          ? {
              worktreeId: 'wt-created',
              ...input,
              absolutePath: '/tmp/wt-created',
              source: 'plugin',
              status: 'active',
            }
          : endpoint === 'worktreeManager/importWorktree'
            ? {
                worktreeId: 'wt-imported',
                ...input,
                branch: 'feature/external',
                source: 'external',
                status: 'active',
              }
          : endpoint === 'worktreeManager/bindSession'
            ? { ...input, status: 'active' }
            : endpoint === 'worktreeManager/removeWorktree'
              ? null
              : [];
      return Promise.resolve({ ok: true, value: { ok: true, value } });
    },
  };

  const defineStore = (spec) => ({
    spec,
    create() {
      let state = spec.init();
      if (spec.persist !== undefined && localStore !== undefined) {
        const raw = localStore.getItem(spec.persist);
        if (raw !== null) state = JSON.parse(raw);
      }
      const persist = () => {
        if (spec.persist !== undefined && localStore !== undefined) {
          localStore.setItem(spec.persist, JSON.stringify(state));
        }
      };
      return {
        actions: Object.fromEntries(
          Object.entries(spec.actions).map(([name, action]) => [
            name,
            (...args) => {
              const draft = { ...state };
              action(draft, ...args);
              state = draft;
              persist();
            },
          ]),
        ),
        getSnapshot: () => state,
        subscribe: () => () => {},
        clearPersisted: () => {},
      };
    },
  });

  const createSnapshotStore = (initial) => {
    let snapshot = initial;
    const subscribers = new Set();
    const publish = () => {
      for (const subscriber of subscribers) subscriber();
    };
    return {
      getSnapshot: () => snapshot,
      subscribe(subscriber) {
        subscribers.add(subscriber);
        return () => subscribers.delete(subscriber);
      },
      set(next) {
        snapshot = next;
        publish();
      },
      update(mutator) {
        const draft = globalThis.structuredClone(snapshot);
        mutator(draft);
        snapshot = draft;
        publish();
      },
    };
  };

  const locale = {
    register(namespace, dictionaries) {
      const entry = { namespace, dictionaries };
      localeRegistrations.push(entry);
      return () => {
        const index = localeRegistrations.indexOf(entry);
        if (index !== -1) localeRegistrations.splice(index, 1);
      };
    },
  };

  let currentSessionSnapshot = normalizeSessionSnapshot(sessionListSnapshot ?? {
    ids: ['session-current'],
    byId: {
      'session-current': {
        id: 'session-current',
        displayTitle: 'Current',
        running: false,
        blank: false,
        cwd: '/tmp/workspace-current',
        updatedAt: 1,
      },
    },
    current: 'session-current',
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  });
  const sessionSubscribers = new Set();
  const sessionList = {
    getSnapshot: () => currentSessionSnapshot,
    set(next) {
      currentSessionSnapshot = next;
      for (const subscriber of sessionSubscribers) subscriber();
    },
    subscribe(subscriber) {
      sessionSubscribers.add(subscriber);
      return () => sessionSubscribers.delete(subscriber);
    },
  };
  const fakeSessions = {
    list: sessionList,
    async create(input) {
      createdSessions.push(input);
      return 'session-created';
    },
    open(sessionId) {
      openedSessions.push(sessionId);
    },
  };
  if (fork !== undefined) {
    fakeSessions.fork = async (input) => {
      forkCalls.push(input);
      return fork(input);
    };
  }
  const nativeFork = fakeSessions.fork;

  const fakeContext = {
    connection: { rpc: connectionRpc },
    locale,
    localeRegistrations,
    remote,
    sessions: fakeSessions,
    workspaces: {
      list: workspaceList,
      async create(input) {
        createdWorkspaces.push(input);
        return input.path;
      },
      async rename() {},
      async delete() {},
      async insertBefore() {},
      async insertSessionBefore() {},
      async archiveSession() {},
    },
    uiWorkspace: {
      pickDirectory() {
        return Promise.resolve('/tmp/workspace-picked');
      },
      startSession(workspaceId) {
        startedSessions.push(workspaceId);
      },
    },
    slots: {
      inject(key, callback) {
        const dispose = callback();
        const controller = () => {
          dispose?.();
          registrationsBySlot.delete(key);
        };
        disposers.push(controller);
        return controller;
      },
      register(options, component) {
        registrationsBySlot.set(options.name, { options, component });
        return () => {
          registrationsBySlot.delete(options.name);
        };
      },
    },
    effect(callback) {
      const dispose = callback();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
  };

  const windowObject = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration);
      },
    },
  };
  new Function('window', clientBundle)(windowObject);
  const exports = registrations[0].factory((specifier) => {
    if (specifier === '@deepseek-ai/dsh-client-store') {
      return { createSnapshotStore, defineStore };
    }
    if (specifier === 'react/jsx-runtime') {
      return { Fragment: Symbol('Fragment'), jsx: () => null, jsxs: () => null };
    }
    if (specifier === 'react') return {};
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {};
    if (specifier === '@deepseek-ai/dsh-client-ui-slots') return {};
    throw new Error(`unexpected browser module request: ${specifier}`);
  });

  exports.apply(fakeContext);
  return {
    exports,
    fakeContext,
    registrationsBySlot,
    disposers,
    openedSessions,
    startedSessions,
    createdSessions,
    createdWorkspaces,
    forkCalls,
    nativeFork,
    rpcCalls,
    setWorkspaceSnapshot(next) {
      setNativeWorkspaceSnapshot(next);
    },
    setSessionListSnapshot(next) {
      sessionList.set(normalizeSessionSnapshot(next));
    },
  };
}
