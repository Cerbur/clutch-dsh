import { randomUUID } from 'node:crypto';
import type { WorktreeRecord, WorktreeManager } from '../contract/index.js';
import type { WorktreeSessionDispatchResult } from '../contract/baseline-sync.js';
import type { ToolModel, WorktreeToolSessionPort } from './native-session.js';

/** Shared by the Agent tool and Dashboard tasks; all mutations use native DSH APIs. */
export async function dispatchWorktreeSession(input: {
  readonly record: WorktreeRecord;
  readonly manager: Pick<WorktreeManager, 'bindSession'>;
  readonly sessions: WorktreeToolSessionPort;
  readonly model: ToolModel;
  readonly prompt: string;
  readonly title?: string;
  readonly signal: AbortSignal;
  readonly check: () => void;
  readonly prepare?: (sessionId: string, requestId: string) => Promise<void>;
}): Promise<WorktreeSessionDispatchResult> {
  const { record, manager, sessions, model, signal, check } = input;
  check();
  const { sessionId } = await sessions.create({ cwd: record.absolutePath });
  const requestId = `clutch-worktree:${sessionId}:${randomUUID()}`;
  let status: WorktreeSessionDispatchResult['status'] = 'binding-failed';
  let error: string | undefined;
  try {
    check();
    await manager.bindSession({ workspaceId: record.workspaceId, worktreeId: record.worktreeId, sessionId });
    status = 'model-failed';
    check();
    await sessions.configureModel(sessionId, model, signal);
    if (input.title) {
      status = 'title-failed';
      check();
      await sessions.rename({ sessionId, title: input.title });
    }
    if (input.prepare) {
      status = 'reporting-failed';
      check();
      await input.prepare(sessionId, requestId);
    }
    status = 'prompt-failed';
    check();
    await sessions.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: input.prompt }] }, signal);
    status = 'dispatched';
  } catch (cause) {
    error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 700);
  }
  return { workspaceId: record.workspaceId, worktreeId: record.worktreeId, sessionId, requestId,
    model, status, ...(error === undefined ? {} : { error }) };
}
