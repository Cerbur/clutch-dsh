import type { Context } from '@deepseek-ai/cordis';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { gitWorktreeRoot } from '../contract/index.js';
import type { DshReadAdapter, SidecarStore } from '../provider/types.js';
import { sameLexicalPath } from '../provider/path-identity.js';

interface CleanupEvent {
  readonly sessionId: string;
  readonly path: string;
  readonly cleanup: { readonly revision: number; readonly status: 'scheduled' | 'removed' | 'retained' | 'failed' };
}

// Optional DSH event: no dependency on the experimental worktree service is required.
interface CleanupHost {
  on(name: 'worktree/cleanup', listener: (event: unknown) => void): () => void;
}

function isCleanupEvent(value: unknown): value is CleanupEvent {
  if (value === null || typeof value !== 'object') return false;
  const event = value as Partial<CleanupEvent>;
  return typeof event.sessionId === 'string' && event.sessionId.length > 0 &&
    typeof event.path === 'string' && path.isAbsolute(event.path) &&
    event.cleanup !== null && typeof event.cleanup === 'object' &&
    Number.isSafeInteger(event.cleanup.revision) && event.cleanup.revision > 0 &&
    ['scheduled', 'removed', 'retained', 'failed'].includes(event.cleanup.status);
}

async function checkoutIdentity(left: string, right: string, admitted?: string): Promise<string | undefined> {
  const results = await Promise.allSettled([realpath(left), realpath(right)]);
  for (const result of results) {
    if (result.status === 'rejected' && (result.reason as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw result.reason;
    }
  }
  const [a, b] = results;
  if (a.status === 'fulfilled' && b.status === 'fulfilled') {
    return sameLexicalPath(a.value, b.value) ? a.value : undefined;
  }
  if (sameLexicalPath(left, right)) return a.status === 'fulfilled' ? a.value : b.status === 'fulfilled' ? b.value : left;
  // Only ENOENT permits an admission identity to bridge a now-dangling alias.
  // Existing paths must still agree; permission/I/O failures were rejected above.
  return admitted !== undefined && results.every((result) =>
    result.status === 'rejected' || sameLexicalPath(result.value, admitted)) ? admitted : undefined;
}

/** Read-only invalidation after native reclamation; never a Clutch lifecycle mutation. */
export function registerNativeWorktreeCleanup(
  ctx: Context,
  options: {
    readonly dsh: Pick<DshReadAdapter, 'listWorkspaces'>;
    readonly sidecar: Pick<SidecarStore, 'read'>;
    readonly changed: (workspaceId: string, worktreeId: string) => void;
  },
): void {
  let disposed = false;
  type Match = { workspaceId: string; worktreeId: string; root: string; canonical: string };
  const admissions = new Map<string, { event: CleanupEvent; matches: Promise<Match[]> }>();
  async function matches(event: CleanupEvent): Promise<Match[]> {
    const result: Match[] = [];
    const workspaces = await options.dsh.listWorkspaces?.() ?? [];
    for (const { workspaceId } of workspaces) {
      if (disposed) break;
      let records;
      try {
        records = (await options.sidecar.read(workspaceId)).worktrees;
      } catch {
        // An unreadable shard cannot widen the refresh scope or hide other shards.
        continue;
      }
      for (const record of records) {
        if (disposed) return [];
        if (record.workspaceId !== workspaceId || record.diskCleanup === 'completed') continue;
        const root = gitWorktreeRoot(record);
        try {
          const canonical = await checkoutIdentity(event.path, root);
          if (canonical !== undefined) result.push({ workspaceId, worktreeId: record.worktreeId, root, canonical });
        } catch {
          // Permission and I/O uncertainty fail closed for this candidate.
        }
      }
    }
    return result;
  }
  async function settled(event: CleanupEvent, admitted?: Promise<Match[]>): Promise<void> {
    // Admission can still be resolving when DSH settles. Never let its earlier read
    // suppress the final invalidation; retain only identities, not Git/ready facts.
    const before = await admitted ?? [];
    if (disposed) return;
    const current = await matches(event);
    const candidates = [...before, ...current];
    for (const workspaceId of new Set(candidates.map((item) => item.workspaceId))) {
      if (disposed) return;
      try {
        // Revalidate ownership after settlement: forgotten/moved records must not
        // receive notifications merely because they matched at admission.
        if (!((await options.dsh.listWorkspaces?.()) ?? []).some((workspace) => workspace.workspaceId === workspaceId)) continue;
        const snapshot = await options.sidecar.read(workspaceId);
        for (const record of snapshot.worktrees) {
          if (disposed) return;
          if (record.workspaceId !== workspaceId || record.diskCleanup === 'completed') continue;
          const candidate = candidates.find((item) => item.workspaceId === workspaceId && item.worktreeId === record.worktreeId &&
            sameLexicalPath(item.root, gitWorktreeRoot(record)));
          if (!candidate) continue;
          try {
            if (await checkoutIdentity(event.path, candidate.root, candidate.canonical) !== undefined && !disposed) {
              options.changed(workspaceId, record.worktreeId);
            }
          } catch {
            // A cached admission never bypasses a new filesystem identity failure.
          }
        }
      } catch {
        // The optional notification never turns read failure into a global refresh.
      }
    }
  }
  const off = (ctx as unknown as CleanupHost).on('worktree/cleanup', (event) => {
    if (disposed || !isCleanupEvent(event)) return;
    const admitted = admissions.get(event.sessionId);
    const sameAttempt = admitted?.event.cleanup.revision === event.cleanup.revision && admitted.event.path === event.path;
    if (event.cleanup.status === 'scheduled') {
      if (sameAttempt) return admitted.matches;
      const pending = matches(event).catch(() => []);
      admissions.set(event.sessionId, { event, matches: pending });
      return pending;
    }
    if (sameAttempt) admissions.delete(event.sessionId);
    // DSH emits without awaiting listeners; contain optional compatibility read failures.
    return settled(event, sameAttempt ? admitted.matches : undefined).catch(() => {});
  });
  ctx.effect(() => () => {
    disposed = true;
    admissions.clear();
    off();
  }, 'clutch-dsh-worktree: native cleanup notifications');
}
