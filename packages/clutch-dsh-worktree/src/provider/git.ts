import { realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  GitCommandError,
  runGit,
} from './subprocess.js';
import type { GitCommandResult } from './subprocess.js';
import type {
  GitCommandOptions,
  GitBranchWorktreeInfo,
  GitSubprocessRuntime,
  GitWorktreeAdapter,
  GitWorktreeInfo,
} from './types.js';
import { WorktreeProviderError, providerError } from './types.js';

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
  let current: { absolutePath?: string; branch?: string; headCommit?: string; detached?: boolean } = {};

  const flush = () => {
    if (current.absolutePath) {
      worktrees.push({
        absolutePath: current.absolutePath,
        ...(current.branch ? { branch: current.branch } : {}),
        ...(current.headCommit ? { headCommit: current.headCommit } : {}),
        detached: current.detached ?? !current.branch,
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
