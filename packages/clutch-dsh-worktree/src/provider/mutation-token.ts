import { createHash } from 'node:crypto';

import type { WorktreeRecord } from '../contract/index.js';
import type { SidecarSnapshot } from './types.js';

/**
 * Create an opaque, deterministic token for one sidecar revision and Worktree
 * record. It is a concurrency witness, not an authorization credential.
 */
export function createWorktreeMutationToken(
  snapshot: Pick<SidecarSnapshot, 'schemaVersion' | 'workspaceId' | 'revision'>,
  record: Pick<WorktreeRecord, 'worktreeId' | 'workspaceId' | 'absolutePath' | 'branch' | 'source' | 'status'>,
): string {
  const payload = JSON.stringify([
    snapshot.schemaVersion,
    snapshot.workspaceId,
    snapshot.revision,
    record.worktreeId,
    record.workspaceId,
    record.absolutePath,
    record.branch,
    record.source,
    record.status,
  ]);
  return `v1-${createHash('sha256').update(payload).digest('base64url')}`;
}
