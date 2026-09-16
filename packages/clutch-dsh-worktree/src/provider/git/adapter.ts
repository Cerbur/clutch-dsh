import { lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  GitCommandError,
  runGit,
} from './subprocess.js';
import type { GitCommandResult } from './subprocess.js';
import type {
  GitCommitHistoryRead,
  GitCommandOptions,
  GitBranchWorktreeInfo,
  GitSubprocessRuntime,
  GitWorktreeAdapter,
  GitWorktreeInfo,
} from '../types.js';
import { WorktreeProviderError, providerError } from '../types.js';
import { WORKTREE_GIT_COMMIT_PATTERN, WORKTREE_GIT_WORKING_TREE } from '../../contract/index.js';
import type { WorktreeGitChangedFile, WorktreeGitFileDiff } from '../../contract/index.js';

/** Shared with Contract/Manage/Client so commit-SHA validation cannot drift. */
const COMMIT_PATTERN = WORKTREE_GIT_COMMIT_PATTERN;
const HISTORY_REQUEST_LIMIT = 201;
const HISTORY_VISIBLE_LIMIT = 200;
/**
 * Line statistics for untracked files cost one `git diff --no-index` process per
 * file. A large untracked tree therefore reports unknown counts beyond this
 * bound instead of spawning an unbounded number of Git processes.
 */
const MAX_UNTRACKED_STAT_FILES = 50;
/** Keeps the bounded per-file statistics fan-out from exhausting process limits. */
const STAT_READ_CONCURRENCY = 8;

function parseCommitHash(stdout: string, operation: string, workspaceRoot: string): string {
  const commit = stdout.trim();
  if (!COMMIT_PATTERN.test(commit)) {
    throw providerError('GIT_OPERATION_FAILED', `Git ${operation} returned an invalid commit`, {
      workspaceRoot,
      operation,
    });
  }
  return commit;
}

function assertCommitArgument(commit: string, operation: string, workspaceRoot: string): void {
  if (!COMMIT_PATTERN.test(commit)) {
    throw providerError('GIT_OPERATION_FAILED', `Invalid commit supplied to Git ${operation}`, {
      workspaceRoot,
      operation,
    });
  }
}

function parseCommitRecord(record: string, workspaceRoot: string): GitCommitHistoryRead['commits'][number] {
  const fields = record.split('\0');
  if (fields.length !== 6) {
    throw providerError('GIT_OPERATION_FAILED', 'Git returned malformed commit history data', {
      workspaceRoot,
      operation: 'list commits',
    });
  }
  const [sha, parents, subject, authorName, authorEmail, authoredAt] = fields;
  if (
    !sha ||
    !COMMIT_PATTERN.test(sha) ||
    (parents !== '' && parents.split(/\s+/u).some((parent) => !COMMIT_PATTERN.test(parent))) ||
    !authorName ||
    !authoredAt
  ) {
    throw providerError('GIT_OPERATION_FAILED', 'Git returned invalid commit history data', {
      workspaceRoot,
      operation: 'list commits',
    });
  }
  return {
    sha,
    parents: parents === '' ? [] : parents.split(/\s+/u),
    subject,
    authorName,
    ...(authorEmail ? { authorEmail } : {}),
    authoredAt,
  };
}

function parseChangedFiles(stdout: string, workspaceRoot: string): readonly WorktreeGitChangedFile[] {
  const fields = stdout.split('\0');
  const files: WorktreeGitChangedFile[] = [];
  let index = 0;
  while (index < fields.length) {
    const statusField = (fields[index++] ?? '').replace(/^[\r\n]+/u, '');
    if (statusField === '') continue;
    const statusCode = statusField[0]?.toUpperCase();
    const status = statusCode === 'A'
      ? 'added'
      : statusCode === 'M'
        ? 'modified'
        : statusCode === 'D'
          ? 'deleted'
          : statusCode === 'R'
            ? 'renamed'
            : statusCode === 'C'
              ? 'copied'
              : statusCode === 'T'
                ? 'type-changed'
                : undefined;
    if (status === undefined) {
      throw providerError('GIT_OPERATION_FAILED', 'Git returned an unsupported changed-file status', {
        workspaceRoot,
        operation: 'list commit files',
        status: statusField,
      });
    }
    const firstPath = fields[index++];
    if (!firstPath) {
      throw providerError('GIT_OPERATION_FAILED', 'Git returned a changed file without a path', {
        workspaceRoot,
        operation: 'list commit files',
      });
    }
    if (status === 'renamed' || status === 'copied') {
      const newPath = fields[index++];
      if (!newPath) {
        throw providerError('GIT_OPERATION_FAILED', 'Git returned a rename/copy without two paths', {
          workspaceRoot,
          operation: 'list commit files',
        });
      }
      files.push({ path: newPath, oldPath: firstPath, status });
    } else {
      files.push({ path: firstPath, status });
    }
  }
  return files;
}

function parseUntrackedFiles(stdout: string): readonly WorktreeGitChangedFile[] {
  return stdout
    .split('\0')
    .filter((filePath) => filePath.length > 0)
    .map((filePath) => ({ path: filePath, status: 'added' as const }));
}

interface GitDiffStat {
  readonly path: string;
  readonly oldPath?: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly unknown?: boolean;
}

function parseDiffCount(value: string, workspaceRoot: string, operation: string): number | undefined {
  if (value === '-') return undefined;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw providerError('GIT_OPERATION_FAILED', 'Git returned an invalid line count', {
      workspaceRoot,
      operation,
      value,
    });
  }
  return count;
}

/** Parse Git's NUL-safe --numstat projection, including rename/copy pairs. */
function parseNumstat(stdout: string, workspaceRoot: string, operation: string): readonly GitDiffStat[] {
  const fields = stdout.split('\0');
  const stats: GitDiffStat[] = [];
  let index = 0;
  while (index < fields.length) {
    const record = fields[index++];
    if (record === undefined || record.length === 0) continue;
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/u.exec(record);
    if (match === null) {
      throw providerError('GIT_OPERATION_FAILED', 'Git returned malformed line-count data', {
        workspaceRoot,
        operation,
        record,
      });
    }
    const additions = parseDiffCount(match[1]!, workspaceRoot, operation);
    const deletions = parseDiffCount(match[2]!, workspaceRoot, operation);
    const pathName = match[3]!;
    if (pathName.length > 0) {
      stats.push({
        path: pathName,
        ...(additions === undefined ? {} : { additions }),
        ...(deletions === undefined ? {} : { deletions }),
        ...(additions === undefined || deletions === undefined ? { unknown: true } : {}),
      });
      continue;
    }
    const oldPath = fields[index++];
    const newPath = fields[index++];
    if (!oldPath || !newPath) {
      throw providerError('GIT_OPERATION_FAILED', 'Git returned a rename/copy without two numstat paths', {
        workspaceRoot,
        operation,
      });
    }
    stats.push({
      path: newPath,
      oldPath,
      ...(additions === undefined ? {} : { additions }),
      ...(deletions === undefined ? {} : { deletions }),
      ...(additions === undefined || deletions === undefined ? { unknown: true } : {}),
    });
  }
  return stats;
}

