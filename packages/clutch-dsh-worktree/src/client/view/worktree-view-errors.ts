export interface WorktreeViewError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** A DSH Session exists even when the external Worktree binding needs repair. */
export class WorktreeSessionBindingError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;
  readonly sessionId: string;
  readonly cause: unknown;

  constructor(sessionId: string, cause: unknown) {
    const candidate = typeof cause === 'object' && cause !== null
      ? cause as {
          readonly code?: unknown;
          readonly message?: unknown;
          readonly retryable?: unknown;
          readonly details?: unknown;
        }
      : undefined;
    const reason = cause instanceof Error
      ? cause.message
      : typeof candidate?.message === 'string'
        ? candidate.message
        : String(cause);
    super(reason);
    this.name = 'WorktreeSessionBindingError';
    const conflict = candidate?.code === 'SESSION_ALREADY_BOUND';
    this.code = conflict ? 'SESSION_ALREADY_BOUND' : 'SESSION_BINDING_FAILED';
    this.retryable = conflict ? false : candidate?.retryable !== false;
    this.details = typeof candidate?.details === 'object' && candidate.details !== null
      && !Array.isArray(candidate.details)
      ? candidate.details as Readonly<Record<string, unknown>>
      : {};
    this.sessionId = sessionId;
    this.cause = cause;
  }
}

/** A Session is retained after permission confirmation or permission setup needs retry. */
export class WorktreeSessionPermissionError extends Error {
  readonly code: string;
  readonly retryable = true;
  readonly details: Readonly<Record<string, unknown>>;
  readonly sessionId: string;
  readonly createdSession: boolean;
  readonly cause: unknown;

  constructor(sessionId: string, createdSession: boolean, cause?: unknown) {
    const reason = cause instanceof Error ? cause.message : cause === undefined ? '' : String(cause);
    super(reason);
    this.name = 'WorktreeSessionPermissionError';
    this.code = cause === undefined
      ? 'WORKTREE_PERMISSION_CONFIRMATION_REQUIRED'
      : 'WORKTREE_PERMISSION_FAILED';
    this.details = { sessionId };
    this.sessionId = sessionId;
    this.createdSession = createdSession;
    this.cause = cause;
  }
}

function recordDetails(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const details = (value as { readonly details?: unknown }).details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return undefined;
  return details as Readonly<Record<string, unknown>>;
}

/** Convert any adapter/Gateway failure into renderable, retry-aware UI data. */
export function toWorktreeViewError(error: unknown): WorktreeViewError {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly retryable?: unknown;
    };
    const details = error instanceof WorktreeSessionBindingError || error instanceof WorktreeSessionPermissionError
      ? { ...(recordDetails(error) ?? {}), sessionId: error.sessionId }
      : recordDetails(error);
    return {
      code: typeof candidate.code === 'string' ? candidate.code : 'WORKTREE_VIEW_FAILED',
      message: typeof candidate.message === 'string' ? candidate.message : '',
      retryable: candidate.retryable !== false,
      ...(details === undefined ? {} : { details }),
    };
  }
  return {
    code: 'WORKTREE_VIEW_FAILED',
    message: '',
    retryable: true,
  };
}

/** Keep ordering mutation/refresh failures reachable from the surface Retry control. */
export function toRetryableWorktreeOrderError(error: unknown): WorktreeViewError {
  return {
    ...toWorktreeViewError(error),
    retryable: true,
  };
}
