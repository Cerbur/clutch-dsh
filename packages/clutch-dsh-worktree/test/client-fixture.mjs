import { readFile } from 'node:fs/promises';
import path from 'node:path';

const packageDirectory = path.resolve('.');

/**
 * Evaluate the generated DSH Client handoff with the loader's injected module
 * table and a small slot/context fixture. The real Client loader owns the
 * same registration call; this fixture only supplies its platform modules.
 */
export async function loadClientEntry({ remote = {}, rpc } = {}) {
  const clientBundle = await readFile(path.join(packageDirectory, 'lib', 'client.js'), 'utf8');
  const registrations = [];
  const registrationsBySlot = new Map();
  const disposers = [];
  const openedSessions = [];
  const startedSessions = [];
  const createdSessions = [];
  const rpcCalls = [];
  const localeRegistrations = [];
  const localStore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')?.value;

  let workspaceSnapshot = {
    items: [
      { workspaceId: 'workspace-current', title: 'Current', sessionIds: ['session-current'] },
    ],
    recentWorkspaceId: 'workspace-current',
  };
  const workspaceSubscribers = new Set();
  const workspaceList = {
    getSnapshot: () => workspaceSnapshot,
    set(next) {
      workspaceSnapshot = next;
      for (const subscriber of workspaceSubscribers) subscriber();
    },
    subscribe(subscriber) {
      workspaceSubscribers.add(subscriber);
      return () => workspaceSubscribers.delete(subscriber);
    },
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

  const fakeContext = {
    connection: { rpc: connectionRpc },
    locale,
    localeRegistrations,
    remote,
    sessions: {
      list: { getSnapshot: () => ({ current: 'session-current' }) },
      async create(input) {
        createdSessions.push(input);
        return 'session-created';
      },
      open(sessionId) {
        openedSessions.push(sessionId);
      },
    },
    workspaces: {
      list: workspaceList,
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
    if (specifier === '@deepseek-ai/dsh-client-runtime/client') return { defineStore };
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
    rpcCalls,
  };
}