function mergeDiffStat(
  current: GitDiffStat | undefined,
  next: GitDiffStat,
): GitDiffStat {
  if (current === undefined) return next;
  if (current.unknown === true || next.unknown === true) {
    return {
      path: current.path,
      ...(current.oldPath === undefined ? {} : { oldPath: current.oldPath }),
      unknown: true,
    };
  }
  const additions = current.additions === undefined || next.additions === undefined
    ? current.additions ?? next.additions
    : current.additions + next.additions;
  const deletions = current.deletions === undefined || next.deletions === undefined
    ? current.deletions ?? next.deletions
    : current.deletions + next.deletions;
  return {
    path: current.path,
    ...(current.oldPath === undefined ? {} : { oldPath: current.oldPath }),
    ...(additions === undefined ? {} : { additions }),
    ...(deletions === undefined ? {} : { deletions }),
  };
}

function decorateChangedFiles(
  files: readonly WorktreeGitChangedFile[],
  stats: readonly GitDiffStat[],
): readonly WorktreeGitChangedFile[] {
  const byPath = new Map<string, GitDiffStat>();
  for (const stat of stats) {
    byPath.set(stat.path, mergeDiffStat(byPath.get(stat.path), stat));
    if (stat.oldPath !== undefined) byPath.set(stat.oldPath, mergeDiffStat(byPath.get(stat.oldPath), stat));
  }
  return files.map((file) => {
    const stat = byPath.get(file.path) ?? (file.oldPath === undefined ? undefined : byPath.get(file.oldPath));
    if (stat === undefined || stat.unknown === true || (stat.additions === undefined && stat.deletions === undefined)) return file;
    return {
      ...file,
      ...(stat.additions === undefined ? {} : { additions: stat.additions }),
      ...(stat.deletions === undefined ? {} : { deletions: stat.deletions }),
    };
  });
}

function omitRestoredStats(
  stats: readonly GitDiffStat[],
  restoredPaths: ReadonlySet<string>,
): readonly GitDiffStat[] {
  return stats.flatMap((stat) => {
    if (restoredPaths.has(stat.path)) return [];
    if (stat.oldPath !== undefined && restoredPaths.has(stat.oldPath)) return [];

    return [stat];
  });
}

function isBinaryDiff(stdout: string): boolean {
  return /^Binary files .* differ$/mu.test(stdout) || /^GIT binary patch$/mu.test(stdout);
}

/**
 * True when decoded stdout cannot represent the blob bytes exactly. Binary blobs
 * (NUL bytes) or lossy UTF-8 decoding make a temporary text baseline unreliable.
 */
function isLossyBlob(stdout: string): boolean {
  return stdout.includes('\u0000') || stdout.includes('\ufffd');
}

/** Reject missing or empty paths before they reach a Git invocation. */
function requireFilePath(filePath: string, operation: string, worktreeRoot: string): void {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw providerError('GIT_OPERATION_FAILED', 'A changed file path is required', {
      workspaceRoot: worktreeRoot,
      operation,
    });
  }
}

/** Run a bounded number of Git reads in parallel without an unbounded fan-out. */
async function mapInChunks<Value, Result>(
  values: readonly Value[],
  concurrency: number,
  map: (value: Value) => Promise<Result>,
): Promise<readonly Result[]> {
  const results: Result[] = [];
  for (let index = 0; index < values.length; index += concurrency) {
    results.push(...await Promise.all(values.slice(index, index + concurrency).map(map)));
  }
  return results;
}

interface FileDiffIdentity {
  readonly commit: string;
  readonly path: string;
  readonly operation: string;
  readonly worktreeRoot: string;
  readonly detail?: string;
}

/**
 * Normalize one file-diff invocation: binary patches are emptied, exceeded output
 * bounds become an explicit truncated state, and Git failures keep the existing
 * provider error plumbing.
 */
async function shapeFileDiff(
  run: () => Promise<GitCommandResult>,
  identity: FileDiffIdentity,
): Promise<WorktreeGitFileDiff> {
  try {
    const result = await run();
    const binary = isBinaryDiff(result.stdout);
    return {
      commit: identity.commit,
      path: identity.path,
      patch: binary ? '' : result.stdout,
      binary,
    };
  } catch (error) {
    if (error instanceof GitCommandError && error.outputTruncated) {
      return {
        commit: identity.commit,
        path: identity.path,
        patch: '',
        binary: false,
        truncated: true,
      };
    }
    if (error instanceof WorktreeProviderError) throw error;
    throw operationError(identity.operation, identity.worktreeRoot, identity.path, identity.detail, error);
  }
}

