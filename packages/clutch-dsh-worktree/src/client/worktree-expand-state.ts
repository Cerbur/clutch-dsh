import type {
  createSnapshotStore as runtimeCreateSnapshotStore,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client';

/** Browser-local storage identity; never sent to DSH or the plugin sidecar. */
export const WORKTREE_EXPAND_STATE_STORAGE_KEY = 'clutch-dsh-worktree.expand-state';

/** Persisted structural exceptions; absent IDs are expanded. */
export interface WorktreeExpandState {
  collapsedWorkspaceIds: Record<string, true>;
  collapsedMainWorkspaceIds: Record<string, true>;
  collapsedWorktreeIds: Record<string, true>;
}

/** The browser-facing mutation set for the expand-state store. */
export interface WorktreeExpandStateActions {
  toggleWorkspace: (workspaceId: string) => void;
  toggleMain: (workspaceId: string) => void;
  toggleWorktree: (worktreeId: string) => void;
  retain: (workspaceIds: readonly string[], worktreeIds: readonly string[]) => void;
}

/** Observable expand state plus browser-facing actions. */
export interface WorktreeExpandStateStore extends SnapshotStore<WorktreeExpandState> {
  readonly actions: WorktreeExpandStateActions;
}

/**
 * The public rc.8 SnapshotStore factory consumed by this browser-local state.
 * Task 3's client entry must pass the runtime `createSnapshotStore` here.
 */
export type SnapshotStoreFactory = typeof runtimeCreateSnapshotStore;

function emptyState(): WorktreeExpandState {
  return {
    collapsedWorkspaceIds: {},
    collapsedMainWorkspaceIds: {},
    collapsedWorktreeIds: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeIds(value: unknown): Record<string, true> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([id, collapsed]) => id.length > 0 && collapsed === true),
  ) as Record<string, true>;
}

/** Turn any persisted JSON value into the current state shape. */
export function normalizeWorktreeExpandState(value: unknown): WorktreeExpandState {
  const source = isRecord(value) ? value : {};
  return {
    collapsedWorkspaceIds: normalizeIds(source.collapsedWorkspaceIds),
    collapsedMainWorkspaceIds: normalizeIds(source.collapsedMainWorkspaceIds),
    collapsedWorktreeIds: normalizeIds(source.collapsedWorktreeIds),
  };
}

export function isWorkspaceExpanded(state: WorktreeExpandState, workspaceId: string): boolean {
  return state.collapsedWorkspaceIds[workspaceId] !== true;
}

export function isMainExpanded(state: WorktreeExpandState, workspaceId: string): boolean {
  return state.collapsedMainWorkspaceIds[workspaceId] !== true;
}

export function isWorktreeExpanded(state: WorktreeExpandState, worktreeId: string): boolean {
  return state.collapsedWorktreeIds[worktreeId] !== true;
}

function toggle(record: Record<string, true>, id: string): void {
  if (record[id] === true) delete record[id];
  else record[id] = true;
}

function retain(record: Record<string, true>, ids: readonly string[]): void {
  const allowed = new Set(ids);
  for (const id of Object.keys(record)) {
    if (!allowed.has(id)) delete record[id];
  }
}

/** Create one apply-scoped store; component remounts share this instance. */
export function createWorktreeExpandStateStore(
  snapshotStoreFactory: SnapshotStoreFactory,
): WorktreeExpandStateStore {
  let store: SnapshotStore<WorktreeExpandState>;
  try {
    store = snapshotStoreFactory<WorktreeExpandState>(emptyState(), {
      persist: { name: WORKTREE_EXPAND_STATE_STORAGE_KEY },
    });
  } catch {
    // A throwing browser storage getter can fail before runtime persistence's own guard.
    store = snapshotStoreFactory<WorktreeExpandState>(emptyState());
  }

  // Runtime persistence handles invalid JSON; normalize valid but wrong-shaped JSON.
  store.set(normalizeWorktreeExpandState(store.getSnapshot()));

  const actions: WorktreeExpandStateActions = {
    toggleWorkspace: (workspaceId) => {
      store.update((draft) => { toggle(draft.collapsedWorkspaceIds, workspaceId); });
    },
    toggleMain: (workspaceId) => {
      store.update((draft) => { toggle(draft.collapsedMainWorkspaceIds, workspaceId); });
    },
    toggleWorktree: (worktreeId) => {
      store.update((draft) => { toggle(draft.collapsedWorktreeIds, worktreeId); });
    },
    retain: (workspaceIds, worktreeIds) => {
      store.update((draft) => {
        retain(draft.collapsedWorkspaceIds, workspaceIds);
        retain(draft.collapsedMainWorkspaceIds, workspaceIds);
        retain(draft.collapsedWorktreeIds, worktreeIds);
      });
    },
  };

  return Object.assign(store, { actions });
}
