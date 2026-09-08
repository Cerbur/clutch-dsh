import { WorktreeCreateDialog } from './dialogs.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useRegistrationState } from '../state/useRegistrationState.js';
import type { useSurfaceMutation } from '../actions/useSurfaceMutation.js';
import type { useSurfaceRefresh } from '../state/useSurfaceRefresh.js';
import type { useWorktreeRegistration } from '../actions/useWorktreeRegistration.js';

type Input = {
  props: Pick<WorktreeSurfaceProps, 't'>;
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
    | 'worktreeModalMode'
    | 'importCandidates'
    | 'selectedImportPath'
    | 'selectedBranch'
    | 'newBranch'
    | 'worktreeModalWorkspaceId'
    | 'modalReadViewRef'
    | 'setSelectedBranch'
    | 'setNewBranch'
    | 'setSelectedImportPath'
  >;
  mutation: Pick<ReturnType<typeof useSurfaceMutation>, 'actionPending'>;
  read: Pick<ReturnType<typeof useSurfaceRefresh>, 'loadModalWorktreeView'>;
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
    worktreeModalMode,
    importCandidates,
    selectedImportPath,
    selectedBranch,
    newBranch,
    worktreeModalWorkspaceId,
    modalReadViewRef,
    setSelectedBranch,
    setNewBranch,
    setSelectedImportPath,
  } = registrationState;
  const { actionPending } = mutation;
  const { loadModalWorktreeView } = read;

  return (
    <>
      <WorktreeCreateDialog
        t={t}
        workspace={modalWorkspace}
        view={modalView}
        readError={modalReadError}
        setupStatus={modalSetupStatus}
        canCreate={modalCanCreate}
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
        onNewBranchChange={setNewBranch}
        onSubmit={submitWorktree}
      />
    </>
  );
}
