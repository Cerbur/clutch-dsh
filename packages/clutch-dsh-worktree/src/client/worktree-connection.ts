import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';

import type {
  BranchRecord,
  WorktreeError,
  WorktreeManager,
  WorktreeRemoteMethod,
  WorktreeRemoteResult,
  WorktreeToolChangeBatch,
  WorktreeToolSettingsManager,
  WorktreeSessionCreationManager,
} from '../contract/index.js';

/** The one logical channel shared by the DSH Connection and Typert Gateway. */
export const WORKTREE_CONNECTION_CHANNEL = '/api' as const;

/**
 * Canonical Worktree endpoints owned by this adapter. Keeping the table here makes
 * the browser call surface auditable without making React know wire names.
 */
export const WORKTREE_CONNECTION_ENDPOINTS = Object.freeze({
  canReuseLocalSession: 'worktreeManager/canReuseLocalSession',
  createWorktreeSession: 'worktreeManager/createWorktreeSession',
  readWorktreeSessionState: 'worktreeManager/readWorktreeSessionState',
  syncWorktreeBaseline: 'worktreeManager/syncWorktreeBaseline',
  getWorkspaceGitState: 'worktreeManager/getWorkspaceGitState',
  getToolSettings: 'worktreeManager/getToolSettings',
  updateToolSettings: 'worktreeManager/updateToolSettings',
  watchToolChanges: 'worktreeManager/watchToolChanges',
  listWorktrees: 'worktreeManager/listWorktrees',
  listWorktreeCommits: 'worktreeManager/listWorktreeCommits',
  listWorktreeCommitFiles: 'worktreeManager/listWorktreeCommitFiles',
  getWorktreeCommitFileDiff: 'worktreeManager/getWorktreeCommitFileDiff',
  listImportCandidates: 'worktreeManager/listImportCandidates',
  listBranches: 'worktreeManager/listBranches',
  fetchRemoteBranches: 'worktreeManager/fetchRemoteBranches',
  getWorkspaceCheckout: 'worktreeManager/getWorkspaceCheckout',
  createWorktree: 'worktreeManager/createWorktree',
  importWorktree: 'worktreeManager/importWorktree',
  removeWorktree: 'worktreeManager/removeWorktree',
  unarchiveWorktree: 'worktreeManager/unarchiveWorktree',
  cleanWorktree: 'worktreeManager/cleanWorktree',
  adoptWorktreeBranch: 'worktreeManager/adoptWorktreeBranch',
  recoverWorktrees: 'worktreeManager/recoverWorktrees',
  forgetWorktree: 'worktreeManager/forgetWorktree',
  insertWorktreeBefore: 'worktreeManager/insertWorktreeBefore',
  getWorktreeInstructions: 'worktreeManager/getWorktreeInstructions',
  updateWorktreeInstructions: 'worktreeManager/updateWorktreeInstructions',
  updateWorktreeBaseBranch: 'worktreeManager/updateWorktreeBaseBranch',
  listBindings: 'worktreeManager/listBindings',
  bindSession: 'worktreeManager/bindSession',
}) satisfies Readonly<Record<WorktreeRemoteMethod, string>>;

/** Deliberately narrow transport seam: the adapter only needs `call`. */
export type WorktreeConnectionRpc = Pick<ClientConnectionRpc, 'call'>;

export interface WorktreeConnectionErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;
  readonly cause?: unknown;
}

/** Browser-safe error shared by transport, Gateway, endpoint and domain failures. */
export class WorktreeConnectionError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;

  constructor(options: WorktreeConnectionErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WorktreeConnectionError';
    this.code = options.code;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    this.retryable = options.retryable;
  }
}

export interface WorktreeConnectionAdapter extends WorktreeManager, WorktreeToolSettingsManager, WorktreeSessionCreationManager {
  watchToolChanges(afterRevision: number, signal: AbortSignal): Promise<WorktreeToolChangeBatch>;
  /** Check Host composition without requiring a user Workspace or reading its projection. */
  probeHost(signal: AbortSignal): Promise<WorktreeHostProbeResult>;
  /** Abort all requests owned by this Client plugin instance. */
  dispose(): void;
}

export interface WorktreeHostProbeResult {
  readonly ok: boolean;
  readonly error?: { readonly code: string };
}

type ConnectionResult = Awaited<ReturnType<WorktreeConnectionRpc['call']>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorktreeError(value: unknown): value is WorktreeError {
  return (
    isRecord(value) &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    isRecord(value.details)
  );
}

function isWorktreeRemoteResult(value: unknown): value is WorktreeRemoteResult<unknown> {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  return value.ok || (isWorktreeError(value.error) && value.error.details !== undefined);
}

function disposedError(): WorktreeConnectionError {
  return new WorktreeConnectionError({
    code: 'CLIENT_DISPOSED',
    message: '',
    details: {},
    retryable: false,
  });
}

function connectionFailure(
  endpoint: string,
  error: unknown,
  code = 'CONNECTION_CALL_FAILED',
): WorktreeConnectionError {
  const message = error instanceof Error ? error.message : String(error);
  return new WorktreeConnectionError({
    code,
    message,
    details: { endpoint },
    retryable: true,
    cause: error,
  });
}

function gatewayFailure(endpoint: string, result: Extract<ConnectionResult, { ok: false }>): never {
  const rawDetails = isRecord(result.error.details) ? result.error.details : {};
  throw new WorktreeConnectionError({
    code: result.error.code,
    message: result.error.message,
    details: { endpoint, ...rawDetails },
    retryable: true,
  });
}

