import { worktreeNotifications } from '../notification-center.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorktreeRecord } from '../../../contract/index.js';
import type { ReportId } from '../../view/worktree-view-errors.js';
import {
  createDefaultWorktreeName,
  executeWorktreeAction,
  reconcileBaseBranchSelection,
  selectDefaultBaseBranch,
  toWorktreeViewError,
  WorktreeSessionBindingError,
  type CreateSessionForWorktreeInput,
  type WorktreeViewError,
} from '../../view/worktree-view.js';
import { WorktreeCreateDefaults } from '../shared.js';
import type {
  WorkspaceLike,
  WorktreeRegistrationMode,
  WorktreeSetupStatus,
  WorktreeSurfaceProps,
} from '../types.js';
import type { useRegistrationState } from '../state/useRegistrationState.js';
import type { useSessionActions } from './useSessionActions.js';
import type { useSurfaceMutation } from './useSurfaceMutation.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';
import type { useSurfaceSources } from '../state/useSurfaceSources.js';

type Input = {
  source: Pick<ReturnType<typeof useSurfaceSources>, 'workspaces'>;
  registrationState: Pick<
    ReturnType<typeof useRegistrationState>,
    | 'worktreeModalWorkspaceId'
    | 'modalReadLoading'
    | 'modalBranches'
    | 'setModalBranches'
    | 'setSelectedBranch'
    | 'setNewBranch'
    | 'setImportCandidates'
    | 'importCandidatesGuard'
    | 'modalWorkspaceIdRef'
    | 'modalGenerationRef'
    | 'modalLifetimeRef'
    | 'modalReadLoader'
    | 'modalReadViewRef'
    | 'setWorktreeModalWorkspaceId'
    | 'setModalReadError'
    | 'setModalReadLoading'
    | 'setWorktreeModalMode'
    | 'setSelectedImportPath'
    | 'importCandidates'
    | 'newBranch'
    | 'selectedImportPath'
    | 'worktreeModalMode'
    | 'selectedBranch'
  >;
  read: Pick<
    ReturnType<typeof useSurfaceRefresh>,
    'viewByWorkspace' | 'loadModalWorktreeView' | 'refresh'
  >;
  props: Pick<WorktreeSurfaceProps, 'manager' | 'createSessionForWorktree'>;
  mutation: Pick<
    ReturnType<typeof useSurfaceMutation>,
    'actionPending' | 'clearActionError' | 'reportActionError' | 'setActionPending'
  >;
  session: Pick<ReturnType<typeof useSessionActions>, 'setPendingSessionBinding'>;
};

