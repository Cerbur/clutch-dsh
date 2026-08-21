import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';

import type {
  WorktreeError,
  WorktreeManager,
  WorktreeRemoteMethod,
  WorktreeRemoteResult,
} from '../contract/index.js';

/** The one logical channel shared by the DSH Connection and Typert Gateway. */
export const WORKTREE_CONNECTION_CHANNEL = '/api' as const;

/**
 * Canonical Worktree endpoints owned by this adapter. Keeping the table here makes
 * the browser call surface auditable without making React know wire names.
 */
export const WORKTREE_CONNECTION_ENDPOINTS = Object.freeze({
  listWorktrees: 'worktreeManager/listWorktrees',
  listBranches: 'worktreeManager/listBranches',
  createWorktree: 'worktreeManager/createWorktree',
  removeWorktree: 'worktreeManager/removeWorktree',
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

export interface WorktreeConnectionAdapter extends WorktreeManager {
  /** Abort all requests owned by this Client plugin instance. */
  dispose(): void;
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
  let disposed = false;

  async function invoke<Value>(method: WorktreeRemoteMethod, input: unknown): Promise<Value> {
    if (disposed) throw disposedError();
    const controller = new AbortController();
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
      return unwrap<Value>(endpoint, result);
    } finally {
      inFlight.delete(controller);
    }
  }

  return {
    listWorktrees: (input) => invoke('listWorktrees', input),
    listBranches: (input) => invoke('listBranches', input),
    createWorktree: (input) => invoke('createWorktree', input),
    async removeWorktree(input): Promise<void> {
      await invoke<null>('removeWorktree', input);
    },
    listBindings: (input) => invoke('listBindings', input),
    bindSession: (input) => invoke('bindSession', input),
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const controller of inFlight) controller.abort();
      inFlight.clear();
    },
  };
}
