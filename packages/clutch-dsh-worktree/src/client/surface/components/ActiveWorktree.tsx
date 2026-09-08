import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  filterVisibleSessionIds,
  hasOngoingSession,
  sessionMatchesQuery,
} from '../../session/session-view.js';
import { isWorktreeExpanded } from '../../view/worktree-expand-state.js';
import { createNumberedWorktreeName, filterArchivedSessionIds } from '../../view/worktree-view.js';
import styles from '../../worktree.css';
import { WorktreeGroupRow, WorktreeSessionGroup } from './rows.js';
import { bindingIdsFor, includesText, isSessionGroupAutoExpanded } from '../selectors.js';
import type { WorkspaceTreeInput } from './WorkspaceTree.js';

import type { SessionBinding, WorktreeRecord } from '../../../contract/index.js';
import type { WorkspaceLike } from '../types.js';

type Input = {
  record: WorktreeRecord;
  source: Pick<
    WorkspaceTreeInput['source'],
    | 'sessions'
    | 'archivedSessionIds'
    | 'currentSessionId'
    | 'expandSnapshot'
    | 'sessionPresentations'
  >;
  expansion: Pick<
    WorkspaceTreeInput['expansion'],
    | 'query'
    | 'isCurrentSessionReveal'
    | 'expandedSessionGroups'
    | 'toggleWorktree'
    | 'toggleSessionGroup'
  >;
  ordering: Pick<WorkspaceTreeInput['ordering'], 'orderedSessionIdsByAccount'>;
  props: Pick<
    WorkspaceTreeInput['props'],
    't' | 'renameSession' | 'forkSession' | 'archiveSession'
  >;
  lifecycle: Pick<WorkspaceTreeInput['lifecycle'], 'branchLabel' | 'branchActions'>;
  session: Pick<WorkspaceTreeInput['session'], 'createSession' | 'openWorkspaceSession'>;
  menus: Pick<WorkspaceTreeInput['menus'], 'openWorktreeMenuId' | 'setOpenWorktreeMenuId'>;
  mutation: Pick<WorkspaceTreeInput['mutation'], 'actionPending' | 'setActionError'>;
  read: Pick<WorkspaceTreeInput['read'], 'refresh'>;
  registration: Pick<WorkspaceTreeInput['registration'], 'openWorktreeCreator'>;
  lifecycleState: Pick<WorkspaceTreeInput['lifecycleState'], 'setWorktreeRemoval'>;
  drag: Pick<
    WorkspaceTreeInput['drag'],
    | 'worktreeDrag'
    | 'worktreeDropCommitted'
    | 'setWorktreeDrag'
    | 'commitWorktreeDrag'
    | 'sessionDrag'
    | 'sessionDropCommitted'
    | 'setSessionDrag'
    | 'commitSessionDrag'
  >;
  native: Pick<WorkspaceTreeInput['native'], 'openSessionRename' | 'archiveWorktreeSession'>;
  bindings: readonly SessionBinding[];
  workspaceMatchesQuery: boolean;
  workspace: WorkspaceLike;
  workspaceWorktreeNames: string[];
  sameWorkspaceWorktreeDrag: boolean;
  activeWorktrees: WorktreeRecord[];
};
export function ActiveWorktree({
  record,
  source,
  expansion,
  ordering,
  props,
  lifecycle,
  session,
  menus,
  mutation,
  read,
  registration,
  lifecycleState,
  drag,
  native,
  bindings,
  workspaceMatchesQuery,
  workspace,
  workspaceWorktreeNames,
  sameWorkspaceWorktreeDrag,
  activeWorktrees,
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
  const { t, renameSession, forkSession, archiveSession } = props;
  const { branchLabel, branchActions } = lifecycle;
  const { createSession, openWorkspaceSession } = session;
  const { openWorktreeMenuId, setOpenWorktreeMenuId } = menus;
  const { actionPending, setActionError } = mutation;
  const { refresh } = read;
  const { openWorktreeCreator } = registration;
  const { setWorktreeRemoval } = lifecycleState;
  const {
    worktreeDrag,
    worktreeDropCommitted,
    setWorktreeDrag,
    commitWorktreeDrag,
    sessionDrag,
    sessionDropCommitted,
    setSessionDrag,
    commitSessionDrag,
  } = drag;
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
  const worktreeGroupKey = `worktree:${record.worktreeId}`;
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
    record.health === 'repair' || record.health === 'recovery-needed'
      ? 'error'
      : record.health === 'branch-drift'
        ? 'warning'
        : 'done';
  const stateLabel =
    record.health === 'recovery-needed'
      ? t('worktree.recovery')
      : record.health === 'repair'
        ? t('worktree.repair')
        : record.health === 'branch-drift'
          ? t('worktree.branchDrift')
          : t('worktree.ready');
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
        repairGuidance={
          record.health === 'repair'
            ? t('worktree.repairGuidance')
            : record.health === 'recovery-needed'
              ? t('worktree.recoveryGuidance')
              : record.health === 'branch-drift'
                ? t(record.currentBranch === null ? 'worktree.detachedGuidance' : 'worktree.branchDriftGuidance')
                : undefined
        }
        onToggle={() => {
          toggleWorktree(record.worktreeId);
        }}
        onCreateSession={
          record.status === 'active' &&
          record.health !== 'repair' &&
          record.health !== 'recovery-needed'
            ? () => {
                void createSession({
                  workspaceId: record.workspaceId,
                  worktreeId: record.worktreeId,
                  cwd: record.absolutePath,
                });
              }
            : undefined
        }
        menu={{
          ...branchActions(record),
          open: openWorktreeMenuId === record.worktreeId,
          label: record.branch,
          copyPath: record.absolutePath,
          showCreate:
            record.status === 'active' &&
            record.health !== 'repair' &&
            record.health !== 'recovery-needed' &&
            record.currentBranch !== null,
          showRemove: record.status === 'active' && record.health !== 'recovery-needed',
          disabled: actionPending,
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
          onCreateWorktree:
            record.status === 'active' &&
            record.health !== 'repair' &&
            record.health !== 'recovery-needed' &&
            record.currentBranch !== null
              ? () => {
                  openWorktreeCreator(workspace, {
                    baseBranch: record.currentBranch ?? record.branch,
                    newBranch: createNumberedWorktreeName(
                      record.currentBranch ?? record.branch,
                      workspaceWorktreeNames,
                    ),
                  });
                }
              : undefined,
          onRemove:
            record.status === 'active'
              ? () => {
                  setWorktreeRemoval(record);
                  setActionError(undefined);
                }
              : undefined,
        }}
        drag={{
          active: sameWorkspaceWorktreeDrag,
          marker:
            worktreeDrag?.over?.worktreeId === record.worktreeId ? worktreeDrag.over.half : null,
          start: () => {
            worktreeDropCommitted.current = false;
            setWorktreeDrag({
              workspaceId: workspace.workspaceId,
              worktreeId: record.worktreeId,
              over: null,
            });
          },
          hover: (half) => {
            setWorktreeDrag((current) =>
              current === undefined || current.workspaceId !== workspace.workspaceId
                ? current
                : {
                    ...current,
                    over: { worktreeId: record.worktreeId, half },
                  },
            );
          },
          drop: (half) => {
            if (worktreeDrag === undefined) return;
            commitWorktreeDrag(
              worktreeDrag,
              { worktreeId: record.worktreeId, half },
              activeWorktrees.map((candidate) => candidate.worktreeId),
              workspace.workspaceId,
            );
          },
          end: () => {
            setWorktreeDrag(undefined);
            worktreeDropCommitted.current = false;
          },
        }}
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
