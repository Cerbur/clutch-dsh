import type { WorktreeManager, WorktreeRecord, WorktreeSessionCreationResult } from '../contract/index.js';
import { WorktreeDirectoryEntryNotStarted, type WorktreeToolSessionPort } from './native-session.js';

/** Preserve the structured cause across the partial-success RPC boundary. */
export function sessionFailure(error: unknown): { error: string; causeCode?: string; rootPath?: string } {
  const cause = error instanceof WorktreeDirectoryEntryNotStarted ? error.cause : error;
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  const details = cause && typeof cause === 'object' && 'details' in cause &&
    typeof cause.details === 'object' && cause.details !== null
    ? cause.details as { readonly rootPath?: unknown } : undefined;
  const rootPath = typeof details?.rootPath === 'string' && details.rootPath.length > 0 ? details.rootPath : undefined;
  const message = error && typeof error === 'object' && 'message' in error ? error.message : error;
  return {
    error: String(message).slice(0, 700),
    ...(typeof code === 'string' ? { causeCode: code } : {}),
    ...(rootPath === undefined ? {} : { rootPath }),
  };
}

/** Native creation owns Workspace membership; native directory publication precedes binding and input. */
export async function createBoundWorktreeSession(input: {
  record: WorktreeRecord;
  manager: Pick<WorktreeManager, 'bindSession'>;
  sessions: Pick<WorktreeToolSessionPort, 'create' | 'enterWorkingDirectory' | 'initializeWorktreeSession'>;
  signal: AbortSignal;
  check(): void;
}): Promise<WorktreeSessionCreationResult> {
  const { record, sessions, manager, signal, check } = input;
  check();
  const { sessionId } = await sessions.create(sessions.enterWorkingDirectory
    ? { cwd: record.absolutePath, workspaceId: record.workspaceId }
    : { cwd: record.absolutePath }, signal);
  let bound = false;
  let initializationStarted = false;
  try {
    check();
    initializationStarted = true;
    const bind = async () => {
      check();
      await manager.bindSession({ workspaceId: record.workspaceId, worktreeId: record.worktreeId, sessionId }, 'new-session');
      bound = true;
    };
    if (sessions.initializeWorktreeSession) await sessions.initializeWorktreeSession(sessionId, record, signal, bind);
    else {
      await sessions.enterWorkingDirectory?.(sessionId, record.absolutePath, signal);
      await bind();
    }
    return { sessionId, bound: true };
  } catch (error) {
    return { sessionId, bound, ...sessionFailure(error),
      ...((!initializationStarted && sessions.enterWorkingDirectory) || error instanceof WorktreeDirectoryEntryNotStarted
        ? { retryCreation: true } : {}) };
  }
}
