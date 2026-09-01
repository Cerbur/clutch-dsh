import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess';
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess';

import type { GitSubprocessRuntime } from './types.js';

const execFile = promisify(execFileCallback);

export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitRunnerOptions {
  readonly timeoutMs: number;
  readonly graceMs: number;
  /** Bounded best-effort wait after asking the subprocess tree to terminate. */
  readonly cleanupTimeoutMs: number;
  readonly maxOutputBytes: number;
  readonly readOnly: boolean;
  readonly signal?: AbortSignal;
  readonly subprocess?: GitSubprocessRuntime;
}

// Git 的原始进程证据只在 Provider runner 内流转；上层只接收稳定的 Provider 错误。
// Raw Git process evidence stays inside the Provider runner; callers receive only
// stable Provider errors at the public boundary.
export class GitCommandError extends Error {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | string | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly outputTruncated: boolean;
  readonly processTreeDidNotExit: boolean;
  readonly signal?: string;

  constructor(
    args: readonly string[],
    cwd: string,
    stdout: string,
    stderr: string,
    exitCode: number | string | null,
    options: {
      readonly timedOut: boolean;
      readonly aborted: boolean;
      readonly outputTruncated: boolean;
      readonly processTreeDidNotExit?: boolean;
      readonly signal?: string;
    },
  ) {
    super(
      stderr || stdout || (options.processTreeDidNotExit
        ? 'Git subprocess tree did not exit before cleanup deadline'
        : `git exited with ${String(exitCode)}`),
    );
    this.name = 'GitCommandError';
    this.args = args;
    this.cwd = cwd;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
    this.timedOut = options.timedOut;
    this.aborted = options.aborted;
    this.outputTruncated = options.outputTruncated;
    this.processTreeDidNotExit = options.processTreeDidNotExit ?? false;
    this.signal = options.signal;
  }
}

interface ProcessErrorLike {
  readonly stdout?: unknown;
  readonly stderr?: unknown;
  readonly code?: number | string;
  readonly signal?: string;
  readonly killed?: boolean;
  readonly timedOut?: boolean;
  readonly name?: string;
  readonly message?: string;
}

interface CollectedStream {
  readonly text: string;
  readonly truncated: boolean;
}

interface Deadline {
  readonly signal: AbortSignal;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  dispose(): void;
}

