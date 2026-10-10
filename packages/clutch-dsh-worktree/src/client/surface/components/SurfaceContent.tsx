import {
  formatWorktreePermissionNotice,
  formatWorktreeViewError,
} from '../../view/worktree-error-copy.js';
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
    | 'openDashboard'
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
    | 'contentRef'
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
import { OverlayScrollbar } from './OverlayScrollbar.js';
import { NotificationToasts } from './NotificationToasts.js';
import type { WorktreeNotification } from '../notification-queue.js';
import { failureToastKey } from '../notification-queue.js';
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
  const notices: WorktreeNotification[] = [];
  const workspaceLabel = (workspaceId: string) => {
    const workspace = source.workspaces.items.find((item) => item.workspaceId === workspaceId);
    return workspace === undefined ? workspaceId : `${workspace.title} · ${workspace.path}`;
  };
  const sessionLabel = (sessionId: string) => source.sessions.byId[sessionId]?.displayTitle ?? sessionId;
  const retryRead = (workspaceIds?: readonly string[]) => ({
    label: t('action.retry'), disabled: actionPending,
    onClick: () => { void refresh({
      scope: workspaceIds === undefined ? { kind: 'global' } : { kind: 'workspaces', workspaceIds },
      preserveCurrent: true,
    }); },
  });
  const actionsFor = (error: NonNullable<typeof actionError>) => {
    const recovery = recoveryAction(error);
    return recovery === null ? [] : [recovery];
  };
  if (permissionNoticeSnapshot !== undefined) {
    notices.push({
      key: 'permission:' + permissionNoticeSnapshot.workspaceId + ':' + permissionNoticeSnapshot.worktreeId,
      text: formatWorktreePermissionNotice(permissionNoticeSnapshot.result, t),
      message: (translate) => formatWorktreePermissionNotice(permissionNoticeSnapshot.result, translate),
      context: t('settings.permission') + ' · ' + workspaceLabel(permissionNoticeSnapshot.workspaceId),
      actions: permissionRetryTarget === undefined ? [] : [{
        label: t('action.retry'), disabled: actionPending, onClick: retryCleanupPermissions,
      }],
    });
  }
  for (const recovery of forkRecoverySnapshot.pending) {
    const error = forkRecoveryError(recovery);
    notices.push({
      key: 'fork:' + recovery.key, error, text: formatWorktreeViewError(error, t),
      toastKey: failureToastKey(error),
      context: t('settings.binding') + ' · ' + sessionLabel(recovery.childSessionId),
      actions: [
        ...(retryForkSession !== undefined && error.retryable ? [{
          label: t('action.retryBinding'), disabled: forkRetryKey !== undefined,
          onClick: () => { void retryForkBinding(recovery.key); },
        }] : []),
        { label: t('action.openCreatedSession'), disabled: forkRetryKey !== undefined,
          leaveSettings: true,
          onClick: () => openSession(recovery.childSessionId) },
      ],
    });
  }
  if (actionError !== undefined &&
    (pendingSessionBinding === undefined || actionError.details?.sessionId !== pendingSessionBinding.sessionId)) {
    const error = actionError;
    const workspaceId = error.details?.workspaceId;
    const context = typeof workspaceId === 'string' ? workspaceLabel(workspaceId) : '';
    notices.push({
      key: 'action:' + JSON.stringify([error.code, error.details]), error,
      toastKey: failureToastKey(error), text: formatWorktreeViewError(error, t),
      context: t('settings.operation') + ' · ' + context,
      describe: (translate) => translate('settings.operation') + ' · ' + context,
      actions: [
        ...actionsFor(error),
        ...(error.retryable ? [{
          label: t('action.retry'), disabled: actionPending,
          onClick: () => {
            setActionError(undefined);
            void refresh({
              scope: typeof workspaceId === 'string'
                ? { kind: 'workspace', workspaceId } : { kind: 'global' },
              preserveCurrent: true,
            });
          },
        }] : []),
      ],
    });
  }
  if (pendingSessionBinding !== undefined) {
    const binding = pendingSessionBinding;
    const error = binding.error ?? (actionError?.details?.sessionId === binding.sessionId
      ? actionError : { code: 'SESSION_BINDING_FAILED', message: '', retryable: true,
        details: { sessionId: binding.sessionId } });
    const context = [workspaceLabel(binding.workspaceId), sessionLabel(binding.sessionId), binding.cwd].filter(Boolean).join(' · ');
    notices.push({
      key: 'binding:' + binding.sessionId, error,
      toastKey: failureToastKey(error), text: formatWorktreeViewError(error, t),
      context: t('settings.binding') + ' · ' + context,
      describe: (translate) => translate('settings.binding') + ' · ' + context,
      actions: [
        { label: t('action.retryBinding'),
          disabled: actionPending || pendingSessionArchived || error.retryable === false,
          onClick: () => { void retrySessionBinding(); } },
        ...(binding.permissionRequired ? [] : [{
          label: t('action.openCreatedSession'), disabled: actionPending,
          leaveSettings: true,
          onClick: () => {
            setPendingSessionBinding(undefined);
            if (actionError?.details?.sessionId === binding.sessionId) setActionError(undefined);
            openSession(binding.sessionId);
          },
        }]),
      ],
    });
  }
  if (readState.targetError !== undefined) {
    const { error, workspaceIds } = readState.targetError;
    notices.push({
      key: 'target:' + JSON.stringify([workspaceIds, error.code, error.details]),
      error, text: formatWorktreeViewError(error, t),
      context: t('settings.read') + ' · ' + workspaceIds.map(workspaceLabel).join(', '),
      actions: [...actionsFor(error), retryRead(workspaceIds)],
    });
  }
  if (readState.status === 'error' && readState.error !== undefined) {
    const error = readState.error;
    notices.push({
      key: 'read:' + JSON.stringify([error.code, error.details]),
      error, text: formatWorktreeViewError(error, t), context: t('settings.read'),
      actions: [...actionsFor(error), retryRead()],
    });
  }

  return (
    <div className={styles.scrollFrame}>
      <div
        ref={expansion.contentRef}
        className={styles.content}
        tabIndex={0}
        data-worktree-scrollport
      >
        <div className={styles.scrollContent}>
          <NotificationToasts notices={notices} />
          {readState.status === 'loading' && (
            <p className={styles.message}>{t('status.loading')}</p>
          )}
          {readState.status === 'ready' ? (
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
      </div>
      <OverlayScrollbar scrollportRef={expansion.contentRef} />
    </div>
  );
}
