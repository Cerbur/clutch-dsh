import { readFile } from 'node:fs/promises';
import path from 'node:path';

const packageDirectory = path.resolve('.');

/**
 * Evaluate the generated DSH Client handoff with the loader's injected module
 * table and a small slot/context fixture. The real Client loader owns the
 * same registration call; this fixture only supplies its platform modules.
 */
export async function loadClientEntry({ remote = {} } = {}) {
  const clientBundle = await readFile(path.join(packageDirectory, 'lib', 'client.js'), 'utf8');
  const registrations = [];
  const registrationsBySlot = new Map();
  const disposers = [];
  const openedSessions = [];
  const localStore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')?.value;

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

  const fakeContext = {
    remote,
    sessions: {
      list: { getSnapshot: () => ({ current: 'session-current' }) },
      open(sessionId) {
        openedSessions.push(sessionId);
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          items: [
            { workspaceId: 'workspace-current', title: 'Current', sessionIds: ['session-current'] },
          ],
          recentWorkspaceId: 'workspace-current',
        }),
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
    if (specifier === '@deepseek-ai/dsh-client-ui-slots') return {};
    throw new Error(`unexpected browser module request: ${specifier}`);
  });

  exports.apply(fakeContext);
  return { exports, fakeContext, registrationsBySlot, disposers, openedSessions };
}
