import { worktreeDiagnostics } from '../settings/diagnostics.js';
import { formatWorktreeViewError } from '../view/worktree-error-copy.js';
import type { ReportId, WorktreeViewError } from '../view/worktree-view-errors.js';
import { failureToastKey, shouldAnnounce, type WorktreeNotification } from './notification-queue.js';

/** All mounted client roots report to one FIFO. Only the shell subscribes to its toast head. */
export function createNotificationCenter(diagnostics: typeof worktreeDiagnostics) {
  // Occurrences survive batched renders. Only eligible, undismissed events live here.
  const pending = new Map<string, WorktreeNotification>();
  let sequence = 0;
  const keyOf = (id: ReportId) => 'occurrence:' + id.sequence;
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
  const report = (notice: WorktreeNotification): ReportId => {
    const reportId = { sequence: ++sequence };
    const key = keyOf(reportId);
    const event = { ...notice, key, reportId, toastKey: notice.toastKey ?? (notice.key || key) };
    post(() => {
      const announce = shouldAnnounce(event) && ![...pending.values()].some(item => item.toastKey === event.toastKey);
      diagnostics.record(key, [event], notice.origin === 'retired' ? 'inactive' : 'reported', announce);
      if (announce) {
        pending.set(key, event);
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
      'origin' | 'toastKey' | 'context' | 'describe' | 'message'> = {}): WorktreeViewError & { reportId: ReportId } {
      const reportId = report({ key: error.code, text: '', error, toastKey: failureToastKey(error),
        message: translate => formatWorktreeViewError(error, translate), ...options });
      return { ...error, reportId };
    },
    updateRecovery(source: string, notices: readonly WorktreeNotification[]) {
      post(() => {
        const records = notices.flatMap(notice => {
          const reportId = notice.reportId ?? notice.error?.reportId;
          if (reportId === undefined) return [];
          const key = keyOf(reportId);
          const queued = pending.get(key);
          if (queued?.reportId === reportId) {
            pending.set(key, {
              ...queued,
              text: notice.text || queued.text,
              message: notice.message ?? queued.message,
            });
          }
          return { ...notice, reportId };
        });
        diagnostics.updateRecovery(source, records);
        updateHead();
      });
    },
    resolve(reportId: ReportId) {
      post(() => {
        pending.delete(keyOf(reportId));
        diagnostics.resolve(reportId);
        updateHead();
      });
    },
    deactivate(source: string) {
      post(() => diagnostics.deactivate(source));
    },
    dismiss(key: string) {
      post(() => {
        if (head?.key !== key) return;
        diagnostics.dismiss(head.reportId!);
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
