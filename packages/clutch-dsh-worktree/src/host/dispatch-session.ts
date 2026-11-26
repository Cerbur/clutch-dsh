import { randomUUID } from 'node:crypto';
import { createBoundWorktreeSession, sessionFailure } from './create-session.js';
import type { WorktreeRecord, WorktreeManager } from '../contract/index.js';
import type { WorktreeSessionDispatchResult } from '../contract/baseline-sync.js';
import type { ToolModel, WorktreeToolSessionPort } from '../tool/native-session.js';
import type { NativeTaskSessionPort } from './native-session.js';
import type { CallingAgent } from '../tool/types.js';

type Delivery = { sender: CallingAgent; sessions: Pick<WorktreeToolSessionPort, 'sendAgentMessage'> } | { sender?: undefined };

/** Shared by the Agent tool and Dashboard tasks; all mutations use native DSH APIs. */
export async function dispatchWorktreeSession(input: Delivery & {
  readonly record: WorktreeRecord;
  readonly manager: Pick<WorktreeManager, 'bindSession'>;
  readonly sessions: NativeTaskSessionPort;
  readonly model: ToolModel;
  readonly prompt: string;
  readonly title?: string;
  readonly signal: AbortSignal;
  readonly check: () => void;
  readonly prepare?: (sessionId: string, requestId: string) => Promise<void>;
}): Promise<WorktreeSessionDispatchResult> {
  const { record, manager, sessions, model, signal, check } = input;
  check();
  const created = await createBoundWorktreeSession({ record, manager, sessions, signal, check });
  const { sessionId } = created;
  const requestId = `clutch-worktree:${sessionId}:${randomUUID()}`;
  if (!created.bound || created.error !== undefined) return { workspaceId: record.workspaceId, worktreeId: record.worktreeId,
    sessionId, requestId, model, status: created.bound ? 'prompt-failed' : 'binding-failed', error: created.error,
    ...(created.causeCode === undefined ? {} : { causeCode: created.causeCode }),
    ...(created.rootPath === undefined ? {} : { rootPath: created.rootPath }) };
  let status: WorktreeSessionDispatchResult['status'] = 'model-failed';
  let failure: ReturnType<typeof sessionFailure> | undefined;
  try {
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
    await sessions.assertWorkingDirectory?.(sessionId, record.absolutePath, signal);
    check();
    const message = { sessionId, requestId, mode: 'queue' as const, content: [{ type: 'text' as const, text: input.prompt }] };
    if (input.sender) await input.sessions.sendAgentMessage({ ...message, sender: input.sender }, signal);
    else await sessions.prompt(message, signal);
    status = 'dispatched';
  } catch (cause) {
    failure = sessionFailure(cause);
  }
  return { workspaceId: record.workspaceId, worktreeId: record.worktreeId, sessionId, requestId,
    model, status, ...failure };
}
