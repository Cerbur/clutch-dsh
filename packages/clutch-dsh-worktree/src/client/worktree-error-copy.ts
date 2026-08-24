import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { WorktreeViewError } from './worktree-view.js';
import { WORKTREE_NS } from './locales.js';

type WorktreeTranslate = TranslateNS<typeof WORKTREE_NS>;

function detail(error: WorktreeViewError, name: string): string {
  const value = error.details?.[name];
  return typeof value === 'string' ? value : '';
}

function reason(error: WorktreeViewError, t: WorktreeTranslate): string {
  return error.message.length > 0 ? error.message : t('error.worktreeDataUnavailable');
}

export function formatWorktreeViewError(
  error: WorktreeViewError,
  t: WorktreeTranslate,
): string {
  switch (error.code) {
    case 'CLIENT_DISPOSED':
      return t('error.connectionDisposed');
    case 'CONNECTION_CALL_FAILED':
      return t('error.connectionFailed', {
        endpoint: detail(error, 'endpoint'),
        reason: reason(error, t),
      });
    case 'WORKTREE_RPC_INVALID_RESULT':
      return t('error.invalidResult', { endpoint: detail(error, 'endpoint') });
    case 'WORKSPACE_ORDER_UNAVAILABLE':
      return t('error.workspaceOrderingUnavailable');
    case 'SESSION_ORDER_UNAVAILABLE':
      return t('error.sessionOrderingUnavailable');
    case 'WORKTREE_ORDER_UNAVAILABLE':
      return t('error.worktreeOrderingUnavailable');
    case 'SESSION_CREATE_UNAVAILABLE':
      return t('error.sessionCreationUnavailable');
    case 'WORKTREE_CREATED_SESSION_UNAVAILABLE':
      return t('error.worktreeCreatedSessionUnavailable');
    case 'WORKTREE_RECORD_MISSING':
      return t('error.worktreeRecordMissing');
    case 'WORKSPACE_RENAME_UNAVAILABLE':
      return t('error.workspaceRenameUnavailable');
    case 'WORKSPACE_DELETE_UNAVAILABLE':
      return t('error.workspaceDeleteUnavailable');
    case 'SESSION_RENAME_UNAVAILABLE':
      return t('error.sessionRenameUnavailable');
    case 'SESSION_BINDING_FAILED':
      return t('error.sessionBindingFailed', {
        sessionId: detail(error, 'sessionId'),
        reason: reason(error, t),
      });
    case 'SESSION_ALREADY_BOUND':
      return t('error.sessionAlreadyBound');
    case 'SESSION_LIST_NOT_READY':
      return t('error.sessionListNotReady');
    case 'SESSION_FACTS_INCOMPLETE':
      return t('error.sessionFactsIncomplete');
    case 'WORKTREE_SESSION_REPAIR_REQUIRED':
      return t('error.worktreeSessionRepairRequired');
    case 'WORKTREE_SESSION_UNAVAILABLE':
      return t('error.worktreeSessionUnavailable');
    case 'SESSION_ARCHIVED':
      return t('error.sessionArchived');
    default:
      return error.message.length > 0 ? error.message : t('error.worktreeDataUnavailable');
  }
}
