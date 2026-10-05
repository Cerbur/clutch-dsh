import type { WorktreeNotification } from '../surface/notification-queue.js';

export interface WorktreeDiagnostic extends WorktreeNotification {
  readonly source: string;
  readonly status: 'active' | 'resolved' | 'inactive';
  readonly actions: NonNullable<WorktreeNotification['actions']>;
}

/** Browser-memory history. Unmount is not proof of recovery; stale actions are revoked. */
export function createWorktreeDiagnostics() {
  let snapshot: readonly WorktreeDiagnostic[] = [];
  const sources = new Map<string, readonly WorktreeNotification[]>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const limitHistory = () => {
    const history = snapshot.filter((entry) => entry.status !== 'active').slice(-100);
    snapshot = [...history, ...snapshot.filter((entry) => entry.status === 'active')];
  };
  const retire = (source: string, status: 'resolved' | 'inactive', keys = new Set<string>()) => {
    snapshot = snapshot.map((entry) =>
      entry.source === source && entry.status === 'active' && !keys.has(entry.key)
        ? { ...entry, status, actions: [] }
        : entry,
    );
    limitHistory();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish(source: string, notices: readonly WorktreeNotification[]) {
      sources.set(source, notices);
      retire(source, 'resolved', new Set(notices.map((notice) => notice.key)));
      for (const notice of notices) {
        const entry: WorktreeDiagnostic = {
          ...notice, source, status: 'active',
          actions: (notice.actions ?? []).map((action) => ({
            ...action,
            onClick: () => {
              const current = sources.get(source)?.find((item) => item.key === notice.key)?.actions
                ?.find((item) => item.label === action.label);
              if (current !== undefined && !current.disabled) current.onClick();
            },
          })),
        };
        snapshot = [...snapshot.filter((item) => item.key !== notice.key), entry];
      }
      // Keep active recoveries even when many historical failures have accumulated.
      limitHistory();
      emit();
    },
    deactivate(source: string) {
      sources.delete(source);
      retire(source, 'inactive');
      emit();
    },
    clearHistory() {
      snapshot = snapshot.filter((entry) => entry.status === 'active');
      emit();
    },
    dispose() {
      sources.clear();
      snapshot = [];
      emit();
    },
  };
}

// Shared by the native Settings seat and surface within one loaded Client module.
export const worktreeDiagnostics = createWorktreeDiagnostics();
