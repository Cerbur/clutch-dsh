import { createWorktreeError } from '../contract/index.js';
import type { WorktreeManager, WorktreeSessionCreationRequest, WorktreeSessionCreationResult } from '../contract/index.js';
import { createBoundWorktreeSession } from '../tool/create-session.js';
import type { WorktreeToolSessionPort } from '../tool/native-session.js';

/** One native admission identity per browser action, without persistent task/message state. */
export function createWorktreeSessionCreation(options: {
  manager: Pick<WorktreeManager, 'listWorktrees' | 'bindSession'>;
  sessions: Pick<WorktreeToolSessionPort, 'create' | 'enterWorkingDirectory'>;
  changed(workspaceId: string, worktreeId: string): void;
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
      const promise = (async () => {
        check();
        const record = (await options.manager.listWorktrees(input)).find((item) => item.worktreeId === input.worktreeId);
        if (!record || record.workspaceId !== input.workspaceId || record.status !== 'active' ||
          record.diskCleanup === 'completed' || (record.health !== undefined && record.health !== 'ready'))
          throw conflict('Worktree is unavailable; refresh or repair it before creating a Session.');
        check();
        const result = await createBoundWorktreeSession({ record, manager: options.manager, sessions: options.sessions, signal: combined, check });
        options.changed(input.workspaceId, input.worktreeId);
        return result;
      })();
      requests.set(input.requestId, { payload, promise });
      return promise;
    },
  };
}
