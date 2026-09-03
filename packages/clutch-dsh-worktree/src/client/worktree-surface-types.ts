import type { ReactNode } from 'react';
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
import type {
  PropsLocale,
  PropsRuntime,
  PropsStore,
  TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots';
import type {
  WorktreeImportCandidate,
  WorktreeManager,
  WorktreePermissionManager,
  WorktreePermissionResult,
  WorktreeRecord,
} from '../contract/index.js';
import { WORKTREE_NS } from './locales.js';
import type { WorktreeExpandStateStore } from './worktree-expand-state.js';
import type {
  WorktreeFullAccessConfirmationController,
} from './worktree-permission.js';
import type { WorktreeSessionOrderStore } from './worktree-session-order.js';
import type { WorktreeForkRecoveryStore } from './worktree-session-fork.js';
import type { createWorktreeViewStore } from './view-mode-store.js';
import type { SessionListLike, SessionPresentation } from './session-view.js';
import type {
  CreateSessionForWorktreeInput,
  WorktreeGitReadiness,
  WorktreeViewError,
  WorktreeWorkspaceView,
} from './worktree-view.js';
import type { WorktreeViewReader } from './worktree-view-read.js';

export interface WorkspaceLike {
  readonly workspaceId: string;
  readonly path: string;
  readonly title: string;
  readonly sessionIds: readonly string[];
}

export interface WorkspaceListLike {
  readonly items: readonly WorkspaceLike[];
  readonly archivedSessionIds?: readonly string[];
}

export interface WorktreePermissionNotice {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionId?: string;
  readonly result: WorktreePermissionResult;
}

/** Apply-time facts and DSH navigation callbacks used by the surface. */
export interface WorktreeSurfaceInjected {
  readonly available: boolean;
  readonly expandState: WorktreeExpandStateStore;
  readonly sessionOrder: WorktreeSessionOrderStore;
  readonly manager?: WorktreeManager;
  readonly viewReader: WorktreeViewReader;
  readonly permission?: Pick<
    WorktreePermissionManager,
    'ensureWorktreePermission' | 'normalizeDetachedWorktreePermissions'
  >;
  readonly confirmFullAccess?: (
    input: {
      readonly workspaceId: string;
      readonly worktreeId: string;
      readonly sessionId: string;
      readonly cwd: string;
    },
  ) => boolean | Promise<boolean>;
  readonly fullAccessConfirmation?: WorktreeFullAccessConfirmationController;
  readonly onPermissionResult?: (
    input: {
      readonly workspaceId: string;
      readonly worktreeId: string;
      readonly sessionId: string;
      readonly cwd: string;
    },
    result: WorktreePermissionResult,
  ) => void;
  readonly onPermissionNotice?: (
    input: {
      readonly workspaceId: string;
      readonly worktreeId: string;
      readonly sessionId?: string;
    },
    result: WorktreePermissionResult,
  ) => void;
  readonly permissionNotice?: ObservableSnapshot<WorktreePermissionNotice | undefined>;
  readonly createWorkspace?: () => Promise<void>;
  readonly createSessionForWorktree?: (input: CreateSessionForWorktreeInput) => Promise<string>;
  readonly invalidateWorktreeContext?: (workspaceId?: string) => Promise<void>;
  readonly createMainSession?: (workspaceId: string) => void;
  readonly renameWorkspace?: (workspaceId: string, title: string) => Promise<void>;
  readonly deleteWorkspace?: (workspaceId: string) => Promise<void>;
  readonly insertWorkspaceBefore?: (
    workspaceId: string,
    beforeWorkspaceId?: string,
  ) => Promise<void>;
  readonly insertSessionBefore?: (
    workspaceId: string,
    sessionId: string,
    beforeSessionId?: string,
  ) => Promise<void>;
  readonly insertWorktreeBefore?: (
    workspaceId: string,
    worktreeId: string,
    beforeWorktreeId?: string,
  ) => Promise<readonly string[]>;
  readonly renameSession?: (sessionId: string, title: string) => Promise<void>;
  readonly forkSession?: (sessionId: string) => void;
  readonly archiveSession?: (sessionId: string) => Promise<void>;
  readonly forkRecovery?: WorktreeForkRecoveryStore;
  readonly retryForkSession?: (key: string) => Promise<void>;
  readonly ensureSessionWorkspace?: (workspaceId: string, sessionId: string) => void;
  readonly syncSessionWorkspaces?: (
    bindings: readonly { workspaceId: string; sessionId: string }[],
  ) => void;
  readonly openSession: (sessionId: string) => void;
}

/** Props derived from the frame overlay slot, shared state, and injected face. */
export type WorktreeSurfaceProps = PropsRuntime<'shell.overlay'> &
  PropsStore<ReturnType<typeof createWorktreeViewStore>> &
  PropsLocale<typeof WORKTREE_NS> &
  WorktreeSurfaceInjected;

export type WorktreeTranslate = TranslateNS<typeof WORKTREE_NS>;

export type WorktreeSetupStatus = Exclude<WorktreeGitReadiness['status'], 'ready'>;

export type WorktreeRegistrationMode = 'create' | 'import';

export type ImportCandidatesState =
  | { readonly status: 'idle'; readonly candidates: readonly WorktreeImportCandidate[] }
  | { readonly status: 'loading'; readonly candidates: readonly WorktreeImportCandidate[] }
  | { readonly status: 'ready'; readonly candidates: readonly WorktreeImportCandidate[] }
  | {
      readonly status: 'error';
      readonly candidates: readonly WorktreeImportCandidate[];
      readonly error: WorktreeViewError;
    };

export interface ReadState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly views: readonly WorktreeWorkspaceView[];
  readonly error?: WorktreeViewError;
  readonly targetError?: TargetedWorktreeReadError;
}

