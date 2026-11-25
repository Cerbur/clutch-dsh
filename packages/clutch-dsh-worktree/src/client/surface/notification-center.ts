import { worktreeDiagnostics } from '../settings/diagnostics.js';
import { reconcileNotifications, type NotificationQueue, type WorktreeNotification } from './notification-queue.js';

/** All mounted client roots report to one FIFO. Only the shell subscribes to its toast head. */
export function createNotificationCenter(diagnostics: typeof worktreeDiagnostics) {
  const sources = new Map<string, readonly WorktreeNotification[]>();
  const listeners = new Set<() => void>();
  let queue: NotificationQueue = { seen: [], pending: [] };
  let generation = 0;
  const post = (apply: () => void) => {
    const owner = generation;
    queueMicrotask(() => { if (generation === owner) apply(); });
  };
  const update = (next: NotificationQueue) => {
    const previous = queue.pending[0];
    queue = next;
    if (previous !== next.pending[0]) listeners.forEach((listener) => listener());
  };
  const reconcile = () => update(reconcileNotifications(queue, [...sources.values()].flat()));
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => queue.pending[0],
    publish(source: string, notices: readonly WorktreeNotification[]) {
      post(() => {
        if (!sources.has(source) && notices.length === 0) return;
        diagnostics.publish(source, notices);
        if (notices.length) sources.set(source, notices);
        else sources.delete(source);
        reconcile();
      });
    },
    deactivate(source: string) {
      post(() => {
        if (!sources.delete(source)) return;
        diagnostics.deactivate(source);
        reconcile();
      });
    },
    recordInactive(source: string, notices: readonly WorktreeNotification[]) {
      post(() => diagnostics.recordInactive(source, notices));
    },
    dismiss(key: string) {
      post(() => {
        if (queue.pending[0]?.key === key) update({ ...queue, pending: queue.pending.slice(1) });
      });
    },
    dispose() {
      generation++;
      sources.clear();
      update({ seen: [], pending: [] });
      diagnostics.dispose();
    },
  };
}

export const worktreeNotifications = createNotificationCenter(worktreeDiagnostics);
