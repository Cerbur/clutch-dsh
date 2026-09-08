import { useState } from 'react';
import { type WorktreeViewError } from '../../view/worktree-view.js';
import { toNativeWorktreeViewError } from '../shared.js';
import type {
  SessionRenameTarget,
  WorkspaceDeleteTarget,
  WorkspaceLike,
  WorkspaceRenameTarget,
  WorktreeSurfaceProps,
} from '../types.js';
import type { useSurfaceMutation } from './useSurfaceMutation.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';

type Input = {
  source: Pick<ReturnType<typeof useSurfaceSources>, 'workspaces'>;
  props: Pick<
    WorktreeSurfaceProps,
    'renameWorkspace' | 'deleteWorkspace' | 'renameSession' | 'archiveSession'
  >;
  mutation: Pick<ReturnType<typeof useSurfaceMutation>, 'runMutation'>;
};

export function useNativeActions({ source, props, mutation }: Input) {
  const { workspaces } = source;
  const { renameWorkspace, deleteWorkspace, renameSession, archiveSession } = props;
  const { runMutation } = mutation;
  const [sessionRenameTarget, setSessionRenameTarget] = useState<SessionRenameTarget>();
  const [sessionRenameDraft, setSessionRenameDraft] = useState('');
  const [sessionRenamePending, setSessionRenamePending] = useState(false);
  const [sessionRenameError, setSessionRenameError] = useState<WorktreeViewError>();
  const [workspaceRenameTarget, setWorkspaceRenameTarget] = useState<WorkspaceRenameTarget>();
  const [workspaceRenameDraft, setWorkspaceRenameDraft] = useState('');
  const [workspaceRenamePending, setWorkspaceRenamePending] = useState(false);
  const [workspaceRenameError, setWorkspaceRenameError] = useState<WorktreeViewError>();
  const [workspaceDeleteTarget, setWorkspaceDeleteTarget] = useState<WorkspaceDeleteTarget>();
  const [workspaceDeletePending, setWorkspaceDeletePending] = useState(false);
  const [workspaceDeleteError, setWorkspaceDeleteError] = useState<WorktreeViewError>();
  const workspaceRenameTrimmed = workspaceRenameDraft.trim();
  const workspaceRenameDuplicate =
    workspaceRenameTarget !== undefined &&
    workspaceRenameTrimmed.length > 0 &&
    workspaces.items.some(
      (workspace) =>
        workspace.workspaceId !== workspaceRenameTarget.workspaceId &&
        workspace.title === workspaceRenameTrimmed,
    );
  const workspaceRenameBlocked =
    workspaceRenamePending ||
    workspaceRenameTarget === undefined ||
    workspaceRenameTrimmed.length === 0 ||
    workspaceRenameTrimmed === workspaceRenameTarget?.currentTitle ||
    workspaceRenameDuplicate;
  const openWorkspaceRename = (workspace: WorkspaceLike): void => {
    setWorkspaceRenameTarget({
      workspaceId: workspace.workspaceId,
      currentTitle: workspace.title,
    });
    setWorkspaceRenameDraft(workspace.title);
    setWorkspaceRenameError(undefined);
  };
  const closeWorkspaceRename = (): void => {
    if (workspaceRenamePending) return;
    setWorkspaceRenameTarget(undefined);
    setWorkspaceRenameError(undefined);
  };
  const confirmWorkspaceRename = async (): Promise<void> => {
    const target = workspaceRenameTarget;
    if (workspaceRenameBlocked || target === undefined) return;
    if (renameWorkspace === undefined) {
      setWorkspaceRenameError({
        code: 'WORKSPACE_RENAME_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setWorkspaceRenamePending(true);
    setWorkspaceRenameError(undefined);
    try {
      await renameWorkspace(target.workspaceId, workspaceRenameTrimmed);
      setWorkspaceRenameTarget(undefined);
    } catch (error) {
      setWorkspaceRenameError(toNativeWorktreeViewError(error));
    } finally {
      setWorkspaceRenamePending(false);
    }
  };
  const openWorkspaceDelete = (workspace: WorkspaceLike): void => {
    setWorkspaceDeleteTarget({ workspaceId: workspace.workspaceId, title: workspace.title });
    setWorkspaceDeleteError(undefined);
  };
  const closeWorkspaceDelete = (): void => {
    if (workspaceDeletePending) return;
    setWorkspaceDeleteTarget(undefined);
    setWorkspaceDeleteError(undefined);
  };
  const confirmWorkspaceDelete = async (): Promise<void> => {
    const target = workspaceDeleteTarget;
    if (target === undefined || workspaceDeletePending) return;
    if (deleteWorkspace === undefined) {
      setWorkspaceDeleteError({
        code: 'WORKSPACE_DELETE_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setWorkspaceDeletePending(true);
    setWorkspaceDeleteError(undefined);
    try {
      await deleteWorkspace(target.workspaceId);
      setWorkspaceDeleteTarget(undefined);
    } catch (error) {
      setWorkspaceDeleteError(toNativeWorktreeViewError(error));
    } finally {
      setWorkspaceDeletePending(false);
    }
  };
  const openSessionRename = (sessionId: string, currentTitle: string): void => {
    setSessionRenameTarget({ sessionId, currentTitle });
    setSessionRenameDraft(currentTitle);
    setSessionRenameError(undefined);
  };
  const closeSessionRename = (): void => {
    if (sessionRenamePending) return;
    setSessionRenameTarget(undefined);
    setSessionRenameError(undefined);
  };
  const confirmSessionRename = async (): Promise<void> => {
    const target = sessionRenameTarget;
    const title = sessionRenameDraft.trim();
    if (target === undefined || title.length === 0 || sessionRenamePending) return;
    if (renameSession === undefined) {
      setSessionRenameError({
        code: 'SESSION_RENAME_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }
    setSessionRenamePending(true);
    setSessionRenameError(undefined);
    try {
      await renameSession(target.sessionId, title);
      setSessionRenameTarget(undefined);
    } catch (error) {
      setSessionRenameError(toNativeWorktreeViewError(error));
    } finally {
      setSessionRenamePending(false);
    }
  };
  const archiveWorktreeSession = async (sessionId: string): Promise<void> => {
    if (archiveSession === undefined) return;
    await runMutation(() => archiveSession(sessionId));
  };
  return {
    sessionRenameTarget,
    setSessionRenameTarget,
    sessionRenameDraft,
    setSessionRenameDraft,
    sessionRenamePending,
    setSessionRenamePending,
    sessionRenameError,
    setSessionRenameError,
    workspaceRenameTarget,
    setWorkspaceRenameTarget,
    workspaceRenameDraft,
    setWorkspaceRenameDraft,
    workspaceRenamePending,
    setWorkspaceRenamePending,
    workspaceRenameError,
    setWorkspaceRenameError,
    workspaceDeleteTarget,
    setWorkspaceDeleteTarget,
    workspaceDeletePending,
    setWorkspaceDeletePending,
    workspaceDeleteError,
    setWorkspaceDeleteError,
    workspaceRenameTrimmed,
    workspaceRenameDuplicate,
    workspaceRenameBlocked,
    openWorkspaceRename,
    closeWorkspaceRename,
    confirmWorkspaceRename,
    openWorkspaceDelete,
    closeWorkspaceDelete,
    confirmWorkspaceDelete,
    openSessionRename,
    closeSessionRename,
    confirmSessionRename,
    archiveWorktreeSession,
  };
}
