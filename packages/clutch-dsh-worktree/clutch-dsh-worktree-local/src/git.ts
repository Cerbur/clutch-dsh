import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitWorktreeAdapter, GitWorktreeInfo } from './types.js';
import { WorktreeProviderError, providerError } from './types.js';

const execFile = promisify(execFileCallback);

interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

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

function gitDetails(error: GitCommandError): Record<string, string | number | readonly string[]> {
  return {
    workspaceRoot: error.cwd,
    gitArgs: error.args,
    gitStdout: error.stdout,
    gitStderr: error.stderr,
    gitExitCode: typeof error.exitCode === 'number' ? error.exitCode : String(error.exitCode),
  };
}

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

export class LocalGitAdapter implements GitWorktreeAdapter {
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

  async listWorktrees(workspaceRoot: string): Promise<readonly GitWorktreeInfo[]> {
    try {
      const result = await runGit(['worktree', 'list', '--porcelain'], workspaceRoot);
      return parseWorktrees(result.stdout);
    } catch (error) {
      throw operationError('list worktrees', workspaceRoot, undefined, undefined, error);
    }
  }

  async createWorktree(workspaceRoot: string, targetPath: string, branch: string): Promise<void> {
    try {
      await runGit(['worktree', 'add', targetPath, branch], workspaceRoot);
    } catch (error) {
      throw operationError('create worktree', workspaceRoot, targetPath, branch, error);
    }
  }

  async removeWorktree(workspaceRoot: string, targetPath: string): Promise<void> {
    try {
      await runGit(['worktree', 'remove', targetPath], workspaceRoot);
    } catch (error) {
      throw operationError('remove worktree', workspaceRoot, targetPath, undefined, error);
    }
  }
}
