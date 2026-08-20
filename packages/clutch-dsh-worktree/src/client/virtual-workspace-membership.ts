import {
  projectVirtualWorkspaceMembership,
  type VirtualWorkspaceBinding,
} from './view-mode.js';

/** The writable face of DSH's in-memory Workspace list store. */
export interface WritableWorkspaceList<T extends { readonly items: readonly unknown[] }> {
  getSnapshot(): T;
  set(next: T): void;
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

function sameWorkspaceItems<T extends { readonly items: readonly unknown[] }>(
  left: T,
  right: T,
): boolean {
  if (left.items.length !== right.items.length) return false;
  return left.items.every((item, index) => {
    const other = right.items[index];
    if (item === other) return true;
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof other !== 'object' ||
      other === null ||
      !('workspaceId' in item) ||
      !('workspaceId' in other) ||
      !('sessionIds' in item) ||
      !('sessionIds' in other)
    ) {
      return false;
    }
    const leftSessionIds = item.sessionIds;
    const rightSessionIds = other.sessionIds;
    return (
      item.workspaceId === other.workspaceId &&
      Array.isArray(leftSessionIds) &&
      Array.isArray(rightSessionIds) &&
      leftSessionIds.length === rightSessionIds.length &&
      leftSessionIds.every((sessionId, sessionIndex) => sessionId === rightSessionIds[sessionIndex])
    );
  });
}

/**
 * Maintains a re-playable in-memory overlay over DSH's Workspace list. Native
 * refreshes are observed and the current sidecar bindings are applied again;
 * no DSH Host mutation or persistence is involved.
 */
export function createVirtualWorkspaceMembership<
  T extends {
    readonly items: readonly {
      readonly workspaceId: string;
      readonly sessionIds: readonly string[];
    }[];
  },
>(list: WritableWorkspaceList<T>): VirtualWorkspaceMembership {
  let bindings: readonly VirtualWorkspaceBinding[] = [];
  let disposed = false;
  let applying = false;

  const apply = (nextBindings: readonly VirtualWorkspaceBinding[]): void => {
    const current = list.getSnapshot();
    const next = projectVirtualWorkspaceMembership(current, bindings, nextBindings);
    if (sameWorkspaceItems(current, next)) return;
    applying = true;
    try {
      list.set(next);
    } finally {
      applying = false;
    }
  };

  const replay = (): void => {
    if (disposed || applying) return;
    apply(bindings);
  };
  const unsubscribe = list.subscribe(replay);

  const sync = (nextBindings: readonly VirtualWorkspaceBinding[]): void => {
    if (disposed) return;
    const normalized = normalizeBindings(nextBindings);
    apply(normalized);
    bindings = normalized;
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
      apply([]);
      bindings = [];
      disposed = true;
      unsubscribe();
    },
  };
}
