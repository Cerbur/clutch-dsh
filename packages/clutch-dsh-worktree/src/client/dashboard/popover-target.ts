import type { WorktreeRecord } from '../../contract/index.js';
import type { WorktreeWorkspaceView } from '../view/worktree-view-read.js';

export type PopoverTarget = { kind: 'worktree'; record: WorktreeRecord } |
  { kind: 'main' | 'unbound' | 'detached' | 'missing' | 'loading' | 'failed' };

/** Never infer a managed checkout from a branch label or another Session's context. */
export function selectPopoverTarget(view: WorktreeWorkspaceView, sessionId: string, mainConfirmed = false): PopoverTarget {
  if (view.readiness.status === 'workspaceMissing') return { kind: 'missing' };
  if (view.knownSessionIds && !view.knownSessionIds.includes(sessionId)) return { kind: 'unbound' };
  const binding = view.bindings.find((item) => item.sessionId === sessionId);
  if (!binding) return { kind: mainConfirmed && view.knownSessionIds?.includes(sessionId) ? 'main' : 'unbound' };
  if (binding.workspaceId !== view.workspaceId) return { kind: 'failed' };
  if (binding.status === 'detached') return { kind: 'detached' };
  const record = view.worktrees.find((item) => item.workspaceId === view.workspaceId && item.worktreeId === binding.worktreeId);
  if (!record || record.diskCleanup === 'completed' || record.health === 'cleaned') return { kind: 'detached' };
  if (view.readiness.status !== 'ready') return { kind: 'failed' };
  if (record.health === 'repair' || record.health === 'recovery-needed') return { kind: 'missing' };
  return { kind: 'worktree', record };
}
