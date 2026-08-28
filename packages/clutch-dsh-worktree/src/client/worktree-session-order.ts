import type {
  createSnapshotStore as runtimeCreateSnapshotStore,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client';

/** Browser-only persistence key; this state never crosses the DSH or sidecar boundary. */
export const WORKTREE_SESSION_ORDER_STORAGE_KEY = 'clutch-dsh-worktree.session-order';

export interface SessionOrderAccountState {
  order: string[];
  observedUpdatedAt: Record<string, number>;
}

export interface WorktreeSessionOrderState {
  accounts: Record<string, SessionOrderAccountState>;
}

export interface WorktreeSessionOrderActions {
  reconcile: (
    accountKey: string,
    baseIds: readonly string[],
    updatedAtById: Readonly<Record<string, number | undefined>>,
  ) => void;
  setOrder: (accountKey: string, order: readonly string[]) => void;
  retain: (accountKeys: readonly string[]) => void;
}

export interface WorktreeSessionOrderStore extends SnapshotStore<WorktreeSessionOrderState> {
  readonly actions: WorktreeSessionOrderActions;
  readonly dispose: () => void;
}

export type SnapshotStoreFactory = typeof runtimeCreateSnapshotStore;

function emptyState(): WorktreeSessionOrderState {
  return { accounts: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeAccount(value: unknown): SessionOrderAccountState | undefined {
  if (!isRecord(value)) return undefined;
  const order = normalizeIds(value.order);
  const allowed = new Set(order);
  const observedUpdatedAt: Record<string, number> = {};
  if (isRecord(value.observedUpdatedAt)) {
    for (const [id, timestamp] of Object.entries(value.observedUpdatedAt)) {
      if (allowed.has(id) && isValidTimestamp(timestamp)) observedUpdatedAt[id] = timestamp;
    }
  }
  return { order, observedUpdatedAt };
}

/** Normalize persisted state without trusting any browser-local JSON shape. */
export function normalizeWorktreeSessionOrderState(value: unknown): WorktreeSessionOrderState {
  if (!isRecord(value) || !isRecord(value.accounts)) return emptyState();
  const accounts: Record<string, SessionOrderAccountState> = {};
  for (const [accountKey, account] of Object.entries(value.accounts)) {
    if (accountKey.length === 0) continue;
    const normalized = normalizeAccount(account);
    if (normalized !== undefined) accounts[accountKey] = normalized;
  }
  return { accounts };
}

function validIds(ids: readonly string[]): string[] {
  return normalizeIds([...ids]);
}

function sameRecord(
  left: Readonly<Record<string, number>> | undefined,
  right: Readonly<Record<string, number>>,
): boolean {
  if (left === undefined) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return rightKeys.every((key) => left[key] === right[key]);
}

function sameAccount(
  left: SessionOrderAccountState | undefined,
  right: SessionOrderAccountState,
): boolean {
  return (
    left !== undefined &&
    left.order.length === right.order.length &&
    left.order.every((id, index) => id === right.order[index]) &&
    sameRecord(left.observedUpdatedAt, right.observedUpdatedAt)
  );
}

/**
 * Native-style activity order transition. The first observation records timestamps
 * without turning an existing list into a recency sort.
 */
export function nextSessionOrderAccount(input: {
  readonly baseIds: readonly string[];
  readonly updatedAtById: Readonly<Record<string, number | undefined>>;
  readonly previous?: Readonly<SessionOrderAccountState>;
}): SessionOrderAccountState {
  const baseIds = validIds(input.baseIds);
  const previous = input.previous;
  if (previous === undefined) {
    const observedUpdatedAt: Record<string, number> = {};
    for (const id of baseIds) {
      const timestamp = input.updatedAtById[id];
      if (isValidTimestamp(timestamp)) observedUpdatedAt[id] = timestamp;
    }
    return { order: baseIds, observedUpdatedAt };
  }

  const available = new Set(baseIds);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of previous.order) {
    if (available.has(id) && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of baseIds) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }

  const observedUpdatedAt: Record<string, number> = {};
  const promoted: { id: string; timestamp: number; index: number }[] = [];
  for (const [index, id] of order.entries()) {
    const previousTimestamp = previous.observedUpdatedAt[id];
    const timestamp = input.updatedAtById[id];
    if (isValidTimestamp(previousTimestamp)) observedUpdatedAt[id] = previousTimestamp;
    if (isValidTimestamp(timestamp)) {
      if (!isValidTimestamp(previousTimestamp) || timestamp > previousTimestamp) {
        if (isValidTimestamp(previousTimestamp)) {
          promoted.push({ id, timestamp, index });
        }
        observedUpdatedAt[id] = Math.max(observedUpdatedAt[id] ?? timestamp, timestamp);
      }
    }
  }

  promoted.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const promotedIds = new Set(promoted.map(({ id }) => id));
  return {
    order: [...promoted.map(({ id }) => id), ...order.filter((id) => !promotedIds.has(id))],
    observedUpdatedAt,
  };
}

/** Apply a successful manual drag without dropping IDs hidden by search. */
export function reorderSessionIds(
  order: readonly string[],
  sessionId: string,
  overSessionId: string,
  half: 'before' | 'after',
): string[] {
  const next = order.filter((id) => id !== sessionId);
  const targetIndex = next.indexOf(overSessionId);
  if (targetIndex === -1) return [...order];
  next.splice(half === 'before' ? targetIndex : targetIndex + 1, 0, sessionId);
  return next;
}

function cloneAccount(account: SessionOrderAccountState): SessionOrderAccountState {
  return {
    order: [...account.order],
    observedUpdatedAt: { ...account.observedUpdatedAt },
  };
}

/** Create one apply-scoped, browser-local Session ordering store. */
export function createWorktreeSessionOrderStore(
  snapshotStoreFactory: SnapshotStoreFactory,
): WorktreeSessionOrderStore {
  let store: SnapshotStore<WorktreeSessionOrderState>;
  try {
    store = snapshotStoreFactory<WorktreeSessionOrderState>(emptyState(), {
      persist: { name: WORKTREE_SESSION_ORDER_STORAGE_KEY },
    });
  } catch {
    store = snapshotStoreFactory<WorktreeSessionOrderState>(emptyState());
  }

  store.set(normalizeWorktreeSessionOrderState(store.getSnapshot()));
  let disposed = false;
  const actions: WorktreeSessionOrderActions = {
    reconcile: (accountKey, baseIds, updatedAtById) => {
      if (disposed || accountKey.length === 0) return;
      store.update((draft) => {
        const next = nextSessionOrderAccount({
          baseIds,
          updatedAtById,
          previous: draft.accounts[accountKey],
        });
        if (sameAccount(draft.accounts[accountKey], next)) return;
        draft.accounts[accountKey] = cloneAccount(next);
      });
    },
    setOrder: (accountKey, order) => {
      if (disposed || accountKey.length === 0) return;
      store.update((draft) => {
        const current = draft.accounts[accountKey] ?? {
          order: [],
          observedUpdatedAt: {},
        };
        const next = {
          order: validIds(order),
          observedUpdatedAt: { ...current.observedUpdatedAt },
        };
        if (sameAccount(current, next)) return;
        draft.accounts[accountKey] = next;
      });
    },
    retain: (accountKeys) => {
      if (disposed) return;
      store.update((draft) => {
        const allowed = new Set(accountKeys);
        for (const accountKey of Object.keys(draft.accounts)) {
          if (!allowed.has(accountKey)) delete draft.accounts[accountKey];
        }
      });
    },
  };

  return Object.assign(store, {
    actions,
    dispose: () => {
      disposed = true;
    },
  });
}
