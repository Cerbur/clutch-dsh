import { createWorktreeError } from '../contract/index.js';
import type { WorktreeManager, WorktreeSessionCreationRequest, WorktreeSessionCreationResult } from '../contract/index.js';
import { createBoundWorktreeSession } from '../tool/create-session.js';
import { NativeSessionCreationPreflightError, type WorktreeToolSessionPort } from '../tool/native-session.js';

/** One native admission identity per browser action, without persistent task/message state. */
export function createWorktreeSessionCreation(options: {
  manager: Pick<WorktreeManager, 'listWorktrees' | 'bindSession' | 'readWorktreeSessionState'>;
  sessions: Pick<WorktreeToolSessionPort, 'create' | 'enterWorkingDirectory'>;
  changed(workspaceId: string, worktreeId: string, requestId: string): void;
}) {
  const lifetime = new AbortController();
  const requests = new Map<string, { payload: string; promise: Promise<WorktreeSessionCreationResult> }>();
  return {
    dispose() { lifetime.abort(); requests.clear(); },
    create(input: WorktreeSessionCreationRequest, signal: AbortSignal): Promise<WorktreeSessionCreationResult> {
      const conflict = (text: string) => createWorktreeError('WORKTREE_STATE_CONFLICT', text);
      if (!input || typeof input.workspaceId !== 'string' || typeof input.worktreeId !== 'string' ||
        typeof input.requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/u.test(input.requestId))
        return Promise.reject(conflict('Invalid Worktree Session creation request.'));
      const payload = JSON.stringify([input.workspaceId, input.worktreeId]);
      const known = requests.get(input.requestId);
      if (known) return known.payload === payload ? known.promise : Promise.reject(conflict('Request id belongs to another Worktree.'));
      if (requests.size >= 512) return Promise.reject(conflict('Session creation capacity reached; reload the plugin.'));
      const combined = AbortSignal.any([signal, lifetime.signal]);
      const check = () => combined.throwIfAborted();
      let creationAttempted = false;
      const promise = (async () => {
        check();
        const record = options.manager.readWorktreeSessionState
          ? (await options.manager.readWorktreeSessionState(input)).target
          : (await options.manager.listWorktrees(input)).find((item) => item.worktreeId === input.worktreeId);
        if (!record || record.workspaceId !== input.workspaceId || record.status !== 'active' ||
          record.diskCleanup === 'completed' || (record.health !== undefined && record.health !== 'ready'))
          throw conflict('Worktree is unavailable; refresh or repair it before creating a Session.');
        check();
        // From this boundary onward, even a rejected create can have an uncertain native result.
        creationAttempted = true;
        const result = await createBoundWorktreeSession({ record, manager: options.manager, sessions: options.sessions, signal: combined, check });
        // A post-commit snapshot also detects deletion/rebinding during native creation.
        // Do not turn a projection failure into an uncertain native creation failure.
        const state = result.bound && options.manager.readWorktreeSessionState
          ? await options.manager.readWorktreeSessionState(input).catch(() => undefined) : undefined;
        // Other connected Clients may refresh Git on notification. Prepare this
        // response first so those reads do not compete with its post-commit read.
        // Projection failure still notifies and keeps the successful native result.
        options.changed(input.workspaceId, input.worktreeId, input.requestId);
        return { ...result, ...(state === undefined ? {} : { state }) };
      })().catch((error: unknown) => {
        if ((!creationAttempted || error instanceof NativeSessionCreationPreflightError) &&
          requests.get(input.requestId)?.promise === promise)
          requests.delete(input.requestId);
        throw error;
      });
      requests.set(input.requestId, { payload, promise });
      return promise;
    },
  };
}
