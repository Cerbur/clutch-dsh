import { stat } from 'node:fs/promises';
import type { NativeChangesTarget } from '../contract/native-changes.js';
import type { WorktreeManager } from '../contract/index.js';
import type { DshHostReadAdapter } from './dsh-read-adapter.js';
import { samePhysicalPath } from '../provider/path-identity.js';

/** No binding/Session mutations: only existing, physically matching directories qualify. */
export async function canOpenNativeChanges(
  manager: WorktreeManager,
  dsh: DshHostReadAdapter,
  input: NativeChangesTarget,
): Promise<boolean> {
  const session = await dsh.getSession(input.sessionId);
  if (!session || session.sessionId !== input.sessionId || session.workspaceId !== input.workspaceId ||
      session.originalCwd === undefined) return false;
  let targetPath: string;
  if (input.worktreeId === 'main' || input.worktreeId === `main:${input.workspaceId}`) {
    const checkout = await manager.getWorkspaceCheckout?.({ workspaceId: input.workspaceId });
    if (!checkout) return false;
    targetPath = checkout.workspacePath ?? checkout.gitRootPath;
  } else {
    const state = await manager.readWorktreeSessionState?.(input);
    const target = state?.target;
    if (!target || target.workspaceId !== input.workspaceId || target.worktreeId !== input.worktreeId ||
        target.status !== 'active' || target.diskCleanup === 'completed' ||
        (target.health !== undefined && target.health !== 'ready' && target.health !== 'branch-drift')) return false;
    targetPath = target.absolutePath;
  }
  if (targetPath !== input.expectedPath) return false;
  // Re-read after target Git/sidecar probes so a directory change during those reads fails closed.
  const current = await dsh.getSession(input.sessionId);
  if (!current || current.workspaceId !== input.workspaceId || current.originalCwd === undefined ||
      current.cwd !== session.cwd) return false;
  // Native Forge reads the effective directory, never a saved binding or header cwd.
  // Unlike ordinary relationship reads, this action requires both directories to exist.
  const [targetStat, sessionStat] = await Promise.all([stat(targetPath), stat(session.cwd)]);
  return targetStat.isDirectory() && sessionStat.isDirectory() && samePhysicalPath(targetPath, session.cwd);
}
