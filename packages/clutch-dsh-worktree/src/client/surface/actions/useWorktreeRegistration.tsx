import { useCallback, useEffect } from 'react';
import type { WorktreeRecord } from '../../../contract/index.js';
import {
  createDefaultWorktreeName,
  executeWorktreeAction,
  reconcileBaseBranchSelection,
  selectDefaultBaseBranch,
  toWorktreeViewError,
  WorktreeSessionBindingError,
  WorktreeSessionPermissionError,
  type CreateSessionForWorktreeInput,
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
    | 'setSelectedBranch'
    | 'setNewBranch'
    | 'setImportCandidates'
    | 'importCandidatesGuard'
    | 'modalWorkspaceIdRef'
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
    'actionPending' | 'setActionError' | 'setActionPending'
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
  const {
    worktreeModalWorkspaceId,
    modalReadLoading,
    setSelectedBranch,
    setNewBranch,
    setImportCandidates,
    importCandidatesGuard,
    modalWorkspaceIdRef,
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
  const { actionPending, setActionError, setActionPending } = mutation;
  const { setPendingSessionBinding } = session;
  const modalWorkspace = workspaces.items.find(
    (workspace) => workspace.workspaceId === worktreeModalWorkspaceId,
  );
  const modalView =
    worktreeModalWorkspaceId === undefined
      ? undefined
      : viewByWorkspace.get(worktreeModalWorkspaceId);
  const modalReadiness = modalView?.readiness;
  const modalSetupStatus: WorktreeSetupStatus | undefined =
    modalView === undefined
      ? undefined
      : modalReadiness?.status === 'ready'
        ? modalView.branches.length === 0
          ? 'noLocalBranch'
          : undefined
        : modalReadiness?.status;
  const modalCanCreate =
    !modalReadLoading && modalSetupStatus === undefined && modalReadiness?.status === 'ready';
  useEffect(() => {
    if (worktreeModalWorkspaceId === undefined || modalView === undefined) return;
    if (modalView.readiness.status !== 'ready') {
      setSelectedBranch('');
      setNewBranch('');
      return;
    }
    setSelectedBranch((current) => reconcileBaseBranchSelection(current, modalView.branches));
    setNewBranch((current) => {
      if (current.length > 0) return current;
      const existingNames = [
        ...modalView.branches.map((branch) => branch.name),
        ...modalView.worktrees.map((worktree) => worktree.branch),
      ];
      return createDefaultWorktreeName(existingNames);
    });
  }, [modalView, worktreeModalWorkspaceId]);
  const loadImportCandidates = useCallback(
    async (workspaceId: string): Promise<void> => {
      if (manager === undefined) return;
      setImportCandidates((current) => ({ status: 'loading', candidates: current.candidates }));
      await importCandidatesGuard.current.run(
        () => manager.listImportCandidates({ workspaceId }),
        (candidates) => {
          if (modalWorkspaceIdRef.current !== workspaceId) return;
          setImportCandidates({ status: 'ready', candidates });
        },
        (error) => {
          if (modalWorkspaceIdRef.current !== workspaceId) return;
          setImportCandidates((current) => ({
            status: 'error',
            candidates: current.candidates,
            error: toWorktreeViewError(error),
          }));
        },
      );
    },
    [manager],
  );
  const closeWorktreeCreator = (force = false): void => {
    if (actionPending && !force) return;
    modalReadLoader.current.invalidate();
    modalReadViewRef.current = undefined;
    importCandidatesGuard.current.invalidate();
    setWorktreeModalWorkspaceId(undefined);
    setModalReadError(undefined);
    setModalReadLoading(false);
  };
  const openWorktreeCreator = (
    workspace: WorkspaceLike,
    defaults: WorktreeCreateDefaults = {},
  ): void => {
    const view = viewByWorkspace.get(workspace.workspaceId);
    modalReadLoader.current.invalidate();
    modalReadViewRef.current = undefined;
    importCandidatesGuard.current.invalidate();
    setWorktreeModalWorkspaceId(workspace.workspaceId);
    setWorktreeModalMode('create');
    setImportCandidates({ status: 'idle', candidates: [] });
    setSelectedImportPath(undefined);
    setActionError(undefined);
    setModalReadError(undefined);
    setModalReadLoading(false);
    if (view === undefined) {
      setSelectedBranch(defaults.baseBranch ?? '');
      setNewBranch(defaults.newBranch ?? '');
      loadModalWorktreeView(workspace.workspaceId);
      return;
    }
    setSelectedBranch(defaults.baseBranch ?? selectDefaultBaseBranch(view.branches));
    setNewBranch(
      defaults.newBranch ??
        createDefaultWorktreeName([
          ...view.branches.map((branch) => branch.name),
          ...view.worktrees.map((worktree) => worktree.branch),
        ]),
    );
  };
  const changeWorktreeModalMode = (mode: WorktreeRegistrationMode): void => {
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
    if (createSessionCallback === undefined) {
      await refresh({
        scope: { kind: 'workspace', workspaceId: registeredWorktree.workspaceId },
        preserveCurrent: true,
      });
      setActionError({
        code: 'WORKTREE_REGISTRATION_SESSION_UNAVAILABLE',
        message: '',
        retryable: true,
      });
      return;
    }

    const sessionInput: CreateSessionForWorktreeInput = {
      workspaceId: registeredWorktree.workspaceId,
      worktreeId: registeredWorktree.worktreeId,
      cwd: registeredWorktree.absolutePath,
    };
    try {
      await createSessionCallback(sessionInput);
    } catch (error) {
      if (error instanceof WorktreeSessionBindingError && error.retryable) {
        setPendingSessionBinding({ ...sessionInput, sessionId: error.sessionId });
      }
      if (error instanceof WorktreeSessionPermissionError && error.retryable) {
        setPendingSessionBinding({
          ...sessionInput,
          sessionId: error.sessionId,
          permissionRequired: true,
        });
      }
      throw error;
    }
    await refresh({
      scope: { kind: 'workspace', workspaceId: registeredWorktree.workspaceId },
      preserveCurrent: true,
    });
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
    setActionPending(true);
    setActionError(undefined);
    setPendingSessionBinding(undefined);
    try {
      const registeredWorktree =
        worktreeModalMode === 'create'
          ? await executeWorktreeAction(manager, {
              type: 'createWorktree',
              input: {
                workspaceId: modalWorkspace.workspaceId,
                branch: selectedBranch,
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
      await continueWorktreeRegistration(registeredWorktree);
    } catch (error) {
      setActionError(toWorktreeViewError(error));
    } finally {
      setActionPending(false);
    }
  };
  return {
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
