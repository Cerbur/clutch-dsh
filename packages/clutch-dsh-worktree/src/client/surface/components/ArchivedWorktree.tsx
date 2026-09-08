import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import type { SessionBinding, WorktreeRecord } from '../../../contract/index.js';
import {
  filterVisibleSessionIds,
  hasOngoingSession,
  sessionMatchesQuery,
} from '../../session/session-view.js';
import { isWorktreeExpanded } from '../../view/worktree-expand-state.js';
import { executeWorktreeAction, filterArchivedSessionIds } from '../../view/worktree-view.js';
import styles from '../../worktree.css';
import type { ArchivedWorktreesInput } from './ArchivedWorktrees.js';
import { WorktreeGroupRow, WorktreeSessionGroup } from './rows.js';
import {
  bindingIdsFor,
  includesText,
  isSessionGroupAutoExpanded,
  worktreeLifecycleBlockReason,
} from '../selectors.js';
import type { WorkspaceLike } from '../types.js';

type Input = {
  record: WorktreeRecord;
  source: Pick<
    ArchivedWorktreesInput['source'],
    | 'sessions'
    | 'archivedSessionIds'
    | 'currentSessionId'
    | 'expandSnapshot'
    | 'sessionPresentations'
  >;
  expansion: Pick<
    ArchivedWorktreesInput['expansion'],
    | 'query'
    | 'isCurrentSessionReveal'
    | 'expandedSessionGroups'
    | 'toggleWorktree'
    | 'toggleSessionGroup'
  >;
  ordering: Pick<ArchivedWorktreesInput['ordering'], 'orderedSessionIdsByAccount'>;
  props: Pick<
    ArchivedWorktreesInput['props'],
    't' | 'manager' | 'renameSession' | 'forkSession' | 'archiveSession'
  >;
  lifecycle: Pick<ArchivedWorktreesInput['lifecycle'], 'branchLabel' | 'branchActions'>;
  mutation: Pick<
    ArchivedWorktreesInput['mutation'],
    'actionPending' | 'setActionError' | 'runMutation'
  >;
  menus: Pick<ArchivedWorktreesInput['menus'], 'openWorktreeMenuId' | 'setOpenWorktreeMenuId'>;
  read: Pick<ArchivedWorktreesInput['read'], 'refresh'>;
  lifecycleState: Pick<
    ArchivedWorktreesInput['lifecycleState'],
    'setWorktreeCleanDisk' | 'setWorktreeForget'
  >;
  drag: Pick<
    ArchivedWorktreesInput['drag'],
    'sessionDrag' | 'sessionDropCommitted' | 'setSessionDrag' | 'commitSessionDrag'
  >;
  session: Pick<ArchivedWorktreesInput['session'], 'openWorkspaceSession'>;
  native: Pick<ArchivedWorktreesInput['native'], 'openSessionRename' | 'archiveWorktreeSession'>;
  bindings: readonly SessionBinding[];
  workspaceMatchesQuery: boolean;
  workspace: WorkspaceLike;
};
export function ArchivedWorktree({
  record,
  source,
  expansion,
  ordering,
  props,
  lifecycle,
  mutation,
  menus,
  read,
  lifecycleState,
  drag,
  session,
  native,
  bindings,
  workspaceMatchesQuery,
  workspace,
}: Input) {
  const { sessions, archivedSessionIds, currentSessionId, expandSnapshot, sessionPresentations } =
    source;
  const {
    query,
    isCurrentSessionReveal,
    expandedSessionGroups,
    toggleWorktree,
    toggleSessionGroup,
  } = expansion;
  const { orderedSessionIdsByAccount } = ordering;
  const { t, manager, renameSession, forkSession, archiveSession } = props;
  const { branchLabel, branchActions } = lifecycle;
  const { actionPending, setActionError, runMutation } = mutation;
  const { openWorktreeMenuId, setOpenWorktreeMenuId } = menus;
  const { refresh } = read;
  const { setWorktreeCleanDisk, setWorktreeForget } = lifecycleState;
  const { sessionDrag, sessionDropCommitted, setSessionDrag, commitSessionDrag } = drag;
  const { openWorkspaceSession } = session;
  const { openSessionRename, archiveWorktreeSession } = native;
  const worktreeSessionIds = filterVisibleSessionIds(
    filterArchivedSessionIds(
      bindingIdsFor(bindings, record.worktreeId).filter((sessionId) =>
        sessions.ids.includes(sessionId),
      ),
      archivedSessionIds,
    ),
    sessions,
  );
  const worktreeMatchesQuery =
    workspaceMatchesQuery ||
    includesText(record.branch, query) ||
    includesText(record.absolutePath, query);
  if (
    query.length > 0 &&
    !worktreeMatchesQuery &&
    !worktreeSessionIds.some((sessionId) => sessionMatchesQuery(sessionId, sessions, query))
  ) {
    return null;
  }
  const visibleWorktreeSessionIds = worktreeSessionIds.filter(
    (sessionId) => worktreeMatchesQuery || sessionMatchesQuery(sessionId, sessions, query),
  );
  const worktreeGroupKey = 'worktree:' + record.worktreeId;
  const orderedWorktreeSessionIds =
    orderedSessionIdsByAccount.get(worktreeGroupKey) ?? worktreeSessionIds;
  const orderedVisibleWorktreeSessionIds = orderedWorktreeSessionIds.filter(
    (sessionId) => worktreeMatchesQuery || sessionMatchesQuery(sessionId, sessions, query),
  );
  const sessionIds =
    orderedVisibleWorktreeSessionIds.length === visibleWorktreeSessionIds.length
      ? orderedVisibleWorktreeSessionIds
      : visibleWorktreeSessionIds;
  const sessionGroupAutoExpanded = isSessionGroupAutoExpanded(
    sessionIds,
    currentSessionId,
    isCurrentSessionReveal('session-group:' + worktreeGroupKey),
  );
  const sessionGroupExpanded =
    expandedSessionGroups[worktreeGroupKey] === true || sessionGroupAutoExpanded;
  const state =
    record.health === 'recovery-needed'
      ? 'error'
      : record.diskCleanup === 'completed'
        ? undefined
        : record.health === 'repair'
          ? 'error'
          : 'warning';
  const stateLabel =
    record.health === 'recovery-needed'
      ? t('worktree.recovery')
      : record.diskCleanup === 'completed'
        ? t('worktree.cleaned')
        : record.health === 'repair'
          ? t('worktree.repair')
          : record.health === 'branch-drift'
            ? t('worktree.branchDrift')
            : t('worktree.detached');
  const worktreeExpanded =
    isWorktreeExpanded(expandSnapshot, record.worktreeId) ||
    isCurrentSessionReveal('worktree:' + record.worktreeId);
  return (
    <div
      key={record.worktreeId}
      className={styles.worktreeGroup}
      data-worktree-id={record.worktreeId}
    >
      <WorktreeGroupRow
        t={t}
        kind="worktree"
        label={branchLabel(record)}
        worktreeId={record.worktreeId}
        expanded={worktreeExpanded}
        hasOngoingSession={hasOngoingSession(worktreeSessionIds, sessionPresentations)}
        icon={<IconBranchOutline16 />}
        workspaceTitle={workspace.title}
        state={state}
        stateLabel={stateLabel}
        onToggle={() => {
          toggleWorktree(record.worktreeId);
        }}
        menu={(() => {
          const activityBlocked = worktreeLifecycleBlockReason(actionPending, record.health);
          const blockedReasonText =
            activityBlocked === 'recovery' ? t('worktree.recovery') : undefined;
          return {
            ...branchActions(record),
            open: openWorktreeMenuId === record.worktreeId,
            label: record.branch,
            copyPath: record.absolutePath,
            showCreate: false,
            showRemove: false,
            showUnarchive: record.diskCleanup !== 'completed',
            showCleanDisk: record.diskCleanup !== 'completed',
            showForget: true,
            disabled: actionPending,
            unarchiveDisabled: activityBlocked !== undefined || record.health === 'repair',
            cleanDiskDisabled: activityBlocked !== undefined || record.health === 'branch-drift',
            forgetDisabled: activityBlocked !== undefined,
            unarchiveDisabledReason:
              record.health === 'repair'
                ? t('worktree.unarchiveDisabledRepair')
                : blockedReasonText,
            cleanDiskDisabledReason:
              record.health === 'branch-drift' ? t('worktree.adoptBeforeClean') : blockedReasonText,
            forgetDisabledReason: blockedReasonText,
            onOpenChange: (open) => {
              setOpenWorktreeMenuId(open ? record.worktreeId : undefined);
              if (open)
                void refresh({
                  scope: { kind: 'workspace', workspaceId: record.workspaceId },
                  preserveCurrent: true,
                  reuseInFlight: true,
                  invalidateContext: false,
                });
            },
            onUnarchive: () => {
              if (!manager) return;
              if (!record.mutationToken) {
                setActionError({
                  code: 'WORKTREE_STATE_CONFLICT',
                  message: '',
                  retryable: true,
                  details: {
                    workspaceId: record.workspaceId,
                    worktreeId: record.worktreeId,
                  },
                });
                return;
              }
              void runMutation(
                async () => {
                  await executeWorktreeAction(manager, {
                    type: 'unarchiveWorktree',
                    input: {
                      workspaceId: record.workspaceId,
                      worktreeId: record.worktreeId,
                      mutationToken: record.mutationToken!,
                    },
                  });
                },
                {
                  scope: { kind: 'workspace', workspaceId: record.workspaceId },
                  preserveCurrent: true,
                },
              );
            },
            onCleanDisk: () => {
              setWorktreeCleanDisk(record);
              setActionError(undefined);
            },
            onForget: () => {
              setWorktreeForget(record);
              setActionError(undefined);
            },
          };
        })()}
      />
      {worktreeExpanded && (
        <WorktreeSessionGroup
          t={t}
          groupKey={worktreeGroupKey}
          sessionIds={sessionIds}
          workspaceId={workspace.workspaceId}
          currentSessionId={currentSessionId}
          expanded={sessionGroupExpanded}
          actionPending={actionPending}
          sessions={sessions}
          sessionPresentations={sessionPresentations}
          dragState={sessionDrag}
          onToggleExpanded={() => {
            toggleSessionGroup(worktreeGroupKey, sessionGroupAutoExpanded);
          }}
          onStartDrag={(groupKey, sessionId) => {
            sessionDropCommitted.current = false;
            setSessionDrag({ groupKey, sessionId, over: null });
          }}
          onHoverDrag={(sessionId, half) => {
            setSessionDrag((current) =>
              current === undefined ? current : { ...current, over: { sessionId, half } },
            );
          }}
          onClearDrag={() => {
            setSessionDrag(undefined);
          }}
          onFinishDrag={() => {
            sessionDropCommitted.current = false;
          }}
          onCommitDrag={commitSessionDrag}
          onOpen={(sessionId) => {
            openWorkspaceSession(workspace.workspaceId, sessionId);
          }}
          onRename={renameSession === undefined ? undefined : openSessionRename}
          onFork={forkSession}
          onArchive={archiveSession === undefined ? undefined : archiveWorktreeSession}
        />
      )}
    </div>
  );
}
