import { worktreeDiagnostics } from '../settings/diagnostics.js';
import { formatWorktreeViewError } from '../view/worktree-error-copy.js';
import type { WorktreeViewError } from '../view/worktree-view-errors.js';
import { failureToastKey, shouldAnnounce, type WorktreeNotification } from './notification-queue.js';

/** All mounted client roots report to one FIFO. Only the shell subscribes to its toast head. */
export function createNotificationCenter(diagnostics: typeof worktreeDiagnostics) {
  // Occurrences survive batched renders. Only eligible, undismissed events live here.
  const pending = new Map<string, WorktreeNotification>();
  let sequence = 0;
  const nextId = () => 'occurrence:' + ++sequence;
  const listeners = new Set<() => void>();
  let head: WorktreeNotification | undefined;
  let generation = 0;
  const post = (apply: () => void) => {
    const owner = generation;
    queueMicrotask(() => { if (generation === owner) apply(); });
  };
  const updateHead = () => {
    const next = pending.values().next().value;
    if (next === head) return;
    head = next;
    listeners.forEach(listener => listener());
  };
  const report = (notice: WorktreeNotification): string => {
    const reportId = nextId();
    const event = { ...notice, key: reportId, reportId, toastKey: notice.toastKey ?? reportId };
    post(() => {
      diagnostics.record(reportId, [event], notice.origin === 'retired' ? 'inactive' : 'reported');
      if (shouldAnnounce(event) && ![...pending.values()].some(item => item.toastKey === event.toastKey)) {
        pending.set(reportId, event);
        updateHead();
      }
    });
    return reportId;
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => head,
    report,
    reportError(error: WorktreeViewError, options: Pick<WorktreeNotification,
      'origin' | 'toastKey' | 'context' | 'describe' | 'message'> = {}): WorktreeViewError & { reportId: string } {
      const reportId = report({ key: error.code, text: '', error, toastKey: failureToastKey(error),
        message: translate => formatWorktreeViewError(error, translate), ...options });
      return { ...error, reportId };
    },
    updateRecovery(source: string, notices: readonly WorktreeNotification[]) {
      post(() => {
        const records = notices.flatMap(notice => {
          const reportId = notice.reportId ?? notice.error?.reportId;
          if (reportId === undefined) return [];
          const queued = pending.get(reportId);
          if (queued) pending.set(reportId, { ...queued, text: notice.text, message: notice.message });
          return { ...notice, reportId };
        });
        diagnostics.updateRecovery(source, records);
        updateHead();
      });
    },
    resolve(reportId: string) {
      post(() => diagnostics.resolve(reportId));
    },
    deactivate(source: string) {
      post(() => diagnostics.deactivate(source));
    },
    dismiss(key: string) {
      post(() => {
        if (head?.key !== key) return;
        pending.delete(key);
        updateHead();
      });
    },
    dispose() {
      generation++;
      pending.clear();
      updateHead();
      diagnostics.dispose();
    },
  };
}

export const worktreeNotifications = createNotificationCenter(worktreeDiagnostics);
