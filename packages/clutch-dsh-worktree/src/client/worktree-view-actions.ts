import type {
  WorktreeManager,
  WorktreePermissionManager,
  WorktreePermissionResult,
  WorktreeRecord,
} from '../contract/index.js';
import { WorktreeSessionBindingError } from './worktree-view-errors.js';

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

export type WorktreeViewAction =
  | {
      readonly type: 'createWorktree';
      readonly input: Parameters<WorktreeManager['createWorktree']>[0];
    }
  | {
      readonly type: 'importWorktree';
      readonly input: Parameters<WorktreeManager['importWorktree']>[0];
    }
  | {
      readonly type: 'removeWorktree';
      readonly input: Parameters<WorktreeManager['removeWorktree']>[0];
    };

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
  permission?: Pick<WorktreePermissionManager, 'normalizeDetachedWorktreePermissions'>,
  onPermissionResult?: (
    input: { readonly workspaceId: string; readonly worktreeId: string },
    result: WorktreePermissionResult,
  ) => void,
): Promise<WorktreeRecord | void> {
  if (action.type === 'createWorktree') {
    return manager.createWorktree(action.input);
  }
  if (action.type === 'importWorktree') {
    return manager.importWorktree(action.input);
  }
  if (action.type === 'removeWorktree') {
    await manager.removeWorktree(action.input);
    const result = await permission?.normalizeDetachedWorktreePermissions({
      workspaceId: action.input.workspaceId,
      worktreeId: action.input.worktreeId,
    });
    if (result !== undefined) {
      onPermissionResult?.({
        workspaceId: action.input.workspaceId,
        worktreeId: action.input.worktreeId,
      }, result);
    }
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
  readonly beforeOpen?: (sessionId: string) => void | Promise<void>;
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
  await input.beforeOpen?.(sessionId);
  input.openSession(sessionId);
  return sessionId;
}