export interface LocalGitAdapterOptions extends GitCommandOptions {
  readonly executable?: string;
  /** Test/embedded-runtime prefix; the normal Git executable needs no prefix. */
  readonly executableArgs?: readonly string[];
  readonly timeoutMs?: number;
  readonly graceMs?: number;
  /** Bounded best-effort wait after terminating a Git subprocess tree. */
  readonly cleanupTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly subprocess?: GitSubprocessRuntime;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_GRACE_MS = 1_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_GRACE_MS = 2_147_483_647;
const MAX_DIAGNOSTIC_BYTES = 32 * 1024;

// 保留 cwd、参数、stdout、stderr 和退出码，避免稳定错误 code 丢失现场诊断信息。
// Preserve cwd, arguments, stdout, stderr, and exit code so a stable error code
// does not discard the evidence needed for diagnosis.
function boundedDiagnostic(value: string): string {
  return value.length <= MAX_DIAGNOSTIC_BYTES
    ? value
    : `${value.slice(0, MAX_DIAGNOSTIC_BYTES)}\n[diagnostic output truncated]`;
}

function gitDetails(error: GitCommandError): Record<string, string | number | boolean | readonly string[]> {
  return {
    workspaceRoot: error.cwd,
    gitArgs: error.args,
    gitStdout: boundedDiagnostic(error.stdout),
    gitStderr: boundedDiagnostic(error.stderr),
    gitExitCode: typeof error.exitCode === 'number' ? error.exitCode : String(error.exitCode),
    ...(error.timedOut ? { gitTimedOut: true } : {}),
    ...(error.aborted ? { gitAborted: true } : {}),
    ...(error.outputTruncated ? { gitOutputTruncated: true } : {}),
    ...(error.processTreeDidNotExit ? { gitProcessTreeDidNotExit: true } : {}),
    ...(error.signal ? { gitSignal: error.signal } : {}),
  };
}

function isMissingGit(error: GitCommandError): boolean {
  return error.exitCode === 'ENOENT';
}

function missingGitError(
  operation: string,
  error: GitCommandError,
  targetPath?: string,
  branch?: string,
): WorktreeProviderError {
  return providerError(
    'GIT_NOT_INSTALLED',
    'Git is not installed or is not available on PATH.',
    {
      ...gitDetails(error),
      ...(targetPath ? { targetPath } : {}),
      ...(branch ? { branch } : {}),
      operation,
    },
  );
}

/*
 * 普通 Git 子命令失败统一归一化为 `GIT_OPERATION_FAILED`；仓库无效和缺少首个 commit
 * 则由 `validateRepository` 使用更具体、可操作的错误 code。
 *
 * Ordinary Git subcommand failures normalize to `GIT_OPERATION_FAILED`;
 * `validateRepository` reserves more actionable codes for an invalid
 * repository and a missing initial commit.
 */
function operationError(
  operation: string,
  workspaceRoot: string,
  targetPath: string | undefined,
  branch: string | undefined,
  error: unknown,
): WorktreeProviderError {
  if (!(error instanceof GitCommandError)) {
    return providerError('GIT_OPERATION_FAILED', `Git ${operation} failed: ${String(error)}`, {
      workspaceRoot,
      ...(targetPath ? { targetPath } : {}),
      ...(branch ? { branch } : {}),
    });
  }

  if (isMissingGit(error)) {
    return missingGitError(operation, error, targetPath, branch);
  }

  const message = error.stderr.trim() || error.stdout.trim() || error.message;
  return providerError(
    'GIT_OPERATION_FAILED',
    `Git ${operation} failed for ${workspaceRoot}${targetPath ? ` -> ${targetPath}` : ''}: ${message}`,
    {
      ...gitDetails(error),
      ...(targetPath ? { targetPath } : {}),
      ...(branch ? { branch } : {}),
      operation,
    },
  );
}

/*
 * 只解析 Git 保证稳定的 porcelain 字段。没有 `branch refs/heads/` 的条目仍被保留，
 * 其 branch 为 undefined，以正确表示 detached HEAD 等状态。
 *
 * Parse only Git's stable porcelain fields. Entries without
 * `branch refs/heads/` are retained with an undefined branch so states such as
 * detached HEAD remain visible.
 */
function parseWorktrees(output: string): readonly GitWorktreeInfo[] {
  const worktrees: GitWorktreeInfo[] = [];
  let current: { absolutePath?: string; branch?: string; headCommit?: string; detached?: boolean; prunable?: boolean; locked?: boolean; bare?: boolean } = {};

  const flush = () => {
    if (current.absolutePath) {
      worktrees.push({
        absolutePath: current.absolutePath,
        ...(current.branch ? { branch: current.branch } : {}),
        ...(current.headCommit ? { headCommit: current.headCommit } : {}),
        detached: current.detached ?? !current.branch,
        ...(current.prunable ? { prunable: true } : {}),
        ...(current.locked ? { locked: true } : {}),
        ...(current.bare ? { bare: true } : {}),
      });
    }
    current = {};
  };

  for (const line of output.split('\n')) {
    if (line.length === 0) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      current.absolutePath = line.slice('worktree '.length);
      continue;
    }
    if (line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
      current.detached = false;
      continue;
    }
    if (line.startsWith('HEAD ')) {
      current.headCommit = line.slice('HEAD '.length);
      continue;
    }
    if (line === 'detached') {
      current.detached = true;
    }
    if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true;
    if (line === 'locked' || line.startsWith('locked ')) current.locked = true;
    if (line === 'bare') current.bare = true;
  }
  flush();
  return worktrees;
}

/** Parse `for-each-ref` branch/path pairs without relying on whitespace delimiters. */
function parseBranchWorktreePaths(output: string): readonly GitBranchWorktreeInfo[] {
  const fields = output.split('\0');
  const branches: GitBranchWorktreeInfo[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const name = (fields[index] ?? '').replace(/^\r?\n/u, '');
    const worktreePath = fields[index + 1] ?? '';
    if (!name) continue;
    branches.push({
      name,
      ...(worktreePath ? { worktreePath } : {}),
    });
  }
  return branches;
}

function isUnsupportedWorktreePathAtom(error: unknown): boolean {
  return error instanceof GitCommandError && /unknown field name:\s*worktreepath/iu.test(error.stderr);
}

/**
 * 本地 Git worktree adapter：所有命令都以 DSH Workspace 根目录为 cwd，并仅使用固定的
 * 本地子命令；不使用 `--force`，也不访问 remote。
 *
 * Local Git worktree adapter: every command runs with the DSH Workspace root as
 * cwd and uses a fixed local-only subcommand; it never uses `--force` or accesses
 * remotes.
 */
export class LocalGitAdapter implements GitWorktreeAdapter {
  private readonly executable: string;
  private readonly executableArgs: readonly string[];
  private readonly timeoutMs: number;
  private readonly graceMs: number;
  private readonly cleanupTimeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly defaultSignal?: AbortSignal;
  private readonly subprocess?: GitSubprocessRuntime;

