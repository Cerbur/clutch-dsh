import { createHash } from 'node:crypto';
import path from 'node:path';

import type { RepositoryIdentity } from './types.js';

/**
 * Persist only a stable, non-reversible repository witness. The absolute
 * repository paths remain in memory and in a pending operation only while a
 * transaction is recoverable; stable sidecar state never copies projectRoot.
 */
export function createRepositoryFingerprint(
  identity: Pick<RepositoryIdentity, 'commonDirectory'>,
): string {
  const normalized = path.normalize(path.resolve(identity.commonDirectory));
  const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return `v1-${createHash('sha256').update(key).digest('hex')}`;
}
