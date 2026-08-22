import type {
  BranchRecord,
  SessionBinding,
  WorktreeManager,
  WorktreeRecord,
} from '../contract/index.js';

/** A DSH Session exists even when the external Worktree binding needs repair. */
export class WorktreeSessionBindingError extends Error {
  readonly code = 'SESSION_BINDING_FAILED';
  readonly retryable = true;
  readonly sessionId: string;
  readonly cause: unknown;

  constructor(sessionId: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(reason);
    this.name = 'WorktreeSessionBindingError';
    this.sessionId = sessionId;
    this.cause = cause;
  }
}

export type WorktreeGitReadiness =
  | { readonly status: 'ready' }
  | { readonly status: 'noRepository'; readonly error: WorktreeViewError }
  | { readonly status: 'noInitialCommit'; readonly error: WorktreeViewError }
  | { readonly status: 'noLocalBranch' };

export interface WorktreeViewData {
  readonly worktrees: readonly WorktreeRecord[];
  readonly branches: readonly BranchRecord[];
  readonly bindings: readonly SessionBinding[];
  readonly readiness: WorktreeGitReadiness;
}

export interface WorktreeWorkspaceView extends WorktreeViewData {
  readonly workspaceId: string;
}

/** Reuse the previous ID snapshot when DSH republishes equivalent Workspace items. */
export function stableWorkspaceIds(
  previous: readonly string[],
  next: readonly string[],
): readonly string[] {
  if (previous.length !== next.length) return next;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return next;
  }
  return previous;
}

/** Prefer the branch checked out by the DSH Workspace, then fall back to any local branch. */
export function selectDefaultBaseBranch(branches: readonly BranchRecord[]): string {
  return branches.find((branch) => branch.isCurrent)?.name ?? branches[0]?.name ?? '';
}

/** Keep a valid user choice across branch-list refreshes, otherwise choose the current branch. */
export function reconcileBaseBranchSelection(
  selectedBranch: string,
  branches: readonly BranchRecord[],
): string {
  if (branches.some((branch) => branch.name === selectedBranch)) return selectedBranch;
  return selectDefaultBaseBranch(branches);
}

/** Return copyable, read-only setup commands for a Git readiness state. */
export function worktreeSetupCommands(
  status: WorktreeGitReadiness['status'],
): readonly string[] {
  switch (status) {
    case 'noRepository':
      return [
        'git init',
        'printf "# README\\n" > README.md',
        'git add README.md',
        'git commit -m "Initial commit"',
      ];
    case 'noInitialCommit':
      return [
        'printf "# README\\n" > README.md',
        'git add README.md',
        'git commit -m "Initial commit"',
      ];
    case 'noLocalBranch':
      return ['git switch -c main'];
    case 'ready':
      return [];
  }
}

function browserRandomUuid(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/** Generate a short, editable default branch name without colliding with known local names. */
export function createDefaultWorktreeName(
  existingNames: Iterable<string>,
  randomUuid: () => string = browserRandomUuid,
): string {
  const usedNames = new Set([...existingNames].map((name) => name.trim()));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = randomUuid().replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
    if (suffix.length < 8) continue;
    const candidate = `dsh/${suffix}`;
    if (!usedNames.has(candidate)) return candidate;
  }
  throw new Error('Unable to generate an available default Worktree name.');
}

export interface CreateSessionForWorktreeInput {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly cwd: string;
}

export interface WorktreeViewError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Hide DSH-archived Sessions from the browser-local Worktree projection. */
export function filterArchivedSessionIds(
  sessionIds: readonly string[],
  archivedSessionIds: readonly string[],
): readonly string[] {
  return sessionIds.filter((sessionId) => !archivedSessionIds.includes(sessionId));
}

export type WorktreeViewAction =
  | {
      readonly type: 'createWorktree';
      readonly input: Parameters<WorktreeManager['createWorktree']>[0];
    }
  | {
      readonly type: 'removeWorktree';
      readonly input: Parameters<WorktreeManager['removeWorktree']>[0];
    };

function readinessFromBranchError(error: unknown): WorktreeGitReadiness | undefined {
  const viewError = toWorktreeViewError(error);
  if (viewError.code === 'WORKSPACE_NOT_GIT_REPOSITORY') {
    return { status: 'noRepository', error: viewError };
  }
  if (viewError.code === 'WORKTREE_REQUIRES_INITIAL_COMMIT') {
    return { status: 'noInitialCommit', error: viewError };
  }
  return undefined;
}