function createDeadline(timeoutMs: number, parentSignal?: AbortSignal): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  let aborted = false;
  let disposed = false;

  const timer = setTimeout(() => {
    if (disposed) return;
    timedOut = true;
    controller.abort(Object.assign(new Error('Git subprocess timed out'), { code: 'ETIMEDOUT' }));
  }, timeoutMs);

  const abortFromParent = () => {
    if (disposed) return;
    aborted = true;
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      abortFromParent();
    } else {
      parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    get aborted() {
      return aborted;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function gitEnvironment(readOnly: boolean): NodeJS.ProcessEnv {
  return {
    ...scrubbedParentEnv(),
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    LC_ALL: 'C',
    LANG: 'C',
    // Explicitly clear an ambient read-only override for mutations. An
    // inherited GIT_OPTIONAL_LOCKS=0 would otherwise silently weaken writes.
    GIT_OPTIONAL_LOCKS: readOnly ? '0' : undefined,
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_INDEX_FILE: undefined,
  };
}

function lookupEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asProcessError(error: unknown): ProcessErrorLike {
  return error as ProcessErrorLike;
}

function errorExitCode(error: ProcessErrorLike): number | string | null {
  return error.code ?? null;
}

function errorSignal(error: ProcessErrorLike): string | undefined {
  return error.signal;
}

function errorOutputTruncated(error: ProcessErrorLike): boolean {
  return error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
    error.message?.includes('maxBuffer') === true;
}

function errorAborted(error: ProcessErrorLike): boolean {
  return error.name === 'AbortError' || error.code === 'ABORT_ERR';
}

function errorTimedOut(error: ProcessErrorLike, aborted: boolean): boolean {
  return error.timedOut === true || error.code === 'ETIMEDOUT' ||
    (error.killed === true && !aborted);
}

function abortReason(signal: AbortSignal, fallback: string): unknown {
  return signal.reason ?? new Error(fallback);
}

async function awaitWithAbort<Value>(promise: PromiseLike<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) throw abortReason(signal, 'Git subprocess was aborted');

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal, 'Git subprocess was aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function readCollectedStream(
  handle: SubprocessHandle,
  stream: 'stdout' | 'stderr',
): CollectedStream {
  const reader = handle.collected[stream];
  if (!reader) {
    throw new Error(`Git subprocess did not expose collected ${stream}`);
  }
  const result = reader.readFrom(0);
  return {
    text: result.text,
    truncated: result.lossy,
  };
}

function readCollectedStreams(handle: SubprocessHandle): {
  readonly stdout: string;
  readonly stderr: string;
  readonly outputTruncated: boolean;
} {
  const stdout = readCollectedStream(handle, 'stdout');
  const stderr = readCollectedStream(handle, 'stderr');
  return {
    stdout: stdout.text,
    stderr: stderr.text,
    outputTruncated: stdout.truncated || stderr.truncated,
  };
}

function readCollectedStreamsSafely(handle: SubprocessHandle | undefined): {
  readonly stdout: string;
  readonly stderr: string;
  readonly outputTruncated: boolean;
} {
  if (!handle) return { stdout: '', stderr: '', outputTruncated: false };
  try {
    return readCollectedStreams(handle);
  } catch {
    return { stdout: '', stderr: '', outputTruncated: false };
  }
}

async function waitForExitWithin(handle: SubprocessHandle, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error('Git subprocess tree cleanup timed out'));
      resolve(false);
    }, timeoutMs);
  });
  const wait = Promise.resolve().then(() => handle.waitForExit(controller.signal));
  try {
    return await Promise.race([wait, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
  }
}

async function stopAndWait(handle: SubprocessHandle, cleanupTimeoutMs: number): Promise<boolean> {
  try {
    handle.terminate();
  } catch {
    // Preserve the original Git/runtime error; the runtime owns termination details.
  }
  try {
    return await waitForExitWithin(handle, cleanupTimeoutMs);
  } catch {
    // Preserve the original Git/runtime error after making a best-effort tree cleanup.
    return false;
  }
}

function commandErrorFrom(
  args: readonly string[],
  cwd: string,
  error: unknown,
  output: { readonly stdout: string; readonly stderr: string; readonly outputTruncated: boolean },
  options: {
    readonly timedOut: boolean;
    readonly aborted: boolean;
    readonly processTreeDidNotExit?: boolean;
  },
): GitCommandError {
  const processError = asProcessError(error);
  const aborted = options.aborted || errorAborted(processError);
  return new GitCommandError(
    args,
    cwd,
    output.stdout || asText(processError.stdout),
    output.stderr || asText(processError.stderr),
    errorExitCode(processError),
    {
      timedOut: options.timedOut || errorTimedOut(processError, aborted),
      aborted,
      outputTruncated: output.outputTruncated || errorOutputTruncated(processError),
      processTreeDidNotExit: options.processTreeDidNotExit,
      ...(errorSignal(processError) ? { signal: errorSignal(processError) } : {}),
    },
  );
}

async function runWithSubprocess(
  args: readonly string[],
  cwd: string,
  executable: string,
  executableArgs: readonly string[],
  options: GitRunnerOptions & { readonly subprocess: GitSubprocessRuntime },
): Promise<GitCommandResult> {
  const deadline = createDeadline(options.timeoutMs, options.signal);
  const environment = gitEnvironment(options.readOnly);
  let handle: SubprocessHandle | undefined;
  let treeSettled = false;

  try {
    const resolvedExecutable = await awaitWithAbort(
      options.subprocess.resolveExecutable(
        executable,
        lookupEnvironment(environment),
        deadline.signal,
      ),
      deadline.signal,
    );
    handle = options.subprocess.spawn({
      argv: [resolvedExecutable, ...executableArgs, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: options.maxOutputBytes },
        stderr: { maxBytes: options.maxOutputBytes },
      },
      graceMs: options.graceMs,
      signal: deadline.signal,
      env: environment,
    });

    const outcome = await awaitWithAbort(handle.done, deadline.signal);
    deadline.dispose();
    const cleanupCompleted = await stopAndWait(handle, options.cleanupTimeoutMs);
    treeSettled = cleanupCompleted;
    const output = readCollectedStreams(handle);
    const timedOut = deadline.timedOut;
    const aborted = deadline.aborted && !timedOut;
    if (!cleanupCompleted) {
      throw new GitCommandError(
        args,
        cwd,
        output.stdout,
        output.stderr,
        outcome.exitCode,
        {
          timedOut: deadline.timedOut,
          aborted,
          outputTruncated: output.outputTruncated,
          processTreeDidNotExit: true,
          ...(outcome.signal ? { signal: outcome.signal } : {}),
        },
      );
    }
    if (timedOut || aborted || output.outputTruncated || outcome.exitCode !== 0 || outcome.signal) {
      throw new GitCommandError(
        args,
        cwd,
        output.stdout,
        output.stderr,
        outcome.exitCode,
        {
          timedOut,
          aborted,
          outputTruncated: output.outputTruncated,
          processTreeDidNotExit: false,
          ...(outcome.signal ? { signal: outcome.signal } : {}),
        },
      );
    }
    return { stdout: output.stdout, stderr: output.stderr };
  } catch (error) {
    if (error instanceof GitCommandError) throw error;
    let cleanupCompleted = treeSettled;
    if (handle && !treeSettled) {
      cleanupCompleted = await stopAndWait(handle, options.cleanupTimeoutMs);
    }
    throw commandErrorFrom(
      args,
      cwd,
      error,
      readCollectedStreamsSafely(handle),
      {
        timedOut: deadline.timedOut,
        aborted: deadline.aborted && !deadline.timedOut,
        processTreeDidNotExit: handle !== undefined && !cleanupCompleted,
      },
    );
  } finally {
    deadline.dispose();
  }
}

