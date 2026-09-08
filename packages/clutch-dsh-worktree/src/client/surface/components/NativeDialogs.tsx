import {
  WorktreeSessionRenameDialog,
  WorktreeWorkspaceDeleteDialog,
  WorktreeWorkspaceRenameDialog,
} from './dialogs.js';
import type { WorktreeSurfaceProps } from '../types.js';
import type { useNativeActions } from '../actions/useNativeActions.js';

type Input = {
  props: Pick<WorktreeSurfaceProps, 't'>;
  native: Pick<
    ReturnType<typeof useNativeActions>,
    | 'sessionRenameTarget'
    | 'sessionRenameDraft'
    | 'sessionRenamePending'
    | 'sessionRenameError'
    | 'closeSessionRename'
    | 'setSessionRenameDraft'
    | 'setSessionRenameError'
    | 'confirmSessionRename'
    | 'workspaceRenameTarget'
    | 'workspaceRenameDraft'
    | 'workspaceRenamePending'
    | 'workspaceRenameDuplicate'
    | 'workspaceRenameError'
    | 'closeWorkspaceRename'
    | 'setWorkspaceRenameDraft'
    | 'setWorkspaceRenameError'
    | 'confirmWorkspaceRename'
    | 'workspaceDeleteTarget'
    | 'workspaceDeletePending'
    | 'workspaceDeleteError'
    | 'closeWorkspaceDelete'
    | 'confirmWorkspaceDelete'
  >;
};

export function NativeDialogs({ props, native }: Input) {
  const { t } = props;
  const {
    sessionRenameTarget,
    sessionRenameDraft,
    sessionRenamePending,
    sessionRenameError,
    closeSessionRename,
    setSessionRenameDraft,
    setSessionRenameError,
    confirmSessionRename,
    workspaceRenameTarget,
    workspaceRenameDraft,
    workspaceRenamePending,
    workspaceRenameDuplicate,
    workspaceRenameError,
    closeWorkspaceRename,
    setWorkspaceRenameDraft,
    setWorkspaceRenameError,
    confirmWorkspaceRename,
    workspaceDeleteTarget,
    workspaceDeletePending,
    workspaceDeleteError,
    closeWorkspaceDelete,
    confirmWorkspaceDelete,
  } = native;

  return (
    <>
      <WorktreeSessionRenameDialog
        t={t}
        target={sessionRenameTarget}
        draft={sessionRenameDraft}
        pending={sessionRenamePending}
        error={sessionRenameError}
        onClose={closeSessionRename}
        onDraftChange={(draft) => {
          setSessionRenameDraft(draft);
          setSessionRenameError(undefined);
        }}
        onSubmit={confirmSessionRename}
      />
      <WorktreeWorkspaceRenameDialog
        t={t}
        target={workspaceRenameTarget}
        draft={workspaceRenameDraft}
        pending={workspaceRenamePending}
        duplicate={workspaceRenameDuplicate}
        error={workspaceRenameError}
        onClose={closeWorkspaceRename}
        onDraftChange={(draft) => {
          setWorkspaceRenameDraft(draft);
          setWorkspaceRenameError(undefined);
        }}
        onSubmit={confirmWorkspaceRename}
      />
      <WorktreeWorkspaceDeleteDialog
        t={t}
        target={workspaceDeleteTarget}
        pending={workspaceDeletePending}
        error={workspaceDeleteError}
        onClose={closeWorkspaceDelete}
        onSubmit={confirmWorkspaceDelete}
      />
    </>
  );
}
