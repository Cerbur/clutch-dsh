import { formatWorktreePermissionNotice, formatWorktreeViewError } from '../../view/worktree-error-copy.js';
import styles from '../../worktree.css';
import { forkRecoveryError } from '../shared.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useDragActions } from '../actions/useDragActions.js';
import type { useLifecycleActions } from '../actions/useLifecycleActions.js';
import type { useLifecycleState } from '../state/useLifecycleState.js';
import type { useNativeActions } from '../actions/useNativeActions.js';
import type { useSessionActions } from '../actions/useSessionActions.js';
import type { useSessionExpansion } from '../state/useSessionExpansion.js';
import type { useSessionOrdering } from '../state/useSessionOrdering.js';
import type { useSurfaceMenus } from '../state/useSurfaceMenus.js';
import type { useSurfaceMutation } from '../actions/useSurfaceMutation.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';
import type { useWorktreeRegistration } from '../actions/useWorktreeRegistration.js';

type Input = {
  source: Pick<
    ReturnType<typeof useSurfaceSources>,
    | 'permissionNoticeSnapshot'
    | 'forkRecoverySnapshot'
    | 'expandSnapshot'
    | 'workspaces'
    | 'sessions'
    | 'archivedSessionIds'
    | 'sessionPresentations'
    | 'currentSessionId'
  >;
  props: Pick<
    WorktreeSurfaceProps,
    | 't'
    | 'retryForkSession'
    | 'openSession'
    | 'createMainSession'
    | 'renameSession'
    | 'forkSession'
    | 'archiveSession'
    | 'manager'
  >;
  lifecycle: Pick<
    ReturnType<typeof useLifecycleActions>,
    | 'permissionRetryTarget'
    | 'retryCleanupPermissions'
    | 'recoveryAction'
    | 'branchLabel'
    | 'branchActions'
  >;
  mutation: Pick<
    ReturnType<typeof useSurfaceMutation>,
    'actionPending' | 'actionError' | 'setActionError' | 'runMutation'
  >;
  session: Pick<
    ReturnType<typeof useSessionActions>,
    | 'forkRetryKey'
    | 'retryForkBinding'
    | 'pendingSessionBinding'
    | 'pendingSessionArchived'
    | 'retrySessionBinding'
    | 'setPendingSessionBinding'
    | 'createSession'
    | 'openWorkspaceSession'
  >;
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'refresh' | 'readState' | 'viewByWorkspace'>;
  expansion: Pick<
    ReturnType<typeof useSessionExpansion>,
    | 'isCurrentSessionReveal'
    | 'query'
    | 'expandedSessionGroups'
    | 'toggleWorkspace'
    | 'toggleMain'
    | 'toggleSessionGroup'
    | 'toggleWorktree'
    | 'expandedArchivedWorkspaces'
    | 'toggleArchivedWorkspace'
  >;
  ordering: Pick<ReturnType<typeof useSessionOrdering>, 'orderedSessionIdsByAccount'>;
  drag: Pick<
    ReturnType<typeof useDragActions>,
    | 'worktreeDrag'
    | 'workspaceDrag'
    | 'workspaceDropCommitted'
    | 'setWorkspaceDrag'
    | 'commitWorkspaceDrag'
    | 'sessionDrag'
    | 'sessionDropCommitted'
    | 'setSessionDrag'
    | 'commitSessionDrag'
    | 'worktreeDropCommitted'
    | 'setWorktreeDrag'
    | 'commitWorktreeDrag'
  >;
  menus: Pick<
    ReturnType<typeof useSurfaceMenus>,
    | 'openWorkspaceMenuId'
    | 'setOpenWorkspaceMenuId'
    | 'openMainMenuId'
    | 'setOpenMainMenuId'
    | 'openWorktreeMenuId'
    | 'setOpenWorktreeMenuId'
  >;
  registration: Pick<ReturnType<typeof useWorktreeRegistration>, 'openWorktreeCreator'>;
  native: Pick<
    ReturnType<typeof useNativeActions>,
    'openWorkspaceRename' | 'openWorkspaceDelete' | 'openSessionRename' | 'archiveWorktreeSession'
  >;
  lifecycleState: Pick<
    ReturnType<typeof useLifecycleState>,
    'setWorktreeRemoval' | 'setWorktreeCleanDisk' | 'setWorktreeForget'
  >;
};