async function runWithNode(
  args: readonly string[],
  cwd: string,
  executable: string,
  executableArgs: readonly string[],
  options: GitRunnerOptions,
): Promise<GitCommandResult> {
  const environment = gitEnvironment(options.readOnly);
  try {
    const result = await execFile(executable, [...executableArgs, ...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: options.maxOutputBytes,
      timeout: options.timeoutMs,
      killSignal: 'SIGTERM',
      signal: options.signal,
      shell: false,
      windowsHide: true,
      env: environment,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const processError = asProcessError(error);
    const aborted = errorAborted(processError);
    throw new GitCommandError(
      args,
      cwd,
      asText(processError.stdout),
      asText(processError.stderr),
      errorExitCode(processError),
      {
        timedOut: errorTimedOut(processError, aborted),
        aborted,
        outputTruncated: errorOutputTruncated(processError),
        ...(errorSignal(processError) ? { signal: errorSignal(processError) } : {}),
      },
    );
  }
}

/** Execute one fixed Git argv through DSH subprocess or the direct Node fallback. */
export function runGit(
  args: readonly string[],
  cwd: string,
  executable: string,
  executableArgs: readonly string[],
  options: GitRunnerOptions,
): Promise<GitCommandResult> {
  if (options.subprocess) {
    return runWithSubprocess(args, cwd, executable, executableArgs, {
      ...options,
      subprocess: options.subprocess,
    });
  }
  return runWithNode(args, cwd, executable, executableArgs, options);
}