/** Read all three Worktree projections needed by the surface in one refresh. */
export async function loadWorktreeView(
  manager: WorktreeManager,
  workspaceId: string,
): Promise<WorktreeViewData> {
  const [worktreesResult, branchesResult, bindingsResult] = await Promise.allSettled([
    manager.listWorktrees({ workspaceId }),
    manager.listBranches({ workspaceId }),
    manager.listBindings({ workspaceId }),
  ]);

  if (worktreesResult.status === 'rejected') throw worktreesResult.reason;
  if (bindingsResult.status === 'rejected') throw bindingsResult.reason;
  if (branchesResult.status === 'rejected') {
    const readiness = readinessFromBranchError(branchesResult.reason);
    if (readiness !== undefined) {
      return {
        worktrees: worktreesResult.value,
        branches: [],
        bindings: bindingsResult.value,
        readiness,
      };
    }
    throw branchesResult.reason;
  }

  return {
    worktrees: worktreesResult.value,
    branches: branchesResult.value,
    bindings: bindingsResult.value,
    readiness: branchesResult.value.length > 0
      ? { status: 'ready' }
      : { status: 'noLocalBranch' },
  };
}

/** Load one independent projection per DSH Workspace for the flat sidebar hierarchy. */
export async function loadWorktreeViews(
  manager: WorktreeManager,
  workspaceIds: readonly string[],
): Promise<readonly WorktreeWorkspaceView[]> {
  return Promise.all(
    workspaceIds.map(async (workspaceId) => ({
      workspaceId,
      ...(await loadWorktreeView(manager, workspaceId)),
    })),
  );
}

/** Resolve a row-half drop target to native-style optional before-anchor semantics. */
export function resolveWorktreeMove(
  worktreeIds: readonly string[],
  sourceWorktreeId: string,
  targetWorktreeId: string,
  half: 'before' | 'after',
): { readonly beforeWorktreeId?: string } | undefined {
  const sourceIndex = worktreeIds.indexOf(sourceWorktreeId);
  const targetIndex = worktreeIds.indexOf(targetWorktreeId);
  if (sourceIndex === -1 || targetIndex === -1) return undefined;

  const beforeWorktreeId = half === 'before'
    ? targetWorktreeId
    : worktreeIds[targetIndex + 1];
  if (beforeWorktreeId === sourceWorktreeId) return undefined;

  const anchorIndex = beforeWorktreeId === undefined
    ? worktreeIds.length
    : worktreeIds.indexOf(beforeWorktreeId);
  if (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1) return undefined;
  return beforeWorktreeId === undefined ? {} : { beforeWorktreeId };
}

/** Keep mutation routing in the browser Consumer while leaving wire details to the adapter. */
export async function executeWorktreeAction(
  manager: WorktreeManager,
  action: WorktreeViewAction,
): Promise<WorktreeRecord | void> {
  if (action.type === 'createWorktree') {
    return manager.createWorktree(action.input);
  }
  if (action.type === 'removeWorktree') {
    await manager.removeWorktree(action.input);
    return;
  }
}

/**
 * Create a normal DSH Session at a Worktree cwd, then add the external binding.
 * A binding failure deliberately leaves the DSH-created Session intact.
 */
export async function createSessionForWorktree(input: CreateSessionForWorktreeInput & {
  readonly createSession: (input: { cwd: string }) => Promise<string>;
  readonly manager: Pick<WorktreeManager, 'bindSession'>;
  readonly beforeOpen?: (sessionId: string) => void;
  readonly openSession: (sessionId: string) => void;
}): Promise<string> {
  const sessionId = await input.createSession({ cwd: input.cwd });
  try {
    await input.manager.bindSession({
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
      sessionId,
    });
  } catch (error) {
    throw new WorktreeSessionBindingError(sessionId, error);
  }
  input.beforeOpen?.(sessionId);
  input.openSession(sessionId);
  return sessionId;
}

function recordDetails(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const details = (value as { readonly details?: unknown }).details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return undefined;
  return details as Readonly<Record<string, unknown>>;
}

/** Convert any adapter/Gateway failure into renderable, retry-aware UI data. */
export function toWorktreeViewError(error: unknown): WorktreeViewError {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly retryable?: unknown;
    };
    const details = error instanceof WorktreeSessionBindingError
      ? { ...(recordDetails(error) ?? {}), sessionId: error.sessionId }
      : recordDetails(error);
    return {
      code: typeof candidate.code === 'string' ? candidate.code : 'WORKTREE_VIEW_FAILED',
      message: typeof candidate.message === 'string' ? candidate.message : '',
      retryable: candidate.retryable !== false,
      ...(details === undefined ? {} : { details }),
    };
  }
  return {
    code: 'WORKTREE_VIEW_FAILED',
    message: '',
    retryable: true,
  };
}