  constructor(options: LocalGitAdapterOptions = {}) {
    this.executable = options.executable ?? 'git';
    this.executableArgs = options.executableArgs ?? [];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? Math.max(DEFAULT_CLEANUP_TIMEOUT_MS, this.graceMs);
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.defaultSignal = options.signal;
    this.subprocess = options.subprocess;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > MAX_TIMEOUT_MS ||
      !Number.isInteger(this.graceMs) || this.graceMs <= 0 || this.graceMs > MAX_GRACE_MS ||
      !Number.isInteger(this.cleanupTimeoutMs) || this.cleanupTimeoutMs <= 0 || this.cleanupTimeoutMs > MAX_TIMEOUT_MS ||
      !Number.isInteger(this.maxOutputBytes) || this.maxOutputBytes <= 0) {
      throw providerError('GIT_OPERATION_FAILED', 'Invalid Git subprocess limits', {
        timeoutMs: this.timeoutMs,
        graceMs: this.graceMs,
        cleanupTimeoutMs: this.cleanupTimeoutMs,
        maxOutputBytes: this.maxOutputBytes,
      });
    }
  }

  private run(
    args: readonly string[],
    cwd: string,
    options: GitCommandOptions = {},
    readOnly = true,
  ): Promise<GitCommandResult> {
    const signal = options.signal ?? this.defaultSignal;
    if (signal?.aborted) {
      return Promise.reject(new GitCommandError(args, cwd, '', '', null, { timedOut: false, aborted: true, outputTruncated: false }));
    }
    return runGit(args, cwd, this.executable, this.executableArgs, {
      timeoutMs: this.timeoutMs,
      graceMs: this.graceMs,
      cleanupTimeoutMs: this.cleanupTimeoutMs,
      maxOutputBytes: this.maxOutputBytes,
      readOnly,
      signal: options.signal ?? this.defaultSignal,
      subprocess: this.subprocess,
    });
  }

  /**
   * 分开验证“位于非 bare working tree”和“已有可解析的首个 commit”，以返回不同修复语义。
   * Separately verifies “inside a non-bare working tree” and “has a resolvable
   * initial commit” so callers receive distinct repair semantics.
   */
  async validateRepository(workspaceRoot: string, options: GitCommandOptions = {}): Promise<void> {
    let result: GitCommandResult;
    try {
      result = await this.run(
        ['rev-parse', '--is-inside-work-tree'],
        workspaceRoot,
        options,
      );
    } catch (error) {
      if (error instanceof GitCommandError) {
        if (isMissingGit(error)) {
          throw missingGitError('validate repository', error);
        }
        if (error.timedOut || error.aborted) throw operationError('validate repository', workspaceRoot, undefined, undefined, error);
        throw providerError('WORKSPACE_NOT_GIT_REPOSITORY', `Workspace is not a Git repository: ${workspaceRoot}`, {
          ...gitDetails(error),
        });
      }
      throw error;
    }

    if (result.stdout.trim() !== 'true') {
      throw providerError('WORKSPACE_NOT_GIT_REPOSITORY', `Workspace is not a Git work tree: ${workspaceRoot}`, {
        workspaceRoot,
      });
    }

    try {
      await this.run(
        ['rev-parse', '--verify', 'HEAD^{commit}'],
        workspaceRoot,
        options,
      );
    } catch (error) {
      if (error instanceof GitCommandError) {
        if (isMissingGit(error)) {
          throw missingGitError('validate repository', error);
        }
        if (error.timedOut || error.aborted) throw operationError('validate repository', workspaceRoot, undefined, undefined, error);
        throw providerError(
          'WORKTREE_REQUIRES_INITIAL_COMMIT',
          `Workspace has no initial commit: ${workspaceRoot}`,
          { ...gitDetails(error) },
        );
      }
      throw error;
    }
  }

  /** Resolve the Git worktree/repository root for repository-wide reads. */
  async resolveRepositoryRoot(workspaceRoot: string, options: GitCommandOptions = {}): Promise<string> {
    try {
      const rootResult = await this.run(
        ['rev-parse', '--show-toplevel'],
        workspaceRoot,
        options,
      );
      const repositoryRoot = rootResult.stdout.trim();
      if (repositoryRoot.length === 0) {
        throw providerError('GIT_OPERATION_FAILED', `Git did not return a repository root: ${workspaceRoot}`, {
          workspaceRoot,
          operation: 'resolve repository root',
        });
      }
      return await realpath(path.isAbsolute(repositoryRoot)
        ? path.resolve(repositoryRoot)
        : path.resolve(workspaceRoot, repositoryRoot));
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('resolve repository root', workspaceRoot, undefined, undefined, error);
    }
  }

  /** Resolve the canonical linked-worktree and shared Git metadata identity. */
  async resolveRepositoryIdentity(workspaceRoot: string, options: GitCommandOptions = {}) {
    try {
      const result = await this.run(
        ['rev-parse', '--show-toplevel', '--git-common-dir', '--verify', 'HEAD^{commit}'],
        workspaceRoot,
        options,
      );
      const lines = result.stdout.split(/\r?\n/u);
      if (lines.at(-1) === '') lines.pop();
      const [topLevel, commonDirectory, headCommit] = lines;
      if (!topLevel || !commonDirectory || !headCommit) {
        throw providerError('GIT_OPERATION_FAILED', `Git returned an incomplete repository identity: ${workspaceRoot}`, {
          workspaceRoot,
          operation: 'resolve repository identity',
        });
      }
      return {
        identity: {
          topLevel: await realpath(path.isAbsolute(topLevel) ? path.resolve(topLevel) : path.resolve(workspaceRoot, topLevel)),
          commonDirectory: await realpath(path.isAbsolute(commonDirectory)
            ? path.resolve(commonDirectory)
            : path.resolve(workspaceRoot, commonDirectory)),
        },
        headCommit,
      };
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('resolve repository identity', workspaceRoot, undefined, undefined, error);
    }
  }

  /** Resolve a ref to one canonical commit object for a bounded Manage operation. */
  async resolveCommit(workspaceRoot: string, ref: string, options: GitCommandOptions = {}): Promise<string> {
    try {
      const result = await this.run(
        ['rev-parse', '--verify', `${ref}^{commit}`],
        workspaceRoot,
        options,
      );
      return parseCommitHash(result.stdout, 'resolve commit', workspaceRoot);
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('resolve commit', workspaceRoot, undefined, ref, error);
    }
  }

  /** Resolve a common ancestor for two branch heads. */
  async findMergeBase(
    workspaceRoot: string,
    left: string,
    right: string,
    options: GitCommandOptions = {},
  ): Promise<string | undefined> {
    try {
      const result = await this.run(['merge-base', left, right], workspaceRoot, options);
      return parseCommitHash(result.stdout, 'find merge base', workspaceRoot);
    } catch (error) {
      if (
        error instanceof GitCommandError &&
        error.exitCode === 1 &&
        !error.timedOut &&
        !error.aborted &&
        !error.outputTruncated
      ) {
        return undefined;
      }
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('find merge base', workspaceRoot, undefined, left, error);
    }
  }

  /** Check ancestry without exposing a general-purpose commit/object endpoint. */
  async isCommitAncestor(
    workspaceRoot: string,
    ancestor: string,
    descendant: string,
    options: GitCommandOptions = {},
  ): Promise<boolean> {
    try {
      await this.run(
        ['merge-base', '--is-ancestor', ancestor, descendant],
        workspaceRoot,
        options,
      );
      return true;
    } catch (error) {
      if (
        error instanceof GitCommandError &&
        error.exitCode === 1 &&
        !error.timedOut &&
        !error.aborted &&
        !error.outputTruncated
      ) {
        return false;
      }
      throw operationError('check commit ancestry', workspaceRoot, undefined, descendant, error);
    }
  }

  /** Count commits that exist only on either branch head. */
  async getCommitDivergence(
    worktreeRoot: string,
    baselineCommit: string,
    headCommit: string,
    options: GitCommandOptions = {},
  ): Promise<{ readonly ahead: number; readonly behind: number }> {
    assertCommitArgument(baselineCommit, 'count commit divergence', worktreeRoot);
    assertCommitArgument(headCommit, 'count commit divergence', worktreeRoot);
    try {
      const result = await this.run(
        ['rev-list', '--left-right', '--count', baselineCommit + '...' + headCommit],
        worktreeRoot,
        options,
      );
      const fields = result.stdout.trim().split(/\s+/u);
      if (fields.length !== 2 || fields.some((field) => !/^\d+$/u.test(field))) {
        throw providerError('GIT_OPERATION_FAILED', 'Git returned malformed ahead-behind counts', {
          workspaceRoot: worktreeRoot,
          operation: 'count commit divergence',
        });
      }
      const behind = parseDiffCount(fields[0]!, worktreeRoot, 'count commit divergence');
      const ahead = parseDiffCount(fields[1]!, worktreeRoot, 'count commit divergence');
      if (behind === undefined || ahead === undefined) {
        throw providerError('GIT_OPERATION_FAILED', 'Git returned malformed ahead-behind counts', {
          workspaceRoot: worktreeRoot,
          operation: 'count commit divergence',
        });
      }
      return { behind, ahead };
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('count commit divergence', worktreeRoot, undefined, headCommit, error);
    }
  }

  /** Read at most 201 Worktree commits after a resolved base branch tip. */
  async listCommits(
    worktreeRoot: string,
    baseCommit: string,
    options: GitCommandOptions = {},
  ): Promise<GitCommitHistoryRead> {
    assertCommitArgument(baseCommit, 'list commits', worktreeRoot);
    const headCommit = await this.resolveCommit(worktreeRoot, 'HEAD', options);
    try {
      const result = await this.run(
        [
          'log',
          '--no-color',
          '--topo-order',
          `--max-count=${HISTORY_REQUEST_LIMIT}`,
          '--format=%H%x00%P%x00%s%x00%an%x00%ae%x00%aI%x1e',
          `${baseCommit}..HEAD`,
        ],
        worktreeRoot,
        options,
      );
      const commits = result.stdout
        .split('\x1e')
        .map((record) => record.replace(/^[\r\n]+|[\r\n]+$/gu, ''))
        .filter((record) => record.length > 0)
        .map((record) => parseCommitRecord(record, worktreeRoot));
      return {
        headCommit,
        commits: commits.slice(0, HISTORY_VISIBLE_LIMIT),
        truncated: commits.length > HISTORY_VISIBLE_LIMIT,
      };
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('list commits', worktreeRoot, undefined, baseCommit, error);
    }
  }

  private async isTrackedWorkingTreeFile(
    worktreeRoot: string,
    filePath: string,
    options: GitCommandOptions,
  ): Promise<boolean> {
    try {
      await this.run(['ls-files', '--error-unmatch', '--', filePath], worktreeRoot, options);
      return true;
    } catch (error) {
      if (
        error instanceof GitCommandError &&
        error.exitCode === 1 &&
        !error.timedOut &&
        !error.aborted &&
        !error.outputTruncated
      ) {
        return false;
      }
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('check working tree file', worktreeRoot, filePath, undefined, error);
    }
  }

  private async isPresentInCommit(
    worktreeRoot: string,
    commit: string,
    filePath: string,
    options: GitCommandOptions,
  ): Promise<boolean> {
    if (commit !== 'HEAD') assertCommitArgument(commit, 'check committed working-tree file', worktreeRoot);
    try {
      const result = await this.run(
        ['--literal-pathspecs', 'ls-tree', '-r', '-z', '--name-only', commit, '--', filePath],
        worktreeRoot,
        options,
      );
      return result.stdout.split('\0').some((candidate) => candidate === filePath);
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('check committed working-tree file', worktreeRoot, filePath, commit, error);
    }
  }

  private async isPresentOnDisk(
    worktreeRoot: string,
    filePath: string,
  ): Promise<boolean> {
    try {
      await lstat(path.resolve(worktreeRoot, filePath));
      return true;
    } catch (error) {
      if ((error as { readonly code?: string }).code === 'ENOENT') return false;
      throw operationError('check working tree path', worktreeRoot, filePath, undefined, error);
    }
  }

  private async readRestoredWorkingTreeFileDiff(
    worktreeRoot: string,
    baseCommit: string,
    filePath: string,
    options: GitCommandOptions,
  ): Promise<GitCommandResult | undefined> {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-git-live-diff-'));
    const baselinePath = path.join(temporaryDirectory, 'baseline');
    try {
      const baseline = await this.run(
        ['--literal-pathspecs', 'cat-file', 'blob', `${baseCommit}:${filePath}`],
        worktreeRoot,
        options,
      );
      // A re-encoded binary baseline would produce a false comparison result, so
      // the caller falls back to the untracked projection instead.
      if (isLossyBlob(baseline.stdout)) return undefined;
      await writeFile(baselinePath, baseline.stdout);
      const result = await this.runDiffAllowingChanges(
        [
          '--literal-pathspecs',
          'diff',
          '--no-index',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--',
          baselinePath,
          filePath,
        ],
        worktreeRoot,
        options,
      );
      return {
        ...result,
        stdout: result.stdout.replaceAll(baselinePath, filePath),
      };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async readRestoredWorkingTreeFileStats(
    worktreeRoot: string,
    baseCommit: string,
    filePath: string,
    options: GitCommandOptions,
  ): Promise<readonly GitDiffStat[]> {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-git-live-numstat-'));
    const baselinePath = path.join(temporaryDirectory, 'baseline');
    try {
      const baseline = await this.run(
        ['--literal-pathspecs', 'cat-file', 'blob', baseCommit + ':' + filePath],
        worktreeRoot,
        options,
      );
      // Binary line counts cannot be derived from a re-encoded baseline; report
      // them as explicitly unknown rather than as an approximate number.
      if (isLossyBlob(baseline.stdout)) return [{ path: filePath, unknown: true }];
      await writeFile(baselinePath, baseline.stdout);
      const result = await this.runDiffAllowingChanges(
        [
          '--literal-pathspecs',
          'diff',
          '--no-index',
          '--numstat',
          '-z',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--',
          baselinePath,
          filePath,
        ],
        worktreeRoot,
        options,
      );
      const stats = parseNumstat(result.stdout, worktreeRoot, 'list working-tree diff files');
      return stats.length === 0
        ? [{ path: filePath, additions: 0, deletions: 0 }]
        : stats.map((stat) => ({
            ...stat,
            path: filePath,
            oldPath: undefined,
          }));
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async normalizeWorkingTreeDiffFiles(
    worktreeRoot: string,
    baseCommit: string,
    tracked: readonly WorktreeGitChangedFile[],
    untracked: readonly WorktreeGitChangedFile[],
    options: GitCommandOptions,
  ): Promise<{
    readonly files: readonly WorktreeGitChangedFile[];
    readonly restoredPaths: readonly string[];
    readonly addedPaths: readonly string[];
  }> {
    const untrackedPaths = new Set(untracked.map((file) => file.path));
    const restoredPaths = new Set<string>();
    const addedPaths = new Set<string>();
    const replacements = new Map<number, readonly WorktreeGitChangedFile[]>();
    for (const [index, file] of tracked.entries()) {
      const restoredPath = file.status === 'deleted'
        ? file.path
        : (file.status === 'renamed' || file.status === 'copied')
          ? file.oldPath
          : undefined;
      if (restoredPath === undefined || !untrackedPaths.has(restoredPath) || restoredPaths.has(restoredPath)) continue;
      const result = await this.readRestoredWorkingTreeFileDiff(worktreeRoot, baseCommit, restoredPath, options);
      restoredPaths.add(restoredPath);
      // An unrepresentable binary baseline counts as changed so the live
      // projection never hides a real difference.
      const differs = result === undefined || isBinaryDiff(result.stdout) || result.stdout.length > 0;
      if (file.status === 'deleted') {
        replacements.set(index, differs ? [{ path: file.path, status: 'modified' }] : []);
      } else if (differs) {
        replacements.set(index, [
          { path: restoredPath, status: 'modified' },
          { path: file.path, status: 'added' },
        ]);
        addedPaths.add(file.path);
      } else {
        replacements.set(index, [{ ...file, status: 'copied' }]);
      }
    }
    return {
      files: [
        ...tracked.flatMap((file, index) => replacements.get(index) ?? [file]),
        ...untracked.filter((file) => !restoredPaths.has(file.path)),
      ],
      restoredPaths: [...restoredPaths],
      addedPaths: [...addedPaths],
    };
  }

  private async readNumstat(
    args: readonly string[],
    worktreeRoot: string,
    operation: string,
    options: GitCommandOptions,
  ): Promise<readonly GitDiffStat[]> {
    const result = await this.run(args, worktreeRoot, options);
    return parseNumstat(result.stdout, worktreeRoot, operation);
  }

  private async listUntrackedFileStats(
    worktreeRoot: string,
    files: readonly WorktreeGitChangedFile[],
    operation: string,
    options: GitCommandOptions,
  ): Promise<readonly GitDiffStat[]> {
    const bounded = files.slice(0, MAX_UNTRACKED_STAT_FILES);
    const stats = await mapInChunks(bounded, STAT_READ_CONCURRENCY, async (file) => {
      const result = await this.runDiffAllowingChanges(
        [
          '--literal-pathspecs',
          'diff',
          '--no-index',
          '--numstat',
          '-z',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--',
          '/dev/null',
          file.path,
        ],
        worktreeRoot,
        options,
      );
      return parseNumstat(result.stdout, worktreeRoot, operation).map((stat) => ({
        ...stat,
        path: file.path,
        oldPath: undefined,
      }));
    });
    return stats.flat();
  }

  private async runDiffAllowingChanges(
    args: readonly string[],
    worktreeRoot: string,
    options: GitCommandOptions,
  ): Promise<GitCommandResult> {
    try {
      return await this.run(args, worktreeRoot, options);
    } catch (error) {
      // `git diff --no-index` exits with 1 when it finds a difference.
      if (
        error instanceof GitCommandError &&
        error.exitCode === 1 &&
        !error.timedOut &&
        !error.aborted &&
        !error.outputTruncated
      ) {
        return { stdout: error.stdout, stderr: error.stderr };
      }
      throw error;
    }
  }

  /** Read the tracked and untracked changed-path projection for one revision. */
  private async readChangedFiles(
    worktreeRoot: string,
    revision: string,
    options: GitCommandOptions,
  ): Promise<{
    readonly tracked: readonly WorktreeGitChangedFile[];
    readonly untracked: readonly WorktreeGitChangedFile[];
  }> {
    const [tracked, untracked] = await Promise.all([
      this.run(
        ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', '-C', revision, '--'],
        worktreeRoot,
        options,
      ),
      this.run(
        ['ls-files', '--others', '--exclude-standard', '-z', '--'],
        worktreeRoot,
        options,
      ),
    ]);
    return {
      tracked: parseChangedFiles(tracked.stdout, worktreeRoot),
      untracked: parseUntrackedFiles(untracked.stdout),
    };
  }

  /**
   * Read the live working-tree changed paths without line statistics. Path
   * authorization only needs the projection, so callers that must confirm one
   * path avoid the per-untracked-file statistics probe.
   */
  async listWorkingTreeChangedPaths(
    worktreeRoot: string,
    options: GitCommandOptions = {},
  ): Promise<readonly WorktreeGitChangedFile[]> {
    try {
      const { tracked, untracked } = await this.readChangedFiles(worktreeRoot, 'HEAD', options);
      return [...tracked, ...untracked];
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('list working tree changed paths', worktreeRoot, undefined, 'HEAD', error);
    }
  }

  /** Read tracked and untracked changes relative to the current HEAD. */
  async listWorkingTreeFiles(
    worktreeRoot: string,
    options: GitCommandOptions = {},
  ): Promise<readonly WorktreeGitChangedFile[]> {
    try {
      const { tracked, untracked } = await this.readChangedFiles(worktreeRoot, 'HEAD', options);
      const [trackedStats, untrackedStats] = await Promise.all([
        this.readNumstat(
          ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '-M', '-C', 'HEAD', '--'],
          worktreeRoot,
          'list working tree files',
          options,
        ),
        this.listUntrackedFileStats(worktreeRoot, untracked, 'list working tree files', options),
      ]);
      return decorateChangedFiles(
        [...tracked, ...untracked],
        [...trackedStats, ...untrackedStats],
      );
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('list working tree files', worktreeRoot, undefined, 'HEAD', error);
    }
  }

  /** Read one tracked or untracked working-tree file diff against HEAD. */
  async readWorkingTreeFileDiff(
    worktreeRoot: string,
    filePath: string,
    options: GitCommandOptions = {},
  ): Promise<WorktreeGitFileDiff> {
    const operation = 'read working tree file diff';
    requireFilePath(filePath, operation, worktreeRoot);
    const tracked = await this.isTrackedWorkingTreeFile(worktreeRoot, filePath, options);
    const presentInBase = !tracked && await this.isPresentInCommit(worktreeRoot, 'HEAD', filePath, options);
    const restoredUntracked = presentInBase && await this.isPresentOnDisk(worktreeRoot, filePath);
    const compareAsTracked = tracked || (presentInBase && !restoredUntracked);
    const trackedArgs = [
      '--literal-pathspecs',
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '-M',
      'HEAD',
      '--',
      filePath,
    ];
    const untrackedArgs = [
      '--literal-pathspecs',
      'diff',
      '--no-index',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--',
      '/dev/null',
      filePath,
    ];
    return shapeFileDiff(
      async () => {
        if (!restoredUntracked) {
          return compareAsTracked
            ? this.run(trackedArgs, worktreeRoot, options)
            : this.runDiffAllowingChanges(untrackedArgs, worktreeRoot, options);
        }
        // A binary baseline blob cannot round-trip through decoded stdout: fall
        // back to the untracked projection instead of claiming equality.
        const restored = await this.readRestoredWorkingTreeFileDiff(worktreeRoot, 'HEAD', filePath, options);
        return restored ?? this.runDiffAllowingChanges(untrackedArgs, worktreeRoot, options);
      },
      { commit: WORKTREE_GIT_WORKING_TREE, path: filePath, operation, worktreeRoot, detail: 'HEAD' },
    );
  }

  private async resolveCommitParents(
    worktreeRoot: string,
    commit: string,
    options: GitCommandOptions,
  ): Promise<readonly string[]> {
    assertCommitArgument(commit, 'read commit parents', worktreeRoot);
    try {
      const result = await this.run(
        ['rev-list', '--parents', '-n', '1', commit],
        worktreeRoot,
        options,
      );
      const fields = result.stdout.trim().split(/\s+/u).filter((field) => field.length > 0);
      if (fields.length === 0 || !COMMIT_PATTERN.test(fields[0] ?? '') ||
        fields.slice(1).some((parent) => !COMMIT_PATTERN.test(parent))) {
        throw providerError('GIT_OPERATION_FAILED', 'Git returned malformed commit parent data', {
          workspaceRoot: worktreeRoot,
          operation: 'read commit parents',
        });
      }
      return fields.slice(1);
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('read commit parents', worktreeRoot, undefined, commit, error);
    }
  }

  /** Read one net baseline-to-HEAD tree diff using NUL-safe output. */
  async listDiffFiles(
    worktreeRoot: string,
    baseCommit: string,
    targetCommit: string,
    options: GitCommandOptions = {},
  ): Promise<readonly WorktreeGitChangedFile[]> {
    assertCommitArgument(baseCommit, 'list diff files', worktreeRoot);
    assertCommitArgument(targetCommit, 'list diff files', worktreeRoot);
    try {
      const [result, stats] = await Promise.all([
        this.run(
          ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', '-C', baseCommit, targetCommit, '--'],
          worktreeRoot,
          options,
        ),
        this.readNumstat(
          ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '-M', '-C', baseCommit, targetCommit, '--'],
          worktreeRoot,
          'list diff files',
          options,
        ),
      ]);
      return decorateChangedFiles(parseChangedFiles(result.stdout, worktreeRoot), stats);
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('list diff files', worktreeRoot, undefined, `${baseCommit}..${targetCommit}`, error);
    }
  }

  /** Read net tracked and untracked changes from an arbitrary committed base to the live tree. */
  async listWorkingTreeDiffFiles(
    worktreeRoot: string,
    baseCommit: string,
    options: GitCommandOptions = {},
  ): Promise<readonly WorktreeGitChangedFile[]> {
    assertCommitArgument(baseCommit, 'list working-tree diff files', worktreeRoot);
    try {
      const { tracked: trackedFiles, untracked: untrackedFiles } = await this.readChangedFiles(
        worktreeRoot,
        baseCommit,
        options,
      );
      const [trackedStats, untrackedStats] = await Promise.all([
        this.readNumstat(
          ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '-M', '-C', baseCommit, '--'],
          worktreeRoot,
          'list working-tree diff files',
          options,
        ),
        this.listUntrackedFileStats(worktreeRoot, untrackedFiles, 'list working-tree diff files', options),
      ]);
      const normalized = await this.normalizeWorkingTreeDiffFiles(
        worktreeRoot,
        baseCommit,
        trackedFiles,
        untrackedFiles,
        options,
      );
      const restoredPaths = new Set(normalized.restoredPaths);
      const restoredStats = await Promise.all(normalized.restoredPaths.map((filePath) =>
        this.readRestoredWorkingTreeFileStats(worktreeRoot, baseCommit, filePath, options),
      ));
      const restoredAddedStats = await this.listUntrackedFileStats(
        worktreeRoot,
        normalized.addedPaths.map((filePath) => ({ path: filePath, status: 'added' as const })),
        'list working-tree diff files',
        options,
      );
      const baseStats = omitRestoredStats([...trackedStats, ...untrackedStats], restoredPaths);
      return decorateChangedFiles(normalized.files, [...baseStats, ...restoredStats.flat(), ...restoredAddedStats]);
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('list working-tree diff files', worktreeRoot, undefined, baseCommit, error);
    }
  }

  /** Read first-parent (or root) changed-file metadata using NUL-safe output. */
  async listCommitFiles(
    worktreeRoot: string,
    commit: string,
    options: GitCommandOptions = {},
  ): Promise<readonly WorktreeGitChangedFile[]> {
    const parents = await this.resolveCommitParents(worktreeRoot, commit, options);
    const args = parents.length > 0
      ? ['--literal-pathspecs', 'diff-tree', '--no-commit-id', '--name-status', '-z', '-r', '-M', '-C', parents[0]!, commit]
      : ['--literal-pathspecs', 'diff-tree', '--root', '--no-commit-id', '--name-status', '-z', '-r', '-M', '-C', commit];
    const numstatArgs = parents.length > 0
      ? ['--literal-pathspecs', 'diff-tree', '--no-commit-id', '--numstat', '-z', '-r', '-M', '-C', parents[0]!, commit]
      : ['--literal-pathspecs', 'diff-tree', '--root', '--no-commit-id', '--numstat', '-z', '-r', '-M', '-C', commit];
    try {
      const [result, stats] = await Promise.all([
        this.run(args, worktreeRoot, options),
        this.readNumstat(numstatArgs, worktreeRoot, 'list commit files', options),
      ]);
      return decorateChangedFiles(parseChangedFiles(result.stdout, worktreeRoot), stats);
    } catch (error) {
      if (error instanceof WorktreeProviderError) throw error;
      throw operationError('list commit files', worktreeRoot, undefined, commit, error);
    }
  }

  /** Read one live working-tree file from an arbitrary committed base. */
  async readWorkingTreeDiffFileDiff(
    worktreeRoot: string,
    baseCommit: string,
    filePath: string,
    options: GitCommandOptions = {},
  ): Promise<WorktreeGitFileDiff> {
    const operation = 'read working-tree diff file';
    requireFilePath(filePath, operation, worktreeRoot);
    assertCommitArgument(baseCommit, operation, worktreeRoot);
    const tracked = await this.isTrackedWorkingTreeFile(worktreeRoot, filePath, options);
    const presentInBase = !tracked && await this.isPresentInCommit(worktreeRoot, baseCommit, filePath, options);
    const restoredUntracked = presentInBase && await this.isPresentOnDisk(worktreeRoot, filePath);
    const compareAsTracked = tracked || (presentInBase && !restoredUntracked);
    const trackedArgs = [
      '--literal-pathspecs',
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '-M',
      '-C',
      baseCommit,
      '--',
      filePath,
    ];
    const untrackedArgs = [
      '--literal-pathspecs',
      'diff',
      '--no-index',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--',
      '/dev/null',
      filePath,
    ];
    return shapeFileDiff(
      async () => {
        if (!restoredUntracked) {
          return compareAsTracked
            ? this.run(trackedArgs, worktreeRoot, options)
            : this.runDiffAllowingChanges(untrackedArgs, worktreeRoot, options);
        }
        const restored = await this.readRestoredWorkingTreeFileDiff(worktreeRoot, baseCommit, filePath, options);
        return restored ?? this.runDiffAllowingChanges(untrackedArgs, worktreeRoot, options);
      },
      { commit: WORKTREE_GIT_WORKING_TREE, path: filePath, operation, worktreeRoot, detail: baseCommit },
    );
  }

  /** Read one file from a net baseline-to-HEAD tree diff. */
  async readDiffFileDiff(
    worktreeRoot: string,
    baseCommit: string,
    targetCommit: string,
    filePath: string,
    options: GitCommandOptions = {},
  ): Promise<WorktreeGitFileDiff> {
    const operation = 'read diff file diff';
    requireFilePath(filePath, operation, worktreeRoot);
    assertCommitArgument(baseCommit, operation, worktreeRoot);
    assertCommitArgument(targetCommit, operation, worktreeRoot);
    return shapeFileDiff(
      () => this.run(
        ['--literal-pathspecs', 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '-C', baseCommit, targetCommit, '--', filePath],
        worktreeRoot,
        options,
      ),
      {
        commit: targetCommit,
        path: filePath,
        operation,
        worktreeRoot,
        detail: baseCommit + '..' + targetCommit,
      },
    );
  }

  /** Read one authorized file patch with external diff and textconv disabled. */
  async readCommitFileDiff(
    worktreeRoot: string,
    commit: string,
    filePath: string,
    options: GitCommandOptions = {},
  ): Promise<WorktreeGitFileDiff> {
    const operation = 'read commit file diff';
    requireFilePath(filePath, operation, worktreeRoot);
    const parents = await this.resolveCommitParents(worktreeRoot, commit, options);
    const args = parents.length > 0
      ? [
          '--literal-pathspecs',
          'diff',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '-M',
          parents[0]!,
          commit,
          '--',
          filePath,
        ]
      : [
          '--literal-pathspecs',
          'diff-tree',
          '--root',
          '--no-commit-id',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '-p',
          '-M',
          commit,
          '--',
          filePath,
        ];
    return shapeFileDiff(
      () => this.run(args, worktreeRoot, options),
      { commit, path: filePath, operation, worktreeRoot, detail: commit },
    );
  }

  /**
   * 仅列出 `refs/heads/` 下的本地分支；NUL 分隔避免依赖面向人的展示格式或空白切分。
   * Lists local branches under `refs/heads/` only; NUL delimiting avoids
   * depending on human-facing formatting or whitespace tokenization.
   */
  async listBranches(workspaceRoot: string, options: GitCommandOptions = {}): Promise<readonly string[]> {
    try {
      const result = await this.run(
        ['for-each-ref', '--format=%(refname:short)%00', 'refs/heads/'],
        workspaceRoot,
        options,
      );
      return result.stdout
        .split('\0')
        .map((branch) => branch.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))
        .filter((branch) => branch.length > 0);
    } catch (error) {
      throw operationError('list branches', workspaceRoot, undefined, undefined, error);
    }
  }

  /**
   * Read local branches and their checkout paths in one Git invocation when the
   * installed Git supports the `worktreepath` format atom.
   */
  async listBranchesWithWorktreePaths(
    workspaceRoot: string,
    options: GitCommandOptions = {},
  ): Promise<readonly GitBranchWorktreeInfo[]> {
    try {
      const result = await this.run(
        ['for-each-ref', '--format=%(refname:short)%00%(worktreepath)%00', 'refs/heads/'],
        workspaceRoot,
        options,
      );
      return parseBranchWorktreePaths(result.stdout);
    } catch (error) {
      if (!isUnsupportedWorktreePathAtom(error)) {
        throw operationError('list branches', workspaceRoot, undefined, undefined, error);
      }
      const [branches, worktrees] = await Promise.all([
        this.listBranches(workspaceRoot, options),
        this.listWorktrees(workspaceRoot, options),
      ]);
      const worktreePathByBranch = new Map(
        worktrees.flatMap((worktree) => worktree.branch
          ? [[worktree.branch, worktree.absolutePath] as const]
          : []),
      );
      return branches.map((name) => ({
        name,
        ...(worktreePathByBranch.has(name) ? { worktreePath: worktreePathByBranch.get(name) } : {}),
      }));
    }
  }

  /**
   * 使用 porcelain 输出枚举已注册 Worktree；无法映射到本地 branch 的条目不会被丢弃。
   * Enumerates registered Worktrees through porcelain output; entries that do
   * not map to a local branch are not discarded.
   */
  async listWorktrees(workspaceRoot: string, options: GitCommandOptions = {}): Promise<readonly GitWorktreeInfo[]> {
    try {
      const result = await this.run(
        ['worktree', 'list', '--porcelain'],
        workspaceRoot,
        options,
      );
      return parseWorktrees(result.stdout);
    } catch (error) {
      throw operationError('list worktrees', workspaceRoot, undefined, undefined, error);
    }
  }

  /**
   * 执行 `git worktree add`；传入 newBranch 时使用 `-b` 从 base branch 创建本地分支。
   * Executes `git worktree add`; when newBranch is supplied, `-b` creates a local
   * branch from the selected base branch.
   */
  async createWorktree(
    workspaceRoot: string,
    targetPath: string,
    branch: string,
    newBranch?: string,
    options: GitCommandOptions = {},
  ): Promise<void> {
    try {
      const args = newBranch
        ? ['worktree', 'add', '-b', newBranch, targetPath, branch]
        : ['worktree', 'add', targetPath, branch];
      await this.run(args, workspaceRoot, options, false);
    } catch (error) {
      throw operationError('create worktree', workspaceRoot, targetPath, newBranch ?? branch, error);
    }
  }

  /**
   * 仅执行非强制 `git worktree remove <targetPath>`；Git 的安全拒绝会原样升级为显式错误。
   * Executes non-forced `git worktree remove <targetPath>` only; Git safety
   * refusals are surfaced as explicit errors.
   */
  async removeWorktree(workspaceRoot: string, targetPath: string, options: GitCommandOptions = {}): Promise<void> {
    try {
      await this.run(['worktree', 'remove', targetPath], workspaceRoot, options, false);
    } catch (error) {
      throw operationError('remove worktree', workspaceRoot, targetPath, undefined, error);
    }
  }
}
