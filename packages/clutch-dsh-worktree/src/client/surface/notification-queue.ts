import type { WorktreeViewError } from '../view/worktree-view-errors.js';
import type { WorktreeTranslate } from './types.js';

export interface WorktreeNotification {
  readonly reportId?: string;
  readonly key: string;
  readonly text: string;
  readonly toastKey?: string;
  readonly origin?: 'inline' | 'cached-refresh' | 'restored-fork' | 'batch-item' | 'retired';
  readonly failures?: readonly WorktreeViewError[];
  readonly context?: string;
  readonly error?: WorktreeViewError;
  readonly describe?: (t: WorktreeTranslate) => string;
  readonly message?: (t: WorktreeTranslate) => string;
  readonly actions?: readonly {
    readonly label: string;
    readonly disabled?: boolean;
    readonly leaveSettings?: boolean;
    readonly onClick: () => void;
  }[];
}

/** Group a root Git failure without conflating unrelated repositories or diagnostics. */
export function failureToastKey(error: WorktreeViewError, scope?: readonly string[]): string {
  const details = Object.fromEntries(Object.entries(error.details ?? {})
    .filter(([name]) => !['gitArgs', 'gitStdout', 'operation'].includes(name)));
  return JSON.stringify([scope, error.code, details,
    typeof details.gitStderr === 'string' && details.gitStderr.length > 0 || details.gitTimedOut === true
      ? undefined : error.message]);
}

function missingWorkspace(error?: WorktreeViewError): boolean {
  return error?.code === 'WORKSPACE_ROOT_MISSING' || error?.details?.causeCode === 'WORKSPACE_ROOT_MISSING';
}

export function shouldAnnounce(notice: WorktreeNotification): boolean {
  if (notice.origin || missingWorkspace(notice.error)) return false;
  return !notice.failures?.length || !notice.failures.every(missingWorkspace);
}
