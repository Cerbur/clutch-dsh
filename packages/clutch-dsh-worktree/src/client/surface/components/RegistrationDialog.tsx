import { useEffect, useRef } from 'react';
import { WorktreeCreateDialog } from './dialogs.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useRegistrationState } from '../state/useRegistrationState.js';
import type { useSurfaceMutation } from '../actions/useSurfaceMutation.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';
import type { useWorktreeRegistration } from '../actions/useWorktreeRegistration.js';

type Input = {
  props: Pick<WorktreeSurfaceProps, 't' | 'manager'>;
  registration: Pick<
    ReturnType<typeof useWorktreeRegistration>,
    | 'modalWorkspace'
    | 'modalView'
    | 'modalSetupStatus'
    | 'modalCanCreate'
    | 'closeWorktreeCreator'
    | 'changeWorktreeModalMode'
    | 'loadImportCandidates'
    | 'submitWorktree'
  >;
  registrationState: Pick<
    ReturnType<typeof useRegistrationState>,
    | 'modalReadError'
    | 'modalReadLoading'
    | 'worktreeModalMode'
    | 'importCandidates'
    | 'selectedImportPath'
    | 'selectedBranch'
    | 'newBranch'
    | 'worktreeModalWorkspaceId'
    | 'modalReadViewRef'
    | 'modalWorkspaceIdRef'
    | 'modalGenerationRef'
    | 'modalLifetimeRef'
    | 'setModalBranches'
    | 'setSelectedBranch'
    | 'setNewBranch'
    | 'setSelectedImportPath'
  >;
  mutation: Pick<ReturnType<typeof useSurfaceMutation>, 'actionPending'>;
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'loadModalWorktreeView' | 'refresh'>;
};

export function RegistrationDialog({
  props,
  registration,
  registrationState,
  mutation,
  read,
}: Input) {
  const { t } = props;
  const {
    modalWorkspace,
    modalView,
    modalSetupStatus,
    modalCanCreate,
    closeWorktreeCreator,
    changeWorktreeModalMode,
    loadImportCandidates,
    submitWorktree,
  } = registration;
  const {
    modalReadError,
    modalReadLoading,
    worktreeModalMode,
    importCandidates,
    selectedImportPath,
    selectedBranch,
    newBranch,
    worktreeModalWorkspaceId,
    modalReadViewRef,
    modalWorkspaceIdRef,
    modalGenerationRef,
    modalLifetimeRef,
    setModalBranches,
    setSelectedBranch,
    setNewBranch,
    setSelectedImportPath,
  } = registrationState;
  const { actionPending } = mutation;
  const { loadModalWorktreeView } = read;
  // Tab/request invalidation must not restart the native Modal entry animation.
  const shell = useRef({ workspaceId: worktreeModalWorkspaceId, manager: props.manager,
    lifetime: modalLifetimeRef.current, generation: 0 });
  if (shell.current.workspaceId !== worktreeModalWorkspaceId ||
      shell.current.manager !== props.manager || shell.current.lifetime !== modalLifetimeRef.current) {
    shell.current = { workspaceId: worktreeModalWorkspaceId, manager: props.manager,
      lifetime: modalLifetimeRef.current, generation: shell.current.generation + 1 };
  }
  // Workspace equality cannot distinguish closing and reopening the same dialog.
  const lifecycle = useRef({ workspaceId: worktreeModalWorkspaceId, manager: props.manager,
    mode: worktreeModalMode, ownerGeneration: modalGenerationRef.current, generation: 0 });
  if (lifecycle.current.workspaceId !== worktreeModalWorkspaceId ||
      lifecycle.current.manager !== props.manager || lifecycle.current.mode !== worktreeModalMode ||
      lifecycle.current.ownerGeneration !== modalGenerationRef.current) {
    lifecycle.current = { workspaceId: worktreeModalWorkspaceId, manager: props.manager,
      mode: worktreeModalMode, ownerGeneration: modalGenerationRef.current,
      generation: lifecycle.current.generation + 1 };
  }
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const generation = lifecycle.current.generation;
  const ownerGeneration = modalGenerationRef.current;
  const isCurrent = () => alive.current && lifecycle.current.generation === generation &&
    modalGenerationRef.current === ownerGeneration &&
    modalWorkspaceIdRef.current === worktreeModalWorkspaceId;

  return (
    <>
      <WorktreeCreateDialog
        key={shell.current.generation}
        pickerKey={generation}
        t={t}
        workspace={modalWorkspace}
        view={modalView}
        readError={modalReadError}
        setupStatus={modalSetupStatus}
        canCreate={modalCanCreate}
        branchesLoading={modalReadLoading || modalView === undefined}
        mode={worktreeModalMode}
        importCandidates={importCandidates}
        selectedImportPath={selectedImportPath}
        selectedBranch={selectedBranch}
        newBranch={newBranch}
        actionPending={actionPending}
        onClose={() => {
          if (actionPending || !isCurrent()) return;
          lifecycle.current.generation++;
          closeWorktreeCreator();
        }}
        onRetry={() => {
          if (worktreeModalWorkspaceId === undefined || !isCurrent()) return;
          lifecycle.current.generation++;
          modalReadViewRef.current = undefined;
          setSelectedBranch('');
          setNewBranch('');
          loadModalWorktreeView(worktreeModalWorkspaceId);
        }}
        onModeChange={(mode) => {
          if (!isCurrent()) return;
          if (mode !== worktreeModalMode) lifecycle.current.generation++;
          changeWorktreeModalMode(mode);
        }}
        onRetryImportCandidates={() => {
          if (worktreeModalWorkspaceId !== undefined) {
            void loadImportCandidates(worktreeModalWorkspaceId);
          }
        }}
        onSelectedImportPathChange={setSelectedImportPath}
        onSelectedBranchChange={setSelectedBranch}
        onLoadBranches={props.manager === undefined || worktreeModalWorkspaceId === undefined ? undefined
          : async () => {
            if (!isCurrent()) return [];
            const branches = await props.manager!.listBranches({ workspaceId: worktreeModalWorkspaceId });
            if (isCurrent()) setModalBranches(branches);
            return branches;
          }}
        onFetchBranches={props.manager?.fetchRemoteBranches === undefined || worktreeModalWorkspaceId === undefined ? undefined : async () => {
          if (!isCurrent()) return [];
          const workspaceId = worktreeModalWorkspaceId;
          try {
            const branches = await props.manager!.fetchRemoteBranches({ workspaceId });
            if (isCurrent()) setModalBranches(branches);
            return branches;
          } finally {
            if (isCurrent()) {
              await read.refresh({ preserveCurrent: true, invalidateContext: false,
                scope: { kind: 'workspace', workspaceId } });
            }
          }
        }}
        onNewBranchChange={setNewBranch}
        onSubmit={submitWorktree}
      />
    </>
  );
}
