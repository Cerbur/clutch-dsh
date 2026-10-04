import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { WorktreeLocaleKey } from '../locales.js';
import type { WorktreeErrorCode } from '../../contract/index.js';
import type { WorktreePermissionResult } from '../../contract/index.js';
import type { WorktreeViewError } from './worktree-view.js';
import { WORKTREE_NS } from '../locales.js';

type WorktreeTranslate = TranslateNS<typeof WORKTREE_NS>;

function detail(error: WorktreeViewError, name: string): string {
  const value = error.details?.[name];
  return typeof value === 'string' ? value : '';
}

const DOMAIN_ERROR_COPY = {
  WORKSPACE_NOT_FOUND: 'error.workspaceNotFound',
  WORKSPACE_ROOT_MISSING: 'error.workspaceRootMissing',
  WORKSPACE_NOT_GIT_REPOSITORY: 'error.workspaceNotGitRepository',
  GIT_NOT_INSTALLED: 'error.gitNotInstalled',
  WORKTREE_REQUIRES_INITIAL_COMMIT: 'error.initialCommitRequired',
  WORKTREE_BRANCH_CONFLICT: 'error.branchConflict',
  WORKTREE_NOT_FOUND: 'error.worktreeNotFound',
  WORKTREE_ORDER_INVALID: 'error.worktreeOrderInvalid',
  WORKTREE_REMOVED: 'error.worktreeRemoved',
  WORKTREE_IMPORT_INVALID: 'error.worktreeImportInvalid',
  WORKTREE_ALREADY_MANAGED: 'error.worktreeAlreadyManaged',
  SESSION_NOT_FOUND: 'error.sessionNotFound',
  SESSION_CWD_MISMATCH: 'error.sessionCwdMismatch',
  SESSION_ALREADY_BOUND: 'error.sessionAlreadyBound',
  SIDECAR_UNAVAILABLE: 'error.sidecarUnavailable',
  SIDECAR_CORRUPT: 'error.sidecarCorrupt',
  SIDECAR_SYNC_REQUIRED: 'error.sidecarSyncRequired',
  GIT_OPERATION_FAILED: 'error.gitOperationFailed',
  WORKTREE_MUTATION_BUSY: 'error.worktreeMutationBusy',
  WORKTREE_STATE_CONFLICT: 'error.worktreeStateConflict',
  WORKTREE_RECOVERY_REQUIRED: 'error.worktreeRecoveryRequired',
  WORKTREE_IDENTITY_CHANGED: 'error.worktreeIdentityChanged',
  WORKTREE_PERMISSION_BINDING_REQUIRED: 'error.permissionBindingRequired',
  WORKTREE_SESSION_BUSY: 'error.worktreeSessionBusy',
  WORKTREE_ACTIVITY_UNAVAILABLE: 'error.worktreeActivityUnavailable',
} as const satisfies Record<WorktreeErrorCode, WorktreeLocaleKey>;

function reason(error: WorktreeViewError, t: WorktreeTranslate): string {
  const causeCode = detail(error, 'causeCode');
  const key = Object.hasOwn(DOMAIN_ERROR_COPY, causeCode)
    ? DOMAIN_ERROR_COPY[causeCode as WorktreeErrorCode]
    : undefined;
  return key === undefined
    ? t('error.worktreeDataUnavailable')
    : causeCode === 'WORKSPACE_ROOT_MISSING'
      ? t(key, { rootPath: detail(error, 'rootPath') })
      : t(key);
}

/** Recognize actionable Git diagnostics without displaying untranslated stderr. */
function gitErrorCopy(error: WorktreeViewError): WorktreeLocaleKey {
  if (error.details?.gitTimedOut === true) return 'error.gitTimeout';
  const diagnostic = detail(error, 'gitStderr');
  if (
    /contains modified or untracked files|uncommitted changes|local changes.*overwritten/i.test(
      diagnostic,
    )
  )
    return 'error.gitLocalChanges';
  if (
    /permission denied|access is denied|operation not permitted|dubious ownership/i.test(diagnostic)
  )
    return 'error.gitAccessDenied';
  if (/is locked|cannot lock|unable to create.*\.lock|another git process/i.test(diagnostic))
    return 'error.gitLocked';
  if (/not a valid branch name|invalid branch name|not a valid ref/i.test(diagnostic))
    return 'error.gitInvalidBranch';
  return 'error.gitOperationFailed';
}

export function formatWorktreePermissionNotice(
  result: WorktreePermissionResult,
  t: WorktreeTranslate,
): string {
  switch (result.status) {
    case 'fallback-workspace-write':
      return t('permission.fallbackWorkspaceWrite');
    case 'user-restricted':
      return t('permission.userRestricted');
    case 'unverified':
      return t('permission.unverified');
    default:
      return t('permission.unavailable');
  }
}

export function formatWorktreeViewError(error: WorktreeViewError, t: WorktreeTranslate): string {
  if (error.code === 'GIT_OPERATION_FAILED') return t(gitErrorCopy(error));
  const domainKey = Object.hasOwn(DOMAIN_ERROR_COPY, error.code)
    ? DOMAIN_ERROR_COPY[error.code as WorktreeErrorCode]
    : undefined;
  if (domainKey !== undefined)
    return error.code === 'WORKSPACE_ROOT_MISSING'
      ? t(domainKey, { rootPath: detail(error, 'rootPath') })
      : t(domainKey);
  switch (error.code) {
    case 'CLIENT_DISPOSED':
      return t('error.connectionDisposed');
    case 'gateway/service-unavailable':
    case 'gateway/definition-unavailable':
    case 'gateway/invocation-unavailable':
    case 'CONNECTION_CALL_FAILED':
      return t('error.connectionFailed');
    case 'WORKTREE_RPC_INVALID_RESULT':
      return t('error.invalidResult');
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
    case 'WORKTREE_IMPORT_INVALID':
      return t('error.worktreeImportInvalid');
    case 'WORKTREE_ALREADY_MANAGED':
      return t('error.worktreeAlreadyManaged');
    case 'WORKTREE_MUTATION_BUSY':
      return t('error.worktreeMutationBusy');
    case 'WORKTREE_STATE_CONFLICT':
      return t('error.worktreeStateConflict');
    case 'WORKTREE_RECOVERY_REQUIRED':
      return t('error.worktreeRecoveryRequired');
    case 'WORKTREE_IDENTITY_CHANGED':
      return t('error.worktreeIdentityChanged');
    case 'WORKTREE_REGISTRATION_SESSION_UNAVAILABLE':
      return t('error.worktreeRegistrationSessionUnavailable');
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
    case 'WORKTREE_PERMISSION_CONFIRMATION_REQUIRED':
      return t('error.worktreePermissionConfirmationRequired');
    case 'WORKTREE_PERMISSION_FAILED':
      return t('error.worktreePermissionFailed');
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
    case 'GIT_NOT_INSTALLED':
      return t('error.gitNotInstalled');
    default:
      return error.code === 'WORKTREE_VIEW_FAILED'
        ? t('error.worktreeDataUnavailable')
        : t('error.unexpected', { code: error.code });
  }
}