import { WorkspaceTree } from './WorkspaceTree.js';
export function SurfaceContent({
  source,
  props,
  lifecycle,
  mutation,
  session,
  read,
  expansion,
  ordering,
  drag,
  menus,
  registration,
  native,
  lifecycleState,
}: Input) {
  const { permissionNoticeSnapshot, forkRecoverySnapshot } = source;
  const { t, retryForkSession, openSession } = props;
  const { permissionRetryTarget, retryCleanupPermissions, recoveryAction } = lifecycle;
  const { actionPending, actionError, setActionError } = mutation;
  const {
    forkRetryKey,
    retryForkBinding,
    pendingSessionBinding,
    pendingSessionArchived,
    retrySessionBinding,
    setPendingSessionBinding,
  } = session;
  const { refresh, readState } = read;

  return (
    <div className={styles.content} tabIndex={0}>
      {permissionNoticeSnapshot !== undefined && (
        <div className={styles.notice} role="status" data-worktree-permission-notice>
          <p className={styles.message}>
            {formatWorktreePermissionNotice(permissionNoticeSnapshot.result, t)}
          </p>
          {permissionRetryTarget !== undefined && (
            <button
              type="button"
              className={styles.retryButton}
              disabled={actionPending}
              onClick={retryCleanupPermissions}
            >
              {t('action.retry')}
            </button>
          )}
        </div>
      )}
      {forkRecoverySnapshot.pending.map((recovery) => {
        const recoveryViewError = forkRecoveryError(recovery);
        return (
          <div
            key={recovery.key}
            className={styles.error}
            role="alert"
            data-fork-recovery={recovery.key}
          >
            <p className={styles.message} data-error="true">
              {formatWorktreeViewError(recoveryViewError, t)}
            </p>
            <div className={styles.recoveryActions}>
              {retryForkSession !== undefined && recoveryViewError.retryable && (
                <button
                  type="button"
                  className={styles.actionButton}
                  disabled={forkRetryKey !== undefined}
                  onClick={() => {
                    void retryForkBinding(recovery.key);
                  }}
                >
                  {t('action.retryBinding')}
                </button>
              )}
              <button
                type="button"
                className={styles.actionButton}
                disabled={forkRetryKey !== undefined}
                onClick={() => {
                  openSession(recovery.childSessionId);
                }}
              >
                {t('action.openCreatedSession')}
              </button>
            </div>
          </div>
        );
      })}
      {actionError !== undefined && (
        <div className={styles.error} role="alert" data-worktree-error>
          <p className={styles.message} data-error="true">
            {formatWorktreeViewError(actionError, t)}
          </p>
          {recoveryAction(actionError)}
          {pendingSessionBinding !== undefined && (
            <div className={styles.recoveryActions}>
              <button
                type="button"
                className={styles.actionButton}
                disabled={actionPending || pendingSessionArchived}
                onClick={() => {
                  void retrySessionBinding();
                }}
              >
                {t('action.retryBinding')}
              </button>
              {!pendingSessionBinding.permissionRequired && (
                <button
                  type="button"
                  className={styles.actionButton}
                  disabled={actionPending}
                  onClick={() => {
                    const sessionId = pendingSessionBinding.sessionId;
                    setPendingSessionBinding(undefined);
                    setActionError(undefined);
                    openSession(sessionId);
                  }}
                >
                  {t('action.openCreatedSession')}
                </button>
              )}
            </div>
          )}
          {actionError.retryable && (
            <button
              type="button"
              className={styles.retryButton}
              onClick={() => {
                setActionError(undefined);
                void refresh({ scope: { kind: 'global' } });
              }}
            >
              {t('action.retry')}
            </button>
          )}
        </div>
      )}

      {readState.targetError !== undefined && (
        <div className={styles.error} role="alert" data-worktree-target-error>
          <p className={styles.message} data-error="true">
            {formatWorktreeViewError(readState.targetError.error, t)}
          </p>
          {recoveryAction(readState.targetError.error)}
          <button
            type="button"
            className={styles.retryButton}
            onClick={() => {
              void refresh({
                scope: {
                  kind: 'workspaces',
                  workspaceIds: readState.targetError!.workspaceIds,
                },
                preserveCurrent: true,
              });
            }}
          >
            {t('action.retry')}
          </button>
        </div>
      )}

      {readState.status === 'loading' && <p className={styles.message}>{t('status.loading')}</p>}
      {readState.status === 'error' && readState.error !== undefined ? (
        <div className={styles.error} role="alert" data-worktree-error>
          <p className={styles.message} data-error="true">
            {formatWorktreeViewError(readState.error, t)}
          </p>
          {recoveryAction(readState.error)}
          <button
            type="button"
            className={styles.retryButton}
            onClick={() => {
              void refresh({ scope: { kind: 'global' } });
            }}
          >
            {t('action.retry')}
          </button>
        </div>
      ) : readState.status === 'ready' ? (
        <WorkspaceTree
          props={props}
          read={read}
          source={source}
          expansion={expansion}
          ordering={ordering}
          drag={drag}
          mutation={mutation}
          menus={menus}
          registration={registration}
          native={native}
          lifecycle={lifecycle}
          session={session}
          lifecycleState={lifecycleState}
        />
      ) : null}
    </div>
  );
}