export type WorktreeRefreshScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'workspace'; readonly workspaceId: string }
  | { readonly kind: 'workspaces'; readonly workspaceIds: readonly string[] };

export interface TargetedWorktreeReadError {
  readonly workspaceIds: readonly string[];
  readonly error: WorktreeViewError;
}

export interface RefreshOptions {
  readonly preserveCurrent?: boolean;
  readonly invalidateContext?: boolean;
  readonly scope?: WorktreeRefreshScope;
}

export interface PendingSessionBinding extends CreateSessionForWorktreeInput {
  readonly sessionId: string;
  readonly permissionRequired?: boolean;
}

export interface SessionRenameTarget {
  readonly sessionId: string;
  readonly currentTitle: string;
}

export interface SessionDragProps {
  readonly active: boolean;
  readonly marker: 'before' | 'after' | null;
  readonly start: () => void;
  readonly hover: (half: 'before' | 'after') => void;
  readonly drop: (half: 'before' | 'after') => void;
  readonly end: () => void;
}

export interface WorkspaceDragProps {
  readonly active: boolean;
  readonly marker: 'before' | 'after' | null;
  readonly start: () => void;
  readonly hover: (half: 'before' | 'after') => void;
  readonly drop: (half: 'before' | 'after') => void;
  readonly end: () => void;
}

export interface WorktreeDragProps {
  readonly active: boolean;
  readonly marker: 'before' | 'after' | null;
  readonly start: () => void;
  readonly hover: (half: 'before' | 'after') => void;
  readonly drop: (half: 'before' | 'after') => void;
  readonly end: () => void;
}

export interface WorktreeSessionRowProps {
  readonly t: WorktreeTranslate;
  readonly sessionId: string;
  readonly blank: boolean;
  readonly current: boolean;
  readonly label: string;
  readonly presentation?: SessionPresentation;
  readonly drag: SessionDragProps;
  readonly actionPending: boolean;
  readonly onOpen: () => void;
  readonly onRename?: (sessionId: string, currentTitle: string) => void;
  readonly onFork?: (sessionId: string) => void;
  readonly onArchive?: (sessionId: string) => void;
}

export interface WorktreeWorkspaceRowProps {
  readonly t: WorktreeTranslate;
  readonly workspace: WorkspaceLike;
  readonly expanded: boolean;
  readonly hasOngoingSession: boolean;
  readonly actionPending: boolean;
  readonly menuOpen: boolean;
  readonly drag: WorkspaceDragProps;
  readonly onToggle: () => void;
  readonly onCreateWorktree: () => void;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  readonly onMenuOpenChange: (open: boolean) => void;
}

export interface WorktreeGroupMenuProps {
  readonly open: boolean;
  readonly label: string;
  readonly copyPath: string;
  readonly showCreate: boolean;
  readonly showRemove: boolean;
  readonly disabled: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreateWorktree?: () => void;
  readonly onRemove?: () => void;
}

export type WorktreeGroupKind = 'main' | 'worktree';

