import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { SlotCore, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';

const NATIVE_FLOW = 'sidebar.workspaces.directoryFlow';
const WORKTREE_FLOW = 'clutch.worktree.directoryFlow';

export interface WorkspaceDirectoryFlowState {
  readonly available: boolean;
  readonly owner: DirectoryFlowOwnerProps;
}

type FlowRegistry = Pick<SlotCore, 'entriesOfSlot' | 'subscribe'> & {
  inject: (key: typeof WORKTREE_FLOW, callback: () => () => void) => () => void;
  register: SlotCore['register'];
};

/** Re-register an already type-checked root flow with its original injected face. */
type RegisterComposedFlow = (
  options: Pick<StoredEntry, 'inject' | 'store' | 'locale'> & { name: typeof WORKTREE_FLOW },
  component: StoredEntry['component'],
) => () => void;

/** The composed picker owns selection; Worktree owns only adoption and its pending action. */
export function createWorkspaceDirectoryFlow(slots: FlowRegistry, adopt: (path: string) => Promise<void>) {
  const idle: DirectoryFlowOwnerProps = {
    open: false, busy: false, onPicked() {}, onCancel() {}, onError() {},
  };
  const store = createSnapshotStore<WorkspaceDirectoryFlowState>({ available: false, owner: idle });
  let pending: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void; busy: boolean } | undefined;
  let disposed = false;
  const cancel = () => {
    const request = pending;
    pending = undefined;
    store.set({ ...store.getSnapshot(), owner: idle });
    request?.resolve();
  };

  // The native browser keeps its declaration even while our sidebar seat wins.
  // Mirror its elected picker into our own child hole: redeclaring the native
  // hole or rendering it through ctx.slots would violate renderer ownership.
  const stop = slots.inject(WORKTREE_FLOW, () => {
    let current: StoredEntry | undefined;
    let remove: (() => void) | undefined;
    const sync = () => {
      const next = slots.entriesOfSlot(NATIVE_FLOW)[0];
      if (next === current) return;
      cancel();
      remove?.();
      current = next;
      remove = next === undefined ? undefined : (slots.register as RegisterComposedFlow)({
        name: WORKTREE_FLOW,
        ...(next.inject === undefined ? {} : { inject: next.inject }),
        ...(next.store === undefined ? {} : { store: next.store }),
        ...(next.locale === undefined ? {} : { locale: next.locale }),
      }, next.component);
      store.set({ available: next !== undefined, owner: idle });
    };
    const unsubscribe = slots.subscribe(NATIVE_FLOW, sync);
    sync();
    return () => { unsubscribe(); remove?.(); cancel(); store.set({ available: false, owner: idle }); };
  });

  const request = (): Promise<void> => {
    if (pending !== undefined) return pending.promise;
    if (disposed || !store.getSnapshot().available) return Promise.resolve();
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const active = { promise, resolve, reject, busy: false };
    pending = active;
    const finish = (error?: Error) => {
      if (pending !== active) return;
      pending = undefined;
      store.set({ ...store.getSnapshot(), owner: idle });
      if (error) reject(error);
      else resolve();
    };
    const owner: DirectoryFlowOwnerProps = {
      open: true, busy: false,
      onPicked: (path) => {
        if (pending !== active || active.busy) return;
        active.busy = true;
        store.set({ available: true, owner: { ...owner, busy: true } });
        void Promise.resolve().then(() => {
          if (pending === active) return adopt(path);
        }).then(() => finish(), (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
      },
      onCancel: () => { if (!active.busy) finish(); },
      onError: (message) => { if (!active.busy) finish(new Error(message)); },
    };
    store.set({ available: true, owner });
    return promise;
  };
  return { store, request, cancel, dispose: () => { disposed = true; stop(); cancel(); } };
}
