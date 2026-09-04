import {
  projectVirtualWorkspaceMembership,
  type VirtualWorkspaceBinding,
} from './view-mode.js';

/** The read-only snapshot face published by DSH's Workspace Controller. */
export interface WorkspaceSnapshotSource<
  T extends { readonly items: readonly unknown[] },
> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export interface VirtualWorkspaceMembership {
  ensure(binding: VirtualWorkspaceBinding): void;
  sync(bindings: readonly VirtualWorkspaceBinding[]): void;
  removeSession(sessionId: string): void;
  dispose(): void;
}

function normalizeBindings(bindings: readonly VirtualWorkspaceBinding[]): VirtualWorkspaceBinding[] {
  const bySession = new Map<string, VirtualWorkspaceBinding>();
  for (const binding of bindings) {
    if (binding.workspaceId.length === 0 || binding.sessionId.length === 0) continue;
    bySession.set(binding.sessionId, binding);
  }
  return [...bySession.values()];
}

function sameBindings(
  left: readonly VirtualWorkspaceBinding[],
  right: readonly VirtualWorkspaceBinding[],
): boolean {
  return left.length === right.length && left.every((binding, index) => {
    const other = right[index];
    return binding.workspaceId === other.workspaceId && binding.sessionId === other.sessionId;
  });
}

type WorkspaceSnapshotWithItems = {
  readonly items: readonly {
    readonly workspaceId: string;
    readonly sessionIds: readonly string[];
  }[];
};

/**
 * Decorate DSH's read-only WorkspaceSource with a browser-local membership
 * projection. The source's native model is never written: the wrapper keeps
 * the current sidecar bindings in memory, reprojects every native snapshot,
 * and publishes only the projected view to subscribers.
 */
export function createVirtualWorkspaceMembership<
  T extends WorkspaceSnapshotWithItems,
>(list: WorkspaceSnapshotSource<T>): VirtualWorkspaceMembership {
  if (!Object.isExtensible(list)) {
    throw new Error('Workspace membership projection requires an extensible WorkspaceSource');
  }

  const nativeGetSnapshot = list.getSnapshot.bind(list);
  const nativeSubscribe = list.subscribe.bind(list);
  const originalGetSnapshot = Object.getOwnPropertyDescriptor(list, 'getSnapshot');
  const originalSubscribe = Object.getOwnPropertyDescriptor(list, 'subscribe');
  const listeners = new Set<() => void>();
  let bindings: readonly VirtualWorkspaceBinding[] = [];
  let nativeSnapshot = nativeGetSnapshot();
  let projectedSnapshot = projectVirtualWorkspaceMembership(
    nativeSnapshot,
    [],
    bindings,
  );
  let disposed = false;

  const project = (
    nextNativeSnapshot: T,
    previousBindings: readonly VirtualWorkspaceBinding[],
    nextBindings: readonly VirtualWorkspaceBinding[],
  ): T => projectVirtualWorkspaceMembership(
    nextNativeSnapshot,
    previousBindings,
    nextBindings,
  );

  const refreshSnapshot = (): boolean => {
    const nextNativeSnapshot = nativeGetSnapshot();
    if (nextNativeSnapshot === nativeSnapshot) return false;
    nativeSnapshot = nextNativeSnapshot;
    const nextProjectedSnapshot = project(nextNativeSnapshot, bindings, bindings);
    const changed = nextProjectedSnapshot !== projectedSnapshot;
    projectedSnapshot = nextProjectedSnapshot;
    return changed;
  };

  const notify = (): void => {
    if (disposed) return;
    refreshSnapshot();
    for (const listener of [...listeners]) listener();
  };

  const getSnapshot = (): T => {
    if (disposed) return nativeGetSnapshot();
    refreshSnapshot();
    return projectedSnapshot as T;
  };

  const subscribe = (listener: () => void): (() => void) => {
    if (disposed) return () => undefined;
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  Object.defineProperty(list, 'getSnapshot', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: getSnapshot,
  });
  Object.defineProperty(list, 'subscribe', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: subscribe,
  });
  const unsubscribeNative = nativeSubscribe(notify);

  const sync = (nextBindings: readonly VirtualWorkspaceBinding[]): void => {
    if (disposed) return;
    const normalized = normalizeBindings(nextBindings);
    if (sameBindings(bindings, normalized)) return;
    const previousBindings = bindings;
    bindings = normalized;
    nativeSnapshot = nativeGetSnapshot();
    const previousProjectedSnapshot = projectedSnapshot;
    projectedSnapshot = project(nativeSnapshot, previousBindings, bindings);
    if (projectedSnapshot === previousProjectedSnapshot) return;
    for (const listener of [...listeners]) listener();
  };

  const restoreMethod = (
    name: 'getSnapshot' | 'subscribe',
    descriptor: PropertyDescriptor | undefined,
  ): void => {
    if (descriptor === undefined) {
      delete (list as unknown as Record<string, unknown>)[name];
      return;
    }
    Object.defineProperty(list, name, descriptor);
  };

  return {
    ensure(binding) {
      if (disposed) return;
      if (
        bindings.some(
          (current) =>
            current.workspaceId === binding.workspaceId && current.sessionId === binding.sessionId,
        )
      ) {
        return;
      }
      sync([...bindings.filter((current) => current.sessionId !== binding.sessionId), binding]);
    },
    sync,
    removeSession(sessionId) {
      sync(bindings.filter((binding) => binding.sessionId !== sessionId));
    },
    dispose() {
      if (disposed) return;
      bindings = [];
      projectedSnapshot = nativeGetSnapshot();
      disposed = true;
      for (const listener of [...listeners]) listener();
      unsubscribeNative();
      listeners.clear();
      restoreMethod('getSnapshot', originalGetSnapshot);
      restoreMethod('subscribe', originalSubscribe);
    },
  };
}