export interface WorktreeGroupRowProps {
  readonly t: WorktreeTranslate;
  readonly kind: WorktreeGroupKind;
  readonly label: string;
  readonly worktreeId?: string;
  readonly expanded: boolean;
  readonly hasOngoingSession: boolean;
  readonly icon: ReactNode;
  readonly workspaceTitle: string;
  readonly state?: 'done' | 'warning' | 'error';
  readonly stateLabel?: string;
  readonly onToggle: () => void;
  readonly onCreateSession?: () => void;
  readonly menu?: WorktreeGroupMenuProps;
  readonly drag?: WorktreeDragProps;
}

export interface WorktreeSessionGroupProps {
  readonly t: WorktreeTranslate;
  readonly groupKey: string;
  readonly sessionIds: readonly string[];
  readonly workspaceId: string;
  readonly currentSessionId?: string;
  readonly expanded: boolean;
  readonly actionPending: boolean;
  readonly sessions: SessionListLike;
  readonly sessionPresentations: Readonly<Record<string, SessionPresentation | undefined>>;
  readonly dragState: SessionDragState | undefined;
  readonly onToggleExpanded: () => void;
  readonly onStartDrag: (groupKey: string, sessionId: string) => void;
  readonly onHoverDrag: (sessionId: string, half: 'before' | 'after') => void;
  readonly onClearDrag: () => void;
  readonly onFinishDrag: () => void;
  readonly onCommitDrag: (
    activeDrag: SessionDragState,
    over: NonNullable<SessionDragState['over']>,
    sessionIds: readonly string[],
    workspaceId: string,
  ) => void;
  readonly onOpen: (sessionId: string) => void;
  readonly onRename?: (sessionId: string, currentTitle: string) => void;
  readonly onFork?: (sessionId: string) => void;
  readonly onArchive?: (sessionId: string) => void;
}

export interface WorkspaceDragState {
  readonly workspaceId: string;
  readonly over: {
    readonly workspaceId: string;
    readonly half: 'before' | 'after';
  } | null;
}

export interface WorkspaceRenameTarget {
  readonly workspaceId: string;
  readonly currentTitle: string;
}

export interface WorkspaceDeleteTarget {
  readonly workspaceId: string;
  readonly title: string;
}

export interface SessionDragState {
  readonly groupKey: string;
  readonly sessionId: string;
  readonly over: {
    readonly sessionId: string;
    readonly half: 'before' | 'after';
  } | null;
}

export interface WorktreeDragState {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly over: {
    readonly worktreeId: string;
    readonly half: 'before' | 'after';
  } | null;
}

export interface SessionRenameDialogProps {
  readonly t: WorktreeTranslate;
  readonly target: SessionRenameTarget | undefined;
  readonly draft: string;
  readonly pending: boolean;
  readonly error: WorktreeViewError | undefined;
  readonly onClose: () => void;
  readonly onDraftChange: (draft: string) => void;
  readonly onSubmit: () => void;
}

export interface WorkspaceRenameDialogProps {
  readonly t: WorktreeTranslate;
  readonly target: WorkspaceRenameTarget | undefined;
  readonly draft: string;
  readonly pending: boolean;
  readonly duplicate: boolean;
  readonly error: WorktreeViewError | undefined;
  readonly onClose: () => void;
  readonly onDraftChange: (draft: string) => void;
  readonly onSubmit: () => void;
}

export interface WorkspaceDeleteDialogProps {
  readonly t: WorktreeTranslate;
  readonly target: WorkspaceDeleteTarget | undefined;
  readonly pending: boolean;
  readonly error: WorktreeViewError | undefined;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}

export interface WorktreeCreateDialogProps {
  readonly t: WorktreeTranslate;
  readonly workspace: WorkspaceLike | undefined;
  readonly view: WorktreeWorkspaceView | undefined;
  readonly readError?: WorktreeViewError;
  readonly setupStatus: WorktreeSetupStatus | undefined;
  readonly canCreate: boolean;
  readonly mode: WorktreeRegistrationMode;
  readonly importCandidates: ImportCandidatesState;
  readonly selectedImportPath: string | undefined;
  readonly selectedBranch: string;
  readonly newBranch: string;
  readonly actionPending: boolean;
  readonly onClose: () => void;
  readonly onRetry?: () => void;
  readonly onModeChange: (mode: WorktreeRegistrationMode) => void;
  readonly onRetryImportCandidates: () => void;
  readonly onSelectedImportPathChange: (absolutePath: string) => void;
  readonly onSelectedBranchChange: (branch: string) => void;
  readonly onNewBranchChange: (branch: string) => void;
  readonly onSubmit: () => void;
}

export interface WorktreeRemovalDialogProps {
  readonly t: WorktreeTranslate;
  readonly worktree: WorktreeRecord | undefined;
  readonly actionPending: boolean;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}
