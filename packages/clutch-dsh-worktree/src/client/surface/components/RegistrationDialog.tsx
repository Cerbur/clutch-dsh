import { WorktreeCreateDialog } from './dialogs.js';
import type { BranchRecord } from '../../../contract/index.js';
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
    setModalBranches,
    setSelectedBranch,
    setNewBranch,
    setSelectedImportPath,
  } = registrationState;
  const { actionPending } = mutation;
  const { loadModalWorktreeView } = read;
  const acceptBranches = (workspaceId: string, branches: readonly BranchRecord[]) => {
    if (modalWorkspaceIdRef.current !== workspaceId) return;
    setModalBranches(branches);
  };

  return (
    <>
      <WorktreeCreateDialog
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
        onClose={closeWorktreeCreator}
        onRetry={() => {
          if (worktreeModalWorkspaceId === undefined) return;
          modalReadViewRef.current = undefined;
          setSelectedBranch('');
          setNewBranch('');
          loadModalWorktreeView(worktreeModalWorkspaceId);
        }}
        onModeChange={changeWorktreeModalMode}
        onRetryImportCandidates={() => {
          if (worktreeModalWorkspaceId !== undefined) {
            void loadImportCandidates(worktreeModalWorkspaceId);
          }
        }}
        onSelectedImportPathChange={setSelectedImportPath}
        onSelectedBranchChange={setSelectedBranch}
        onLoadBranches={props.manager === undefined || worktreeModalWorkspaceId === undefined ? undefined
          : async () => {
            const branches = await props.manager!.listBranches({ workspaceId: worktreeModalWorkspaceId });
            acceptBranches(worktreeModalWorkspaceId, branches);
            return branches;
          }}
        onFetchBranches={props.manager?.fetchRemoteBranches === undefined || worktreeModalWorkspaceId === undefined ? undefined : async () => {
          const workspaceId = worktreeModalWorkspaceId;
          try {
            const branches = await props.manager!.fetchRemoteBranches({ workspaceId });
            acceptBranches(workspaceId, branches);
            return branches;
          } finally {
            await read.refresh({ preserveCurrent: true, invalidateContext: false,
              scope: { kind: 'workspace', workspaceId } });
          }
        }}
        onNewBranchChange={setNewBranch}
        onSubmit={submitWorktree}
      />
    </>
  );
}
