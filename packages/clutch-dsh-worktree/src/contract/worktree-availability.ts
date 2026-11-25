import type { WorktreeRecord } from './index.js';

export function available(record: WorktreeRecord): boolean {
  return (
    record.status === 'active' &&
    record.diskCleanup !== 'completed' &&
    (record.health === undefined || record.health === 'ready')
  );
}