export function useWorktreeRegistration({
  source,
  registrationState,
  read,
  props,
  mutation,
  session,
}: Input) {
  const { workspaces } = source;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const importCandidatesReportRef = useRef<{ readonly workspaceId: string; readonly reportId: ReportId }>();
  const branchConflictReportRef = useRef<ReportId>();
  const [branchConflict, setBranchConflict] = useState<WorktreeViewError>();
  const {
    worktreeModalWorkspaceId,
    modalReadLoading,
    modalBranches,
    setModalBranches,
    setSelectedBranch,
    setNewBranch,
    setImportCandidates,
    importCandidatesGuard,
    modalWorkspaceIdRef,
    modalGenerationRef,
    modalLifetimeRef,
    modalReadLoader,
    modalReadViewRef,
    setWorktreeModalWorkspaceId,
    setModalReadError,
    setModalReadLoading,
    setWorktreeModalMode,
    setSelectedImportPath,
    importCandidates,
    newBranch,
    selectedImportPath,
    worktreeModalMode,
    selectedBranch,
  } = registrationState;
  const { viewByWorkspace, loadModalWorktreeView, refresh } = read;
  const { manager, createSessionForWorktree: createSessionCallback } = props;
  const { actionPending, clearActionError, reportActionError, setActionPending } = mutation;
  const { setPendingSessionBinding } = session;
  const modalWorkspace = workspaces.items.find(
    (workspace) => workspace.workspaceId === worktreeModalWorkspaceId,
  );
  const modalProjection =
    worktreeModalWorkspaceId === undefined
      ? undefined
      : modalReadViewRef.current?.workspaceId === worktreeModalWorkspaceId
        ? modalReadViewRef.current : viewByWorkspace.get(worktreeModalWorkspaceId);
  const modalView = useMemo(() => modalProjection === undefined || modalBranches === undefined
    ? modalProjection : { ...modalProjection, branches: modalBranches }, [modalProjection, modalBranches]);
  const modalReadiness = modalView?.readiness;
  const modalSetupStatus: WorktreeSetupStatus | undefined =
    modalView === undefined
      ? undefined
      : modalReadiness?.status === 'ready'
        ? undefined
        : modalReadiness?.status;
  const modalCanCreate =
    !modalReadLoading && modalSetupStatus === undefined && modalReadiness?.status === 'ready';
  useEffect(() => {
    if (worktreeModalWorkspaceId === undefined || modalView === undefined) return;
    if (modalReadLoading) return;
    if (modalView.readiness.status !== 'ready') {
      setSelectedBranch('');
      setNewBranch('');
      return;
    }
    setSelectedBranch((current) => current === 'HEAD' && modalView.checkout?.currentHead !== undefined
      ? current : modalView.checkout?.currentHead?.kind !== 'branch' && modalView.checkout?.currentHead !== undefined && current === ''
        ? 'HEAD' : modalView.branches.length > 0
          ? reconcileBaseBranchSelection(current, modalView.branches)
          : current || modalView.currentBranch || 'HEAD');
    setNewBranch((current) => {
      if (current.length > 0) return current;
      const existingNames = [
        ...modalView.branches.map((branch) => branch.name),
        ...modalView.worktrees.map((worktree) => worktree.branch),
      ];
      return createDefaultWorktreeName(existingNames);
    });
  }, [modalView, worktreeModalWorkspaceId, modalReadLoading]);
  const loadImportCandidates = useCallback(
    async (workspaceId: string): Promise<void> => {
      if (manager === undefined) return;
      setImportCandidates((current) => ({ status: 'loading', candidates: current.candidates }));
      const guard = importCandidatesGuard.current;
      const generation = guard.begin();
      const isCurrent = () => alive.current && guard.isCurrent(generation) && modalWorkspaceIdRef.current === workspaceId;
      try {
        const candidates = await manager.listImportCandidates({ workspaceId });
        if (isCurrent()) {
          const previous = importCandidatesReportRef.current;
          if (previous?.workspaceId === workspaceId) {
            worktreeNotifications.resolve(previous.reportId);
            importCandidatesReportRef.current = undefined;
          }
          setImportCandidates({ status: 'ready', candidates });
        }
      } catch (error) {
        const active = isCurrent();
        const failure = worktreeNotifications.reportError(toWorktreeViewError(error), { origin: active ? 'inline' : 'retired', context: workspaceId });
        if (active) {
          importCandidatesReportRef.current = { workspaceId, reportId: failure.reportId };
          setImportCandidates((current) => ({
            status: 'error', candidates: current.candidates, error: failure,
          }));
        }
      }
    },
    [manager],
  );

  const closeWorktreeCreator = (force = false): void => {
    if (actionPending && !force) return;
    modalGenerationRef.current++;
    modalLifetimeRef.current++;
    modalReadLoader.current.invalidate();
    modalReadViewRef.current = undefined;
    importCandidatesGuard.current.invalidate();
    importCandidatesReportRef.current = undefined;
    branchConflictReportRef.current = undefined;
    setWorktreeModalWorkspaceId(undefined);
    setModalReadError(undefined);
    setModalReadLoading(false);
    setModalBranches(undefined);
  };
  const openWorktreeCreator = (
    workspace: WorkspaceLike,
    defaults: WorktreeCreateDefaults = {},
  ): void => {
    const view = viewByWorkspace.get(workspace.workspaceId);
    const loadOptions = view?.readiness.status === 'workspaceMissing' ? { revalidate: true } : undefined;
    modalGenerationRef.current++;
    modalLifetimeRef.current++;
    modalReadLoader.current.invalidate();
    modalReadViewRef.current = undefined;
    importCandidatesGuard.current.invalidate();
    importCandidatesReportRef.current = undefined;
    branchConflictReportRef.current = undefined;
    setWorktreeModalWorkspaceId(workspace.workspaceId);
    setBranchConflict(undefined);
    setModalBranches(undefined);
    setWorktreeModalMode('create');
    setImportCandidates({ status: 'idle', candidates: [] });
    setSelectedImportPath(undefined);
    clearActionError();
    setModalReadError(undefined);
    setModalReadLoading(false);
    if (view === undefined || view.branches.length === 0) {
      setSelectedBranch(defaults.baseBranch ?? '');
      setNewBranch(defaults.newBranch ?? '');
      loadModalWorktreeView(workspace.workspaceId, loadOptions);
      return;
    }
    setSelectedBranch(defaults.baseBranch ?? (view.checkout?.currentHead !== undefined && view.checkout.currentHead.kind !== 'branch'
      ? 'HEAD' : selectDefaultBaseBranch(view.branches)));
    setNewBranch(
      defaults.newBranch ??
        createDefaultWorktreeName([
          ...view.branches.map((branch) => branch.name),
          ...view.worktrees.map((worktree) => worktree.branch),
        ]),
    );
    loadModalWorktreeView(workspace.workspaceId, loadOptions);
  };
  const changeWorktreeModalMode = (mode: WorktreeRegistrationMode): void => {
    if (mode !== worktreeModalMode) modalGenerationRef.current++;
    setWorktreeModalMode(mode);
    if (
      mode === 'import' &&
      worktreeModalWorkspaceId !== undefined &&
      importCandidates.status === 'idle'
    ) {
      void loadImportCandidates(worktreeModalWorkspaceId);
    }
  };
  const continueWorktreeRegistration = async (
    registeredWorktree: WorktreeRecord,
  ): Promise<void> => {
    closeWorktreeCreator(true);
    const refreshRegistration = () => refresh({
      scope: { kind: 'workspace', workspaceId: registeredWorktree.workspaceId },
      preserveCurrent: true,
    });
    if (createSessionCallback === undefined) {
      reportActionError({
        code: 'WORKTREE_REGISTRATION_SESSION_UNAVAILABLE',
        message: '',
        retryable: true,
        details: { workspaceId: registeredWorktree.workspaceId },
      });
      await refreshRegistration();
      return;
    }

    const sessionInput: CreateSessionForWorktreeInput = {
      workspaceId: registeredWorktree.workspaceId,
      worktreeId: registeredWorktree.worktreeId,
      cwd: registeredWorktree.absolutePath,
    };
    try {
      await createSessionCallback(sessionInput, (sessionId, projectionReady) => refresh({
        alreadyInvalidated: projectionReady,
        scope: { kind: 'workspace', workspaceId: registeredWorktree.workspaceId },
        preserveCurrent: true,
        openingSession: { sessionId, worktreeId: registeredWorktree.worktreeId },
      }));
    } catch (error) {
      const sessionError = toWorktreeViewError(error);
      const reported = reportActionError({ ...sessionError, details: { ...sessionError.details, workspaceId: registeredWorktree.workspaceId } });
      if (error instanceof WorktreeSessionBindingError && alive.current) {
        setPendingSessionBinding({ ...sessionInput, sessionId: error.sessionId,
          error: reported });
      }
      // Registration already committed even when opening the first Session failed.
      await refreshRegistration();
    }
  };
  const submitWorktree = async (): Promise<void> => {
    const worktreeName = newBranch.trim();
    const selectedImportCandidate = importCandidates.candidates.find(
      (candidate) => candidate.absolutePath === selectedImportPath,
    );
    if (manager === undefined || modalWorkspace === undefined) return;
    if (
      worktreeModalMode === 'create' &&
      (!modalCanCreate || selectedBranch.length === 0 || worktreeName.length === 0)
    )
      return;
    if (worktreeModalMode === 'import' && selectedImportCandidate === undefined) return;
    const generation = modalGenerationRef.current;
    setActionPending(true);
    setBranchConflict(undefined);
    clearActionError();
    setPendingSessionBinding(undefined);
    try {
      const registeredWorktree =
        worktreeModalMode === 'create'
          ? await executeWorktreeAction(manager, {
              type: 'createWorktree',
              input: {
                workspaceId: modalWorkspace.workspaceId,
                branch: selectedBranch,
                ...(selectedBranch === 'HEAD' ? {
                  fromHead: true,
                  expectedHeadCommit: modalView?.checkout?.currentHead?.commit,
                } : {}),
                newBranch: worktreeName,
              },
            })
          : await executeWorktreeAction(manager, {
              type: 'importWorktree',
              input: {
                workspaceId: modalWorkspace.workspaceId,
                absolutePath: selectedImportCandidate!.absolutePath,
              },
            });
      if (registeredWorktree === undefined) {
        throw {
          code: 'WORKTREE_RECORD_MISSING',
          message: '',
          retryable: true,
        };
      }
      const previousConflict = branchConflictReportRef.current;
      if (previousConflict) {
        worktreeNotifications.resolve(previousConflict);
        branchConflictReportRef.current = undefined;
      }
      await continueWorktreeRegistration(registeredWorktree);
    } catch (error) {
      const failure = toWorktreeViewError(error);
      const staleModal = !alive.current || generation !== modalGenerationRef.current;
      if (worktreeModalMode === 'create' && failure.code === 'WORKTREE_BRANCH_CONFLICT') {
        if (staleModal) {
          worktreeNotifications.reportError(failure, { origin: 'retired', context: modalWorkspace.path });
        } else {
          const reported = worktreeNotifications.reportError(failure, { origin: 'inline', context: modalWorkspace.path });
          branchConflictReportRef.current = reported.reportId;
          setBranchConflict(reported);
        }
      } else if (staleModal) {
        worktreeNotifications.reportError(failure, { origin: 'retired', context: modalWorkspace.path });
      } else {
        reportActionError(failure);
        if (failure.code === 'WORKSPACE_ROOT_MISSING') {
          loadModalWorktreeView(modalWorkspace.workspaceId, { revalidate: true });
        }
      }
    } finally {
      if (alive.current) setActionPending(false);
    }
  };
  return {
    branchConflict,
    setBranchConflict,
    modalWorkspace,
    modalView,
    modalReadiness,
    modalSetupStatus,
    modalCanCreate,
    loadImportCandidates,
    closeWorktreeCreator,
    openWorktreeCreator,
    changeWorktreeModalMode,
    continueWorktreeRegistration,
    submitWorktree,
  };
}
