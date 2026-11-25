import { worktreeNotifications } from '../notification-center.js';
import { useEffect, useRef, useState } from 'react';
import type { ReportId } from '../../view/worktree-view-errors.js';
import { type WorktreeViewError } from '../../view/worktree-view.js';
import { toNativeWorktreeViewError } from '../shared.js';
import type {
  SessionRenameTarget,
  WorkspaceDeleteTarget,
  WorkspaceLike,
  WorkspaceRenameTarget,
  WorktreeSurfaceProps,
  WorktreeTranslate,
} from '../types.js';
import type { useSurfaceMutation } from './useSurfaceMutation.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';

type Input = {
  source: Pick<ReturnType<typeof useSurfaceSources>, 'workspaces'> &
    Partial<Pick<ReturnType<typeof useSurfaceSources>, 'mode'>>;
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
  const alive = useRef(true);
  const modeRef = useRef(source.mode);
  modeRef.current = source.mode;
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const isActive = () => alive.current && (modeRef.current === undefined || modeRef.current === 'worktree');
  const workspaceRenameReportRef = useRef<ReportId[]>([]);
  const workspaceDeleteReportRef = useRef<ReportId[]>([]);
  const sessionRenameReportRef = useRef<ReportId[]>([]);
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
    workspaceRenameReportRef.current = [];
    setWorkspaceRenameTarget({
      workspaceId: workspace.workspaceId,
      currentTitle: workspace.title,
    });
    setWorkspaceRenameDraft(workspace.title);
    setWorkspaceRenameError(undefined);
  };
  const closeWorkspaceRename = (): void => {
    if (workspaceRenamePending) return;
    workspaceRenameReportRef.current = [];
    setWorkspaceRenameTarget(undefined);
    setWorkspaceRenameError(undefined);
  };
  const confirmWorkspaceRename = async (): Promise<void> => {
    const target = workspaceRenameTarget;
    if (workspaceRenameBlocked || target === undefined) return;
    const meta = {
      context: target.currentTitle,
      describe: (translate: WorktreeTranslate) => translate('workspace.rename') + ' · ' + target.currentTitle,
    };
    if (renameWorkspace === undefined) {
      const reported = worktreeNotifications.reportError({
        code: 'WORKSPACE_RENAME_UNAVAILABLE',
        message: '',
        retryable: true,
      }, meta);
      workspaceRenameReportRef.current.push(reported.reportId);
      setWorkspaceRenameError(reported);
      return;
    }
    const priorReports = [...workspaceRenameReportRef.current];
    if (workspaceRenameError?.reportId && !priorReports.includes(workspaceRenameError.reportId)) {
      priorReports.push(workspaceRenameError.reportId);
    }
    setWorkspaceRenamePending(true);
    setWorkspaceRenameError(undefined);
    try {
      await renameWorkspace(target.workspaceId, workspaceRenameTrimmed);
      for (const reportId of priorReports) worktreeNotifications.resolve(reportId);
      workspaceRenameReportRef.current = workspaceRenameReportRef.current.filter((id) => !priorReports.includes(id));
      if (alive.current) setWorkspaceRenameTarget(undefined);
    } catch (error) {
      const active = isActive();
      const reported = worktreeNotifications.reportError(toNativeWorktreeViewError(error), {
        ...meta,
        ...(active ? {} : { origin: 'retired' }),
      });
      if (active) {
        workspaceRenameReportRef.current.push(reported.reportId);
        setWorkspaceRenameError(reported);
      }
    } finally {
      if (alive.current) setWorkspaceRenamePending(false);
    }
  };
  const openWorkspaceDelete = (workspace: WorkspaceLike): void => {
    workspaceDeleteReportRef.current = [];
    setWorkspaceDeleteTarget({ workspaceId: workspace.workspaceId, title: workspace.title });
    setWorkspaceDeleteError(undefined);
  };
  const closeWorkspaceDelete = (): void => {
    if (workspaceDeletePending) return;
    workspaceDeleteReportRef.current = [];
    setWorkspaceDeleteTarget(undefined);
    setWorkspaceDeleteError(undefined);
  };
  const confirmWorkspaceDelete = async (): Promise<void> => {
    const target = workspaceDeleteTarget;
    if (target === undefined || workspaceDeletePending) return;
    const meta = {
      context: target.title,
      describe: (translate: WorktreeTranslate) => translate('workspace.deleteTitle') + ' · ' + target.title,
    };
    if (deleteWorkspace === undefined) {
      const reported = worktreeNotifications.reportError({
        code: 'WORKSPACE_DELETE_UNAVAILABLE',
        message: '',
        retryable: true,
      }, meta);
      workspaceDeleteReportRef.current.push(reported.reportId);
      setWorkspaceDeleteError(reported);
      return;
    }
    const priorReports = [...workspaceDeleteReportRef.current];
    if (workspaceDeleteError?.reportId && !priorReports.includes(workspaceDeleteError.reportId)) {
      priorReports.push(workspaceDeleteError.reportId);
    }
    setWorkspaceDeletePending(true);
    setWorkspaceDeleteError(undefined);
    try {
      await deleteWorkspace(target.workspaceId);
      for (const reportId of priorReports) worktreeNotifications.resolve(reportId);
      workspaceDeleteReportRef.current = workspaceDeleteReportRef.current.filter((id) => !priorReports.includes(id));
      if (alive.current) setWorkspaceDeleteTarget(undefined);
    } catch (error) {
      const active = isActive();
      const reported = worktreeNotifications.reportError(toNativeWorktreeViewError(error), {
        ...meta,
        ...(active ? {} : { origin: 'retired' }),
      });
      if (active) {
        workspaceDeleteReportRef.current.push(reported.reportId);
        setWorkspaceDeleteError(reported);
      }
    } finally {
      if (alive.current) setWorkspaceDeletePending(false);
    }
  };
  const openSessionRename = (sessionId: string, currentTitle: string): void => {
    sessionRenameReportRef.current = [];
    setSessionRenameTarget({ sessionId, currentTitle });
    setSessionRenameDraft(currentTitle);
    setSessionRenameError(undefined);
  };
  const closeSessionRename = (): void => {
    if (sessionRenamePending) return;
    sessionRenameReportRef.current = [];
    setSessionRenameTarget(undefined);
    setSessionRenameError(undefined);
  };
  const confirmSessionRename = async (): Promise<void> => {
    const target = sessionRenameTarget;
    const title = sessionRenameDraft.trim();
    if (target === undefined || title.length === 0 || sessionRenamePending) return;
    const meta = {
      context: target.currentTitle,
      describe: (translate: WorktreeTranslate) => translate('session.rename') + ' · ' + target.currentTitle,
    };
    if (renameSession === undefined) {
      const reported = worktreeNotifications.reportError({
        code: 'SESSION_RENAME_UNAVAILABLE',
        message: '',
        retryable: true,
      }, meta);
      sessionRenameReportRef.current.push(reported.reportId);
      setSessionRenameError(reported);
      return;
    }
    const priorReports = [...sessionRenameReportRef.current];
    if (sessionRenameError?.reportId && !priorReports.includes(sessionRenameError.reportId)) {
      priorReports.push(sessionRenameError.reportId);
    }
    setSessionRenamePending(true);
    setSessionRenameError(undefined);
    try {
      await renameSession(target.sessionId, title);
      for (const reportId of priorReports) worktreeNotifications.resolve(reportId);
      sessionRenameReportRef.current = sessionRenameReportRef.current.filter((id) => !priorReports.includes(id));
      if (alive.current) setSessionRenameTarget(undefined);
    } catch (error) {
      const active = isActive();
      const reported = worktreeNotifications.reportError(toNativeWorktreeViewError(error), {
        ...meta,
        ...(active ? {} : { origin: 'retired' }),
      });
      if (active) {
        sessionRenameReportRef.current.push(reported.reportId);
        setSessionRenameError(reported);
      }
    } finally {
      if (alive.current) setSessionRenamePending(false);
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
