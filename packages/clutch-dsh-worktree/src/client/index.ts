/**
 * Browser-safe Worktree Consumer exports. The only wire adapter lives in
 * `worktree-connection.ts`; this barrel never imports Host, Manage or Provider.
 */
export {
  WORKTREE_CONNECTION_CHANNEL,
  WORKTREE_CONNECTION_ENDPOINTS,
  WorktreeConnectionError,
  createWorktreeConnectionAdapter,
} from './worktree-connection.js';
export type {
  WorktreeConnectionAdapter,
  WorktreeConnectionErrorOptions,
  WorktreeConnectionRpc,
} from './worktree-connection.js';
