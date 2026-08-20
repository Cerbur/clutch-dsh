import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitWorktreeAdapter, GitWorktreeInfo } from './types.js';
import { WorktreeProviderError, providerError } from './types.js';

const execFile = promisify(execFileCallback);

interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

// Git 的原始进程证据只在本模块内流转；对外统一转换为稳定的 Provider 错误词汇。
// Raw Git process evidence stays inside this module and is normalized to the
// stable Provider error vocabulary at the public boundary.
class GitCommandError extends Error {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | string | null;

  constructor(
    args: readonly string[],
    cwd: string,
    stdout: string,
    stderr: string,
    exitCode: number | string | null,
  ) {
    super(stderr || stdout || `git exited with ${String(exitCode)}`);
    this.name = 'GitCommandError';
    this.args = args;
    this.cwd = cwd;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

/*
 * 所有 Git 调用都使用参数数组和固定 executable，不经过 shell；因此路径或分支中的 shell
 * 元字符不会被解释。参数的业务合法性仍由上层 Manage 校验。
 *
 * Every Git call uses an argument vector and a fixed executable without a
 * shell, so shell metacharacters in paths or branches are never evaluated.
 * Semantic validation of those values remains the responsibility of Manage.
 */
async function runGit(args: readonly string[], cwd: string): Promise<GitCommandResult> {
  try {
    const result = await execFile('git', [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const commandError = error as {
      readonly stdout?: string;
      readonly stderr?: string;
      readonly code?: number | string;
    };
    throw new GitCommandError(
      args,
      cwd,
      commandError.stdout ?? '',
      commandError.stderr ?? '',
      commandError.code ?? null,
    );
  }
}

// 保留 cwd、参数、stdout、stderr 和退出码，避免稳定错误 code 丢失现场诊断信息。
// Preserve cwd, arguments, stdout, stderr, and exit code so a stable error code
// does not discard the evidence needed for diagnosis.
function gitDetails(error: GitCommandError): Record<string, string | number | readonly string[]> {
  return {
    workspaceRoot: error.cwd,
    gitArgs: error.args,
    gitStdout: error.stdout,
    gitStderr: error.stderr,
    gitExitCode: typeof error.exitCode === 'number' ? error.exitCode : String(error.exitCode),
  };
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
  let current: { absolutePath?: string; branch?: string } = {};

  const flush = () => {
    if (current.absolutePath) {
      worktrees.push({
        absolutePath: current.absolutePath,
        ...(current.branch ? { branch: current.branch } : {}),
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
    }
  }
  flush();
  return worktrees;
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
  /**
   * 分开验证“位于非 bare working tree”和“已有可解析的首个 commit”，以返回不同修复语义。
   * Separately verifies “inside a non-bare working tree” and “has a resolvable
   * initial commit” so callers receive distinct repair semantics.
   */
  async validateRepository(workspaceRoot: string): Promise<void> {
    let result: GitCommandResult;
    try {
      result = await runGit(['rev-parse', '--is-inside-work-tree'], workspaceRoot);
    } catch (error) {
      if (error instanceof GitCommandError) {
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
      await runGit(['rev-parse', '--verify', 'HEAD^{commit}'], workspaceRoot);
    } catch (error) {
      if (error instanceof GitCommandError) {
        throw providerError(
          'WORKTREE_REQUIRES_INITIAL_COMMIT',
          `Workspace has no initial commit: ${workspaceRoot}`,
          { ...gitDetails(error) },
        );
      }
      throw error;
    }
  }

  /**
   * 仅列出 `refs/heads/` 下的本地分支；NUL 分隔避免依赖面向人的展示格式或空白切分。
   * Lists local branches under `refs/heads/` only; NUL delimiting avoids
   * depending on human-facing formatting or whitespace tokenization.
   */
  async listBranches(workspaceRoot: string): Promise<readonly string[]> {
    try {
      const result = await runGit(
        ['for-each-ref', '--format=%(refname:short)%00', 'refs/heads/'],
        workspaceRoot,
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
   * 使用 porcelain 输出枚举已注册 Worktree；无法映射到本地 branch 的条目不会被丢弃。
   * Enumerates registered Worktrees through porcelain output; entries that do
   * not map to a local branch are not discarded.
   */
  async listWorktrees(workspaceRoot: string): Promise<readonly GitWorktreeInfo[]> {
    try {
      const result = await runGit(['worktree', 'list', '--porcelain'], workspaceRoot);
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
  ): Promise<void> {
    try {
      const args = newBranch
        ? ['worktree', 'add', '-b', newBranch, targetPath, branch]
        : ['worktree', 'add', targetPath, branch];
      await runGit(args, workspaceRoot);
    } catch (error) {
      throw operationError('create worktree', workspaceRoot, targetPath, newBranch ?? branch, error);
    }
  }

  /**
   * 仅执行非强制 `git worktree remove <targetPath>`；Git 的安全拒绝会原样升级为显式错误。
   * Executes non-forced `git worktree remove <targetPath>` only; Git safety
   * refusals are surfaced as explicit errors.
   */
  async removeWorktree(workspaceRoot: string, targetPath: string): Promise<void> {
    try {
      await runGit(['worktree', 'remove', targetPath], workspaceRoot);
    } catch (error) {
      throw operationError('remove worktree', workspaceRoot, targetPath, undefined, error);
    }
  }
}
