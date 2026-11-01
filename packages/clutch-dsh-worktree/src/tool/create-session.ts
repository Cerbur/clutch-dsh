import type { WorktreeManager, WorktreeRecord, WorktreeSessionCreationResult } from '../contract/index.js';
import type { WorktreeToolSessionPort } from './native-session.js';

/** Native creation owns Workspace membership; native directory publication precedes binding and input. */
export async function createBoundWorktreeSession(input: {
  record: WorktreeRecord;
  manager: Pick<WorktreeManager, 'bindSession'>;
  sessions: Pick<WorktreeToolSessionPort, 'create' | 'enterWorkingDirectory'>;
  signal: AbortSignal;
  check(): void;
}): Promise<WorktreeSessionCreationResult> {
  const { record, sessions, manager, signal, check } = input;
  check();
  const { sessionId } = await sessions.create(sessions.enterWorkingDirectory
    ? { cwd: record.absolutePath, workspaceId: record.workspaceId }
    : { cwd: record.absolutePath });
  try {
    check();
    await sessions.enterWorkingDirectory?.(sessionId, record.absolutePath, signal);
    check();
    await manager.bindSession({ workspaceId: record.workspaceId, worktreeId: record.worktreeId, sessionId });
    return { sessionId, bound: true };
  } catch (error) {
    return { sessionId, bound: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 700) };
  }
}
