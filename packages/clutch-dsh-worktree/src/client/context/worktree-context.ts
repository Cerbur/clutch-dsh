import type { BranchRecord, SessionBinding, WorktreeRecord, WorkspaceCheckout } from '../../contract/index.js';
import { isWindowsPath, normalizeWindowsPath } from '../../contract/windows-path.js';

export type WorktreeSessionContextReason =
  | 'no-session'
  | 'not-ready'
  | 'unbound'
  | 'detached'
  | 'repair'
  | 'stale'
  | 'workspace-mismatch';

export type WorktreeSessionContext =
  | {
      readonly kind: 'main';
      readonly workspaceId: string;
      readonly label: string;
      readonly source: 'current-branch' | 'current-head';
    }
  | {
      readonly kind: 'worktree';
      readonly workspaceId: string;
      readonly worktreeId: string;
      readonly label: string;
      readonly source: 'active-binding';
    }
  | {
      readonly kind: 'none';
      readonly reason: WorktreeSessionContextReason;
    };

export interface WorktreeContextInput {
  readonly checkout?: WorkspaceCheckout;
  readonly currentSessionId?: string;
  /** Selected Workspace used by the blank Hero before a Session exists. */
  readonly currentWorkspaceId?: string;
  readonly workspaces: readonly {
    readonly workspaceId: string;
    readonly sessionIds: readonly string[];
  }[];
  readonly branches: readonly BranchRecord[];
  readonly worktrees: readonly WorktreeRecord[];
  readonly bindings: readonly SessionBinding[];
}

const none = (reason: WorktreeSessionContextReason): WorktreeSessionContext => ({
  kind: 'none',
  reason,
});

export type HeaderCheckout = { readonly kind: 'main' | 'worktree'; readonly label: string };

/** Match the native Session cwd against Git's checkout roots, including nested worktree pools. */
export function resolveHeaderCheckout(
  value: WorktreeSessionContext, checkout: WorkspaceCheckout | undefined, cwd: string | undefined,
): HeaderCheckout | undefined {
  if (value.kind === 'none') return undefined;
  if (!cwd || !checkout?.linkedHeads) return value;
  const normalize = isWindowsPath(cwd) ? normalizeWindowsPath : (path: string) => path;
  const directory = normalize(cwd);
  const roots = [
    { path: checkout.gitRootPath, kind: 'main' as const,
      label: checkout.currentHead?.name ?? (value.kind === 'main' ? value.label : undefined) },
    ...checkout.linkedHeads.map((head) => ({ ...head, kind: 'worktree' as const })),
  ];
  let longest = -1;
  let match: HeaderCheckout | undefined;
  for (const entry of roots) {
    const root = normalize(entry.path).replace(/\/+$/u, '');
    if (root.length > longest && (directory === root || directory.startsWith(root + '/'))) {
      longest = root.length;
      match = entry.label ? { kind: entry.kind, label: entry.label } : undefined;
    }
  }
  return match;
}

/** Resolve the branch or active Worktree label for one current DSH Session. */
export function resolveWorktreeSessionContext(
  input: WorktreeContextInput,
): WorktreeSessionContext {
  const sessionId = input.currentSessionId;
  if (sessionId === undefined && input.currentWorkspaceId === undefined) return none('no-session');

  const workspace = sessionId === undefined
    ? input.workspaces.find(({ workspaceId }) => workspaceId === input.currentWorkspaceId)
    : input.workspaces.find(({ sessionIds }) => sessionIds.includes(sessionId));
  if (workspace === undefined) return none('unbound');

  const binding = sessionId === undefined
    ? undefined
    : input.bindings.find((candidate) => candidate.sessionId === sessionId);
  if (binding !== undefined) {
    if (binding.workspaceId !== workspace.workspaceId) return none('workspace-mismatch');
    if (binding.status === 'detached') return none('detached');

    const record = input.worktrees.find(
      (candidate) => candidate.worktreeId === binding.worktreeId,
    );
    if (record === undefined || record.workspaceId !== workspace.workspaceId) {
      return none(record === undefined ? 'stale' : 'workspace-mismatch');
    }
    if (record.diskCleanup === 'completed' || record.health === 'cleaned') {
      return none('detached');
    }
    if (record.health === 'repair' || record.health === 'recovery-needed') {
      return none('repair');
    }
    if (record.branch.length === 0) return none('not-ready');

    return {
      kind: 'worktree',
      workspaceId: workspace.workspaceId,
      worktreeId: record.worktreeId,
      label: record.branch,
      source: 'active-binding',
    };
  }

  const currentBranch = input.branches.find(({ isCurrent }) => isCurrent);
  const currentHead = input.checkout?.currentHead;
  const label = currentHead?.name ?? currentBranch?.name;
  if (label === undefined || label.length === 0) return none('not-ready');

  return {
    kind: 'main',
    workspaceId: workspace.workspaceId,
    label,
    source: currentHead !== undefined && currentHead.kind !== 'branch' ? 'current-head' : 'current-branch',
  };
}
