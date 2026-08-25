import {
  Button,
  Input,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { formatWorktreeViewError } from './worktree-error-copy.js';
import { worktreeSetupCommands } from './worktree-view.js';
import type {
  SessionRenameDialogProps,
  WorktreeCreateDialogProps,
  WorktreeRemovalDialogProps,
  WorktreeSetupStatus,
  WorkspaceDeleteDialogProps,
  WorkspaceRenameDialogProps,
} from './worktree-surface-types.js';
import styles from './worktree.css';

function worktreeSetupMessage(
  status: WorktreeSetupStatus,
  t: WorktreeCreateDialogProps['t'],
): string {
  switch (status) {
    case 'gitNotInstalled':
      return t('worktree.setup.gitNotInstalled');
    case 'noRepository':
      return t('worktree.setup.noRepository');
    case 'noInitialCommit':
      return t('worktree.setup.noInitialCommit');
    case 'noLocalBranch':
      return t('worktree.setup.noLocalBranch');
  }
}

export function WorktreeSessionRenameDialog({
  t,
  target,
  draft,
  pending,
  error,
  onClose,
  onDraftChange,
  onSubmit,
}: SessionRenameDialogProps) {
  return (
    <Modal
      open={target !== undefined}
      onClose={onClose}
      closeLabel={t('dialog.close')}
      title={t('session.rename')}
      footer={(
        <>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={pending || draft.trim().length === 0}
            onClick={() => {
              void onSubmit();
            }}
          >
            {t('dialog.rename')}
          </Button>
        </>
      )}
    >
      <Input
        className={styles.renameInput}
        value={draft}
        aria-label={t('session.name')}
        autoFocus
        disabled={pending}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        onChange={(event) => {
          onDraftChange(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void onSubmit();
          }
        }}
      />
      {error !== undefined && (
        <p className={styles.renameError} role="alert">
          {formatWorktreeViewError(error, t)}
        </p>
      )}
    </Modal>
  );
}

export function WorktreeWorkspaceRenameDialog({
  t,
  target,
  draft,
  pending,
  duplicate,
  error,
  onClose,
  onDraftChange,
  onSubmit,
}: WorkspaceRenameDialogProps) {
  if (target === undefined) return null;

  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('dialog.closeWorkspaceRename')}
      title={t('workspace.renameTitle')}
      footer={(
        <>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={
              pending ||
              draft.trim().length === 0 ||
              draft.trim() === target.currentTitle ||
              duplicate
            }
            onClick={() => {
              void onSubmit();
            }}
          >
            {t('dialog.rename')}
          </Button>
        </>
      )}
    >
      <Input
        className={styles.renameInput}
        value={draft}
        aria-label={t('workspace.name')}
        autoFocus
        disabled={pending}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        onChange={(event) => {
          onDraftChange(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void onSubmit();
          }
        }}
      />
      {duplicate && (
        <p className={styles.renameError} role="alert">
          {t('workspace.duplicate')}
        </p>
      )}
      {error !== undefined && (
        <p className={styles.renameError} role="alert">
          {formatWorktreeViewError(error, t)}
        </p>
      )}
    </Modal>
  );
}

export function WorktreeWorkspaceDeleteDialog({
  t,
  target,
  pending,
  error,
  onClose,
  onSubmit,
}: WorkspaceDeleteDialogProps) {
  if (target === undefined) return null;

  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('dialog.closeWorkspaceDelete')}
      title={t('workspace.deleteTitle')}
      description={t('workspace.deleteDescription', { name: target.title })}
      footer={(
        <>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              void onSubmit();
            }}
          >
            {t('dialog.delete')}
          </Button>
        </>
      )}
    >
      {error !== undefined && (
        <p className={styles.renameError} role="alert">
          {formatWorktreeViewError(error, t)}
        </p>
      )}
    </Modal>
  );
}

export function WorktreeCreateDialog({
  t,
  workspace,
  view,
  setupStatus,
  canCreate,
  selectedBranch,
  newBranch,
  actionPending,
  onClose,
  onSelectedBranchChange,
  onNewBranchChange,
  onSubmit,
}: WorktreeCreateDialogProps) {
  if (workspace === undefined) return null;
  const setupCommands = setupStatus === undefined ? [] : worktreeSetupCommands(setupStatus);

  return (
    <Modal
      open
      onClose={() => {
        if (actionPending) return;
        onClose();
      }}
      closeLabel={t('dialog.closeWorktreeCreate')}
      title={t('worktree.createTitle')}
      description={t('worktree.createDescription', { name: workspace.title })}
      footer={(
        <>
          <Button variant="outline" disabled={actionPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={
              actionPending ||
              selectedBranch.length === 0 ||
              newBranch.trim().length === 0
            }
            onClick={() => {
              void onSubmit();
            }}
          >
            {t('worktree.create')}
          </Button>
        </>
      )}
    >
      {canCreate ? (
        <>
          <label className={styles.modalField}>
            {t('worktree.baseBranch')}
            <select
              className={styles.actionSelect}
              aria-label={t('worktree.baseBranch')}
              value={selectedBranch}
              disabled={actionPending}
              onChange={(event) => {
                onSelectedBranchChange(event.currentTarget.value);
              }}
            >
              {view?.branches.map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                  {branch.isCurrent ? t('branch.current') : ''}
                  {branch.checkedOut ? t('branch.checkedOut') : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.modalField}>
            {t('worktree.name')}
            <Input
              className={styles.renameInput}
              aria-label={t('worktree.name')}
              value={newBranch}
              placeholder="dsh/12345678"
              disabled={actionPending}
              onChange={(event) => {
                onNewBranchChange(event.currentTarget.value);
              }}
            />
          </label>
        </>
      ) : (
        <div
          className={styles.gitReadiness}
          data-worktree-readiness={setupStatus ?? 'loading'}
          role="alert"
        >
          <p className={styles.message}>
            {setupStatus === undefined
              ? t('status.loading')
              : worktreeSetupMessage(setupStatus, t)}
          </p>
          {setupCommands.length > 0 && (
            <pre
              className={styles.commandBlock}
              aria-label={t('worktree.setup.commands')}
            >
              {setupCommands.join('\n')}
            </pre>
          )}
        </div>
      )}
    </Modal>
  );
}

export function WorktreeRemovalDialog({
  t,
  worktree,
  actionPending,
  onClose,
  onSubmit,
}: WorktreeRemovalDialogProps) {
  if (worktree === undefined) return null;

  return (
    <Modal
      open
      onClose={() => {
        if (actionPending) return;
        onClose();
      }}
      closeLabel={t('dialog.closeWorktreeRemove')}
      title={t('worktree.remove')}
      description={t('worktree.removeDescription', { name: worktree.branch })}
      footer={(
        <>
          <Button variant="outline" disabled={actionPending} onClick={onClose}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={actionPending}
            onClick={() => {
              void onSubmit();
            }}
          >
            {t('worktree.remove')}
          </Button>
        </>
      )}
    />
  );
}