function invalidResult(endpoint: string): WorktreeConnectionError {
  return new WorktreeConnectionError({
    code: 'WORKTREE_RPC_INVALID_RESULT',
    message: '',
    details: { endpoint },
    retryable: true,
  });
}

function unwrap<Value>(endpoint: string, result: ConnectionResult): Value {
  if (!result.ok) gatewayFailure(endpoint, result);
  if (!isWorktreeRemoteResult(result.value)) throw invalidResult(endpoint);
  if (!result.value.ok) {
    throw new WorktreeConnectionError({
      code: result.value.error.code,
      message: result.value.error.message,
      details: result.value.error.details,
      retryable: false,
    });
  }
  return result.value.value as Value;
}

/**
 * Adapt the shared DSH Connection RPC into the existing WorktreeManager contract.
 * All wire details and request cancellation live behind this one deep module.
 */
export function createWorktreeConnectionAdapter(
  rpc: WorktreeConnectionRpc,
): WorktreeConnectionAdapter {
  const inFlight = new Set<AbortController>();
  const branchReads = new Map<string, Promise<readonly BranchRecord[]>>();
  let disposed = false;

  async function call(
    method: WorktreeRemoteMethod,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<ConnectionResult> {
    if (disposed) throw disposedError();
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    inFlight.add(controller);
    const endpoint = WORKTREE_CONNECTION_ENDPOINTS[method];
    try {
      let result: ConnectionResult;
      try {
        result = await rpc.call(
          WORKTREE_CONNECTION_CHANNEL,
          endpoint,
          { args: { input } },
          controller.signal,
        );
      } catch (error) {
        if (disposed && controller.signal.aborted) throw disposedError();
        throw connectionFailure(endpoint, error);
      }
      return result;
    } finally {
      signal?.removeEventListener('abort', abort);
      inFlight.delete(controller);
    }
  }

  async function invoke<Value>(method: WorktreeRemoteMethod, input: unknown): Promise<Value> {
    return unwrap<Value>(WORKTREE_CONNECTION_ENDPOINTS[method], await call(method, input));
  }

  return {
    syncWorktreeBaseline: (input) => invoke('syncWorktreeBaseline', input),
    getToolSettings: (input) => invoke('getToolSettings', input),
    updateToolSettings: (input) => invoke('updateToolSettings', input),
    watchToolChanges: async (afterRevision, signal) =>
      unwrap<WorktreeToolChangeBatch>(
        WORKTREE_CONNECTION_ENDPOINTS.watchToolChanges,
        await call('watchToolChanges', { afterRevision }, signal),
      ),
    // Empty Workspace identity reaches the existing read endpoint but cannot select user data.
    // An outer success (including inner WORKSPACE_NOT_FOUND) proves the Host is composed.
    probeHost: (signal) => call('listBindings', { workspaceId: '' }, signal),
    listWorktrees: (input) => invoke('listWorktrees', input),
    getWorkspaceGitState: (input) => invoke('getWorkspaceGitState', input),
    listWorktreeCommits: (input) => invoke('listWorktreeCommits', input),
    listWorktreeCommitFiles: (input) => invoke('listWorktreeCommitFiles', input),
    getWorktreeCommitFileDiff: (input) => invoke('getWorktreeCommitFileDiff', input),
    listImportCandidates: (input) => invoke('listImportCandidates', input),
    listBranches: (input) => {
      const current = branchReads.get(input.workspaceId);
      if (current) return current;
      const request = invoke<readonly BranchRecord[]>('listBranches', input).finally(() => {
        if (branchReads.get(input.workspaceId) === request) branchReads.delete(input.workspaceId);
      });
      branchReads.set(input.workspaceId, request);
      return request;
    },
    fetchRemoteBranches: (input) => invoke('fetchRemoteBranches', input),
    getWorkspaceCheckout: (input) => invoke('getWorkspaceCheckout', input),
    createWorktree: (input) => invoke('createWorktree', input),
    importWorktree: (input) => invoke('importWorktree', input),
    async removeWorktree(input): Promise<void> {
      await invoke<null>('removeWorktree', input);
    },
    async unarchiveWorktree(input): Promise<void> {
      await invoke<null>('unarchiveWorktree', input);
    },
    async adoptWorktreeBranch(input): Promise<void> { await invoke<null>('adoptWorktreeBranch', input); },
    async recoverWorktrees(input): Promise<void> { await invoke<null>('recoverWorktrees', input); },
    async cleanWorktree(input): Promise<void> {
      await invoke<null>('cleanWorktree', input);
    },
    async forgetWorktree(input): Promise<void> {
      await invoke<null>('forgetWorktree', input);
    },
    async insertWorktreeBefore(input): Promise<readonly string[]> {
      return invoke<readonly string[]>('insertWorktreeBefore', input);
    },
    async getWorktreeInstructions(input): Promise<string> {
      return invoke<string>('getWorktreeInstructions', input);
    },
    async updateWorktreeInstructions(input): Promise<string> {
      return invoke<string>('updateWorktreeInstructions', input);
    },
    async updateWorktreeBaseBranch(input): Promise<string> {
      return invoke<string>('updateWorktreeBaseBranch', input);
    },
    listBindings: (input) => invoke('listBindings', input),
    bindSession: (input) => invoke('bindSession', input),
    canReuseLocalSession: (input) => invoke('canReuseLocalSession', input),
    createWorktreeSession: (input) => invoke('createWorktreeSession', input),
    readWorktreeSessionState: (input) => invoke('readWorktreeSessionState', input),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const controller of inFlight) controller.abort();
      inFlight.clear();
    },
  };
}
